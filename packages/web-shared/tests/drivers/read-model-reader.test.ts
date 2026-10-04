import { describe, expect, it } from "vitest";
import { PostgresDriver } from "../../src/drivers/postgres.js";
import { projectCohortSeries, projectCohortSnapshot } from "../../src/cohorts.js";
import { tinyArtifact } from "../fixtures/tiny-artifact.js";
import { withReadModelDatabase } from "../../../../apps/web-app/tests/helpers/read-model-db.ts";
import { publishScan } from "../../../../apps/web-app/src/lib/scan-projection.ts";
import type { Pool } from "pg";

function recordingPool(pool: Pool, texts: string[], queries: Array<{ text: string; values: unknown }> = []): Pool {
  return new Proxy(pool, {
    get(target, key) {
      if (key === "connect") return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(connection, property) {
            if (property === "query") return (...args: unknown[]) => {
              const first = args[0];
              const text = typeof first === "string" ? first : (first as { text: string }).text;
              texts.push(text);
              queries.push({ text, values: args[1] });
              return Reflect.apply(connection.query, connection, args);
            };
            const value = Reflect.get(connection, property);
            return typeof value === "function" ? value.bind(connection) : value;
          },
        });
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe.skipIf(!process.env.DATABASE_URL)("stored read models", () => {
  it("leaves a repo with no ready scan out of estate reads and records it, but fails a read of that repo", async () => {
    await withReadModelDatabase(async pool => {
      const kept = tinyArtifact({ scanId: "kept", repoId: "kept" });
      const missing = tinyArtifact({ scanId: "missing", repoId: "missing" });
      await publishScan(pool, kept, { uploadedByUserId: null });
      await publishScan(pool, missing, { uploadedByUserId: null });
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'missing'");
      const driver = new PostgresDriver(pool);
      const fallback = { repoId: "missing", skipped: [{ scanId: "missing", rebuilding: false }], shownScanId: null };
      const latest = await driver.withReadSnapshot(async snapshot => ({
        repos: (await snapshot.listRepos()).map(repo => repo.repoId),
        components: (await snapshot.listComponents()).map(component => component.repoCount),
        packages: (await snapshot.listPackages()).map(entry => entry.consumerCount),
        skipped: snapshot.skippedScans(),
      }));
      expect(latest).toEqual({ repos: ["kept"], components: [1, 1], packages: [1], skipped: { fallbacks: [fallback], gaps: [] } });
      const history = await driver.withReadSnapshot(async snapshot => ({
        scans: (await snapshot.listScanDigests()).map(scan => scan.meta.scanId), skipped: snapshot.skippedScans(),
      }));
      expect(history).toEqual({ scans: ["kept"], skipped: { fallbacks: [], gaps: [{ repoId: "missing", scanId: "missing", rebuilding: false }] } });
      await expect(driver.getRepo("missing")).rejects.toMatchObject({ name: "ReadModelUnavailableError", scanIds: ["missing"], state: "preparing", retryable: true });
    });
  });

  it("reads a repo at its newest ready scan and records the newer ones, except for a picked scan", async () => {
    await withReadModelDatabase(async pool => {
      for (const [index, hour] of ["09", "10", "11"].entries()) {
        await publishScan(pool, tinyArtifact({ scanId: `S${index + 1}`, scannedAt: `2026-05-18T${hour}:00:00Z` }), { uploadedByUserId: null });
      }
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'S3'");
      const driver = new PostgresDriver(pool);
      const latest = await driver.withReadSnapshot(async snapshot => ({
        detail: await snapshot.getRepo("tiny-repo"),
        newestTwo: (await snapshot.listScanDigests(undefined, { newestPerRepo: 2 })).map(scan => scan.meta.scanId),
        skipped: snapshot.skippedScans(),
      }));
      expect(latest).toMatchObject({
        detail: { scanId: "S2", scanCount: 3, diff: { baselineScanId: "S1" } },
        newestTwo: ["S1", "S2"],
        skipped: { fallbacks: [{ repoId: "tiny-repo", skipped: [{ scanId: "S3", rebuilding: false }], shownScanId: "S2" }], gaps: [] },
      });
      expect(await driver.withReadSnapshot(async snapshot => {
        await snapshot.getRepo("tiny-repo", "S2");
        return snapshot.skippedScans();
      })).toEqual({ fallbacks: [], gaps: [] });
      await expect(driver.getRepo("tiny-repo", "S3")).rejects.toMatchObject({ name: "ReadModelUnavailableError", scanIds: ["S3"] });
    });
  });

  it("pins a publication and overlays while another connection replaces it", async () => {
    await withReadModelDatabase(async pool => {
      const artifact = tinyArtifact();
      await publishScan(pool, artifact, { uploadedByUserId: null });
      const canonical = (await pool.query("SELECT artifact::text AS artifact FROM scans WHERE scan_id = $1", [artifact.meta.scanId])).rows[0].artifact;
      await pool.query(`UPDATE scan_component_facts SET payload = jsonb_set(
        jsonb_set(payload, '{fact,stats,occurrenceCount}', '99'), '{fact,digest,stats,occurrenceCount}', '99')
        WHERE scan_id = $1 AND component_id = $2`, [artifact.meta.scanId, artifact.components[0].id]);
      const driver = new PostgresDriver(pool);
      await driver.withReadSnapshot(async snapshot => {
        const first = await snapshot.getRepo(artifact.meta.repo.id);
        const before = await snapshot.listComponentsForRepo(artifact.meta.repo.id, "");
        expect(first?.totalOccurrences).toBe(100);
        expect(before[0]?.occurrenceCount).toBe(99);
        expect((await snapshot.listScanDigests())[0]?.components[0]?.stats.occurrenceCount).toBe(99);
        await pool.query("UPDATE scan_read_models SET state = 'preparing' WHERE scan_id = $1", [artifact.meta.scanId]);
        expect(await publishScan(pool, artifact, { uploadedByUserId: null })).toMatchObject({ status: "rebuilt", revision: 2 });
        await pool.query("INSERT INTO tags (id, value, color, rule) VALUES ('new', 'new', 'teal', '{\"glob\":[\"*\"],\"exact\":[]}')");
        expect(await snapshot.listTags()).toEqual([]);
        expect(await snapshot.withReadSnapshot(nested => nested.getRepo(artifact.meta.repo.id))).toEqual(first);
        expect(await snapshot.listComponentsForRepo(artifact.meta.repo.id, "")).toEqual(before);
        expect((await snapshot.listScanDigests())[0]?.components[0]?.stats.occurrenceCount).toBe(99);
      });
      expect((await driver.getRepo(artifact.meta.repo.id))?.totalOccurrences).toBe(2);
      expect((await driver.listComponentsForRepo(artifact.meta.repo.id, ""))[0]?.occurrenceCount).toBe(1);
      expect((await driver.listTags()).map(tag => tag.id)).toEqual(["new"]);
      expect((await driver.listScanDigests())[0]?.components[0]?.stats.occurrenceCount).toBe(1);
      expect((await pool.query("SELECT artifact::text AS artifact FROM scans WHERE scan_id = $1", [artifact.meta.scanId])).rows[0].artifact).toBe(canonical);
    });
  });

  it.each([
    { selected: undefined, current: "S4", predecessor: "S3", olderReady: "S2" },
    { selected: "S3", current: "S3", predecessor: "S2", olderReady: null },
  ])("bounds detail history to $current and $predecessor despite an unavailable older scan", async ({ selected, current, predecessor, olderReady }) => {
    await withReadModelDatabase(async pool => {
      for (const [index, hour] of ["09", "10", "10", "11"].entries()) {
        await publishScan(pool, tinyArtifact({ scanId: `S${index + 1}`, scannedAt: `2026-05-18T${hour}:00:00Z` }), { uploadedByUserId: null });
      }
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'S1'");
      const queries: Array<{ text: string; values: unknown }> = [];
      const driver = new PostgresDriver(recordingPool(pool, [], queries));
      const detail = await driver.getRepo("tiny-repo", selected);
      expect(detail).toMatchObject({ scanId: current, scanCount: 4, diff: { baselineScanId: predecessor } });
      const digestQueries = queries.filter(query => query.text.includes("AS digest FROM scan_component_facts"));
      expect(digestQueries).toHaveLength(1);
      expect(digestQueries[0]?.values).toEqual([[current, predecessor]]);
      expect(await driver.getRepo("tiny-repo", "missing")).toBeNull();
      await pool.query("UPDATE scan_read_models SET state = 'failed' WHERE scan_id = $1", [predecessor]);
      const fallback = await driver.getRepo("tiny-repo", selected);
      expect([fallback?.scanId, fallback?.diff?.baselineScanId ?? null]).toEqual([current, olderReady]);
    });
  });

  it("leaves out failed, incompatible and incomplete headers on every contribution", async () => {
    await withReadModelDatabase(async pool => {
      const first = tinyArtifact({ scanId: "first", repoId: "first" });
      const second = tinyArtifact({ scanId: "second", repoId: "second" });
      await publishScan(pool, first, { uploadedByUserId: null });
      await publishScan(pool, second, { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      for (const update of ["state = 'failed'", "projection_version = 0", "format_version = 999", "actual_counts = '{}'::jsonb", "build_revision = 0"]) {
        await pool.query(`UPDATE scan_read_models SET ${update} WHERE scan_id = 'second'`);
        expect(await driver.withReadSnapshot(async snapshot => ({
          repoCount: (await snapshot.getCrossRepoComponent(first.components[0].id))?.repoCount, skipped: snapshot.skippedScans().fallbacks,
        }))).toEqual({ repoCount: 1, skipped: [{ repoId: "second", skipped: [{ scanId: "second", rebuilding: true }], shownScanId: null }] });
        await expect(driver.getRepo("second")).rejects.toMatchObject({ name: "ReadModelUnavailableError", scanIds: ["second"], state: update === "state = 'failed'" ? "failed" : "preparing", retryable: update !== "state = 'failed'" });
        await pool.query("UPDATE scan_read_models SET state = 'ready', projection_version = 1, format_version = 1, build_revision = 1, actual_counts = expected_counts WHERE scan_id = 'second'");
      }
      await pool.query("UPDATE scan_read_models SET details_retained = false WHERE scan_id = 'second'");
      await expect(driver.getComponentDetailHead("second", second.components[0].id)).rejects.toMatchObject({ name: "ReadModelUnavailableError", scanIds: ["second"] });
      await expect(driver.getComponentUsage("second", second.components[0].id)).rejects.toMatchObject({ name: "ReadModelUnavailableError", scanIds: ["second"] });
    });
  });

  it("selects the greatest scan id for equal timestamps and includes empty scans", async () => {
    await withReadModelDatabase(async pool => {
      const first = tinyArtifact({ scanId: "a" });
      const last = { ...tinyArtifact({ scanId: "z" }), components: [], occurrences: [] };
      await publishScan(pool, first, { uploadedByUserId: null });
      await publishScan(pool, last, { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      expect((await driver.getRepo(first.meta.repo.id))?.scanId).toBe("z");
      expect(await driver.listComponentsForRepo(first.meta.repo.id, "")).toEqual([]);
      expect((await driver.listScanDigests(undefined, { latestOnly: true })).map(scan => [scan.meta.scanId, scan.components])).toEqual([["z", []]]);
      expect((await driver.listScans(first.meta.repo.id)).map(scan => scan.scanId)).toEqual(["z", "a"]);
    });
  });

  it("uses the scan-id tie-break for adoption and one trend point when equal instants use different timestamp spellings", async () => {
    await withReadModelDatabase(async pool => {
      const first = tinyArtifact({ scanId: "a", scannedAt: "2026-06-02T00:00:00Z" });
      const last = tinyArtifact({ scanId: "z", scannedAt: "2026-06-02T00:00:00.000Z" });
      const component = last.components[0];
      if (!component) throw new Error("Missing fixture component");
      last.components[0] = { ...component, stats: { occurrenceCount: 9, fileCount: 1 } };
      await publishScan(pool, first, { uploadedByUserId: null });
      await publishScan(pool, last, { uploadedByUserId: null });

      const digests = await new PostgresDriver(pool).listScanDigests(first.meta.repo.id);
      const cohorts = [{ kind: "package" as const, packageName: "@x/wc" }];

      expect(projectCohortSnapshot(digests, [], cohorts, "count")[0]).toMatchObject({ value: 9, componentCount: 1 });
      expect(projectCohortSeries(digests, [], cohorts, "count")[0]?.points).toEqual([
        { t: "2026-06-02T00:00:00.000Z", value: 9 },
      ]);
    });
  });

  it("uses scans timestamps for digest, adoption, trend, and diffs despite persisted repo-view metadata", async () => {
    await withReadModelDatabase(async pool => {
      const first = tinyArtifact({ scanId: "a", scannedAt: "2026-06-02T00:00:00Z" });
      const last = tinyArtifact({ scanId: "z", scannedAt: "2026-06-02T00:00:00.000Z" });
      const component = last.components[0];
      if (!component) throw new Error("Missing fixture component");
      last.components[0] = { ...component, stats: { occurrenceCount: 9, fileCount: 1 } };
      await publishScan(pool, first, { uploadedByUserId: null });
      await publishScan(pool, last, { uploadedByUserId: null });
      await pool.query("UPDATE scan_repo_views SET payload = jsonb_set(payload, '{meta,scannedAt}', $1::jsonb) WHERE scan_id = $2", [JSON.stringify("not-a-timestamp"), "a"]);
      await pool.query("UPDATE scan_repo_views SET payload = jsonb_set(payload, '{meta,scannedAt}', $1::jsonb) WHERE scan_id = $2", [JSON.stringify("2026-06-03T00:00:00Z"), "z"]);

      const driver = new PostgresDriver(pool);
      const digests = await driver.listScanDigests(first.meta.repo.id);
      const cohorts = [{ kind: "package" as const, packageName: "@x/wc" }];

      expect(digests.map(digest => [digest.meta.scanId, digest.meta.committedAt])).toEqual([
        ["a", "2026-06-02T00:00:00.000Z"],
        ["z", "2026-06-02T00:00:00.000Z"],
      ]);
      expect(projectCohortSnapshot(digests, [], cohorts, "count")[0]).toMatchObject({ value: 9, componentCount: 1 });
      expect(projectCohortSeries(digests, [], cohorts, "count")[0]?.points).toEqual([
        { t: "2026-06-02T00:00:00.000Z", value: 9 },
      ]);
      expect(await driver.getRepo(first.meta.repo.id)).toMatchObject({ diff: { baselineCommittedAt: "2026-06-02T00:00:00.000Z" } });
    });
  });

  it("limits list and head queries to their stored surfaces", async () => {
    await withReadModelDatabase(async pool => {
      const artifact = tinyArtifact();
      await publishScan(pool, artifact, { uploadedByUserId: null });
      const texts: string[] = [];
      const driver = new PostgresDriver(recordingPool(pool, texts));
      await driver.withReadSnapshot(async snapshot => {
        await snapshot.listRepos();
        await snapshot.getRepo(artifact.meta.repo.id);
        await snapshot.listComponentsForRepo(artifact.meta.repo.id, "");
        await snapshot.listPackages();
        await snapshot.getPackage("@x/wc");
        await snapshot.listComponents();
        await snapshot.listScanDigests();
      });
      expect(texts.join("\n")).not.toMatch(/\bartifact\b|scan_occurrence_views|scan_component_details/);
      expect(texts.filter(text => text.includes("jsonb_build_object")).join("\n")).not.toMatch(/'props'/);
      texts.length = 0;
      await driver.getComponentDetailHead(artifact.meta.repo.id, artifact.components[0].id);
      expect(texts.join("\n")).toContain("scan_component_details");
      expect(texts.join("\n")).not.toMatch(/scan_occurrence_views|\bartifact\b/);
      texts.length = 0;
      expect(await driver.getComponentUsage(artifact.meta.repo.id, artifact.components[0].id)).toHaveLength(1);
      expect(texts.join("\n")).toContain("scan_occurrence_views");
      expect(texts.join("\n")).toContain("scan_occurrence_views WHERE scan_id = $1 AND component_id = $2");
      expect(texts.join("\n")).not.toMatch(/SELECT payload FROM scan_component_details/);
    });
  });

  it("keeps the selected scan when a newer publication arrives", async () => {
    await withReadModelDatabase(async pool => {
      const artifact = tinyArtifact({ scanId: "first", scannedAt: "2026-05-18T10:00:00Z" });
      await publishScan(pool, artifact, { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      await driver.withReadSnapshot(async snapshot => {
        expect((await snapshot.getRepo(artifact.meta.repo.id))?.scanId).toBe("first");
        const newer = tinyArtifact({ scanId: "newer", scannedAt: "2026-05-18T11:00:00Z" });
        newer.components = [];
        newer.occurrences = [];
        await publishScan(pool, newer, { uploadedByUserId: null });
        expect((await snapshot.getComponentDetailHead(artifact.meta.repo.id, artifact.components[0].id))?.displayName).toBe("x-button");
        expect((await snapshot.getRepo(artifact.meta.repo.id))?.scanId).toBe("first");
      });
      expect((await driver.getRepo(artifact.meta.repo.id))?.scanId).toBe("newer");
    });
  });
});
