import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PostgresDriver } from "../../src/drivers/postgres.js";
import { chartResultKey, deriveChartResults } from "../../src/chart-results.js";
import { tinyArtifact } from "../fixtures/tiny-artifact.js";
import { withReadModelDatabase } from "../../../../apps/web-app/tests/helpers/read-model-db.ts";
import { publishScan } from "../../../../apps/web-app/src/lib/scan-projection.ts";
import { claimScanJob } from "../../../../apps/web-app/src/lib/scan-jobs.ts";
import { processChartResultsJob } from "../../../../apps/web-app/src/lib/chart-results-job.ts";

async function buildResults(pool: Pool): Promise<void> {
  const job = await claimScanJob(pool, "reader-test");
  if (job?.kind !== "results") throw new Error("Expected a queued results job");
  expect(await processChartResultsJob(pool, job, new AbortController().signal)).toBe("written");
}

async function derived(driver: PostgresDriver) {
  const stored = await driver.getStoredRegistry();
  if (!stored) throw new Error("Expected stored chart results");
  const inputs = await driver.withReadSnapshot(async snapshot => ({
    digests: await snapshot.listScanDigests(), tags: await snapshot.listTags(),
    governance: await snapshot.listGovernance(), dashboards: await snapshot.listDashboards(),
    asOf: stored.snapshotAt,
  }));
  return JSON.parse(JSON.stringify(deriveChartResults(inputs))) as ReturnType<typeof deriveChartResults>;
}

describe.skipIf(!process.env.DATABASE_URL)("stored chart results", { timeout: 30_000 }, () => {
  it("reads nothing before a results job has run", async () => {
    await withReadModelDatabase(async pool => {
      const driver = new PostgresDriver(pool);
      expect(await driver.getStoredTracking({ kind: "all" })).toBeNull();
      expect(await driver.getStoredRegistry()).toBeNull();
      expect(await driver.getStoredPreviews()).toEqual({});
      expect(await driver.latestScanArrivedAt()).toBeNull();
    });
  });

  it("reads the stored tracking, registry and previews by scope and dashboard id", async () => {
    await withReadModelDatabase(async pool => {
      const driver = new PostgresDriver(pool);
      await driver.createGovernance({ grain: "package", targetPackage: "@x/wc", targetExport: null, disposition: { kind: "retired", reason: "Retired" } });
      const estate = await driver.upsertDashboard({ name: "Estate", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } });
      const repo = await driver.upsertDashboard({ name: "Repo", description: null, config: { scope: { kind: "repo", repoId: "repo-b" }, cohorts: [{ kind: "package", packageName: "@x/wc" }], chartType: "trend", metric: "count" } });
      await publishScan(pool, tinyArtifact({ repoId: "repo-a", scanId: "scan-a", scannedAt: "2026-09-20T10:00:00.000Z" }), { uploadedByUserId: null });
      await publishScan(pool, tinyArtifact({ repoId: "repo-b", scanId: "scan-b", scannedAt: "2026-09-21T10:00:00.000Z" }), { uploadedByUserId: null });
      await buildResults(pool);
      const expected = await derived(driver);

      expect(await driver.getStoredTracking({ kind: "all" })).toEqual(expected.tracking);
      expect(await driver.getStoredTracking({ kind: "repo", repoId: "repo-b" })).toEqual(expected.repoTracking["repo-b"]);
      expect(await driver.getStoredTracking({ kind: "repo", repoId: "repo-missing" })).toBeNull();
      const built = { snapshotAt: expect.any(String) };
      expect(await driver.getStoredRegistry()).toEqual({ ...expected.registry, ...built });
      expect(await driver.getStoredPreviews()).toEqual({ [estate.id]: { ...expected.previews[estate.id], ...built }, [repo.id]: { ...expected.previews[repo.id], ...built } });
      await pool.query("UPDATE scans SET created_at = '2026-09-22T08:00:00Z' WHERE scan_id = 'scan-a'");
      await pool.query("UPDATE scans SET created_at = '2026-09-21T10:05:00Z' WHERE scan_id = 'scan-b'");
      expect(await driver.latestScanArrivedAt()).toBe("2026-09-22T08:00:00.000Z");
    });
  });

  it("treats rows stored in another format as absent", async () => {
    await withReadModelDatabase(async pool => {
      const driver = new PostgresDriver(pool);
      const kept = await driver.upsertDashboard({ name: "Kept", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } });
      await driver.upsertDashboard({ name: "Stale", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } });
      await publishScan(pool, tinyArtifact({ repoId: "repo-a", scanId: "scan-a" }), { uploadedByUserId: null });
      await buildResults(pool);
      await pool.query("UPDATE chart_results SET format_version = format_version + 1 WHERE key <> $1", [chartResultKey.preview(kept.id)]);

      expect(await driver.getStoredTracking({ kind: "all" })).toBeNull();
      expect(await driver.getStoredTracking({ kind: "repo", repoId: "repo-a" })).toBeNull();
      expect(await driver.getStoredRegistry()).toBeNull();
      expect(Object.keys(await driver.getStoredPreviews())).toEqual([kept.id]);
    });
  });
});
