import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { componentKey, validateArtifact, type ScanArtifact } from "@scoutui/scan-format";
import { PostgresDriver, PROJECTION_VERSION, READ_MODEL_FORMAT_VERSION } from "@scoutui/web-shared";
import { claimScanJob, type ClaimedScanJob } from "@/lib/scan-jobs";
import { publishScan, republishScan, type PublishOptions } from "@/lib/scan-projection";
import { reconcileScanJobs } from "@/lib/scan-reconciliation";
import { baseline } from "../helpers/cli-baseline";
import { withReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";
import { artifact as v2Artifact, component, packageExport, repoDeclaration } from "../../../../packages/web-shared/tests/helpers/builders.js";

function artifact(scanId = "scan-a", scannedAt = "2026-09-19T00:00:00Z"): ScanArtifact {
  return sampleArtifact({ scanId, scannedAt });
}

function scanOfAcmeWeb(scanId: string, gitRemote: string | null, commit?: string): ScanArtifact {
  const scan = sampleArtifact({ scanId, repoId: "acme/web", ...(commit ? { commit } : {}) });
  scan.meta.repo.gitRemote = gitRemote;
  return scan;
}

const tables = ["scans", "scan_repo_views", "scan_component_facts", "scan_package_contributions", "scan_component_details", "scan_occurrence_views", "scan_composition_graphs"] as const;

async function readPublishedCounts(observer: Pool | PoolClient, scanId: string) {
  const counts = {} as Record<(typeof tables)[number], number>;
  for (const table of tables) counts[table] = (await observer.query(`SELECT count(*)::int AS n FROM ${table} WHERE scan_id = $1`, [scanId])).rows[0].n;
  const header = (await observer.query("SELECT * FROM scan_read_models WHERE scan_id = $1", [scanId])).rows[0] ?? null;
  return { header, counts };
}

async function publishWithInjectedBatchFailure(pool: Pool, input: ScanArtifact, inspect: () => Promise<void>, options: PublishOptions = { uploadedByUserId: null }) {
  const wrapped = new Proxy(pool, {
    get(target, key) {
      if (key !== "connect") {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async () => {
        const client = await target.connect();
        let inserts = 0;
        return new Proxy(client, {
          get(connection, property) {
            if (property === "query") return async (query: string, values?: unknown[]) => {
              if (/^INSERT INTO scan_(repo_views|component_facts|package_contributions|component_details|occurrence_views|composition_graphs)/.test(query) && ++inserts === 2) {
                await inspect();
                throw new Error("Injected second INSERT failure");
              }
              return connection.query(query, values);
            };
            const value = Reflect.get(connection, property);
            return typeof value === "function" ? value.bind(connection) : value;
          },
        });
      };
    },
  });
  return publishScan(wrapped, input, options);
}

const { DATABASE_URL: databaseUrl } = process.env;
describe.skipIf(!databaseUrl)("atomic scan publication", { timeout: 30_000 }, () => {
  it("publishes raw storage and complete models together and recognizes a complete duplicate", async () => {
    await withReadModelDatabase(async pool => {
      expect(await publishScan(pool, artifact(), { uploadedByUserId: null })).toEqual({ status: "inserted", scanId: "scan-a", revision: 1 });
      const before = await readPublishedCounts(pool, "scan-a");
      expect(before.counts).toEqual({ scans: 1, scan_repo_views: 1, scan_component_facts: 1, scan_package_contributions: 1, scan_component_details: 1, scan_occurrence_views: 1, scan_composition_graphs: 1 });
      expect(before.header).toMatchObject({ state: "ready", projection_version: PROJECTION_VERSION, format_version: READ_MODEL_FORMAT_VERSION, build_revision: 1, details_retained: true });
      expect(before.header.expected_counts).toEqual(before.header.actual_counts);
      expect(await publishScan(pool, artifact(), { uploadedByUserId: null })).toEqual({ status: "exists", scanId: "scan-a", revision: 1 });
      expect(await readPublishedCounts(pool, "scan-a")).toEqual(before);
    });
  });

  it("repairs same-version missing facts from the immutable canonical artifact", async () => {
    await withReadModelDatabase(async pool => {
      const canonical = artifact();
      await publishScan(pool, canonical, { uploadedByUserId: null });
      await pool.query("DELETE FROM scan_component_facts WHERE scan_id = 'scan-a'");
      const replacement = { ...canonical, components: [], occurrences: [] };
      expect(await publishScan(pool, replacement, { uploadedByUserId: null })).toEqual({ status: "rebuilt", scanId: "scan-a", revision: 2 });
      const after = await readPublishedCounts(pool, "scan-a");
      expect(after.counts.scan_component_facts).toBe(1);
      expect((await pool.query("SELECT artifact FROM scans WHERE scan_id = 'scan-a'")).rows[0].artifact).toEqual(canonical);
      expect((await pool.query("SELECT payload->'fact'->'identity'->>'exportName' AS name FROM scan_component_facts")).rows).toEqual([{ name: "Button" }]);
    });
  });

  it.each(["repo", "commit", "version"])("rejects a same-ID %s identity mismatch without changing canonical state", async field => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, artifact(), { uploadedByUserId: null });
      const before = await readPublishedCounts(pool, "scan-a");
      const input = artifact();
      if (field === "repo") input.meta.repo.id = "other-repo";
      if (field === "commit") input.meta.repo.commit = "def";
      if (field === "version") input.meta.scannerVersion = "1";
      await expect(publishScan(pool, input, { uploadedByUserId: null })).rejects.toMatchObject({ code: "identity_conflict" });
      expect(await readPublishedCounts(pool, "scan-a")).toEqual(before);
      expect((await pool.query("SELECT count(*)::int AS n FROM repos")).rows[0].n).toBe(1);
    });
  });

  it("publishes a complete header for a zero-component scan", async () => {
    await withReadModelDatabase(async pool => {
      const input = { ...artifact(), components: [], occurrences: [] };
      await publishScan(pool, input, { uploadedByUserId: null });
      const result = await readPublishedCounts(pool, "scan-a");
      expect(result.header.state).toBe("ready");
      expect(result.header.expected_counts).toEqual(result.header.actual_counts);
      expect(result.counts).toEqual({ scans: 1, scan_repo_views: 1, scan_component_facts: 0, scan_package_contributions: 0, scan_component_details: 0, scan_occurrence_views: 0, scan_composition_graphs: 0 });
    });
  });

  it("keeps the old complete publication visible during failed replacement and after rollback", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, artifact(), { uploadedByUserId: null });
      await pool.query("UPDATE scan_read_models SET projection_version = 0 WHERE scan_id = 'scan-a'");
      const observer = await pool.connect();
      try {
        const before = await readPublishedCounts(observer, "scan-a");
        let inspected = false;
        await expect(publishWithInjectedBatchFailure(pool, artifact(), async () => {
          inspected = true;
          expect(await readPublishedCounts(observer, "scan-a")).toEqual(before);
        })).rejects.toThrow("Injected second INSERT failure");
        expect(inspected).toBe(true);
        expect(await readPublishedCounts(observer, "scan-a")).toEqual(before);
      } finally { observer.release(); }
    });
  });

  it.each(["projection_version", "format_version"])("rejects replacing a newer %s", async column => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, artifact(), { uploadedByUserId: null });
      await pool.query(`UPDATE scan_read_models SET ${column} = 999 WHERE scan_id = 'scan-a'`);
      const before = await readPublishedCounts(pool, "scan-a");
      await expect(publishScan(pool, artifact(), { uploadedByUserId: null })).rejects.toThrow(/newer|version/i);
      expect(await readPublishedCounts(pool, "scan-a")).toEqual(before);
    });
  });

  it.each([
    ["scan-a", "2026-09-18T00:00:00Z", "scan-z", "2026-09-19T00:00:00Z", "scan-z"],
    ["scan-z", "2026-09-19T00:00:00Z", "scan-a", "2026-09-18T00:00:00Z", "scan-z"],
    ["scan-a", "2026-09-19T00:00:00Z", "scan-z", "2026-09-19T00:00:00Z", "scan-z"],
    ["scan-z", "2026-09-19T00:00:00Z", "scan-a", "2026-09-19T00:00:00Z", "scan-z"],
  ])("retains heavy rows when %s (%s) arrives before %s (%s)", async (first, firstTime, second, secondTime, latest) => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, artifact(first, firstTime), { uploadedByUserId: null });
      await publishScan(pool, artifact(second, secondTime), { uploadedByUserId: null });
      for (const id of [first, second]) {
        const result = await readPublishedCounts(pool, id);
        expect(result.header.details_retained).toBe(id === latest);
        expect(result.header.expected_counts).toEqual(result.header.actual_counts);
        expect(result.counts).toEqual({ scans: 1, scan_repo_views: 1, scan_component_facts: 1, scan_package_contributions: 1, scan_component_details: id === latest ? 1 : 0, scan_occurrence_views: id === latest ? 1 : 0, scan_composition_graphs: 1 });
      }
      expect((await publishScan(pool, artifact(first, firstTime), { uploadedByUserId: null })).status).toBe("exists");
    });
  });

  it("rolls back superseded-heavy-row pruning when a newer scan fails", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, artifact(), { uploadedByUserId: null });
      const before = await readPublishedCounts(pool, "scan-a");
      await expect(publishWithInjectedBatchFailure(pool, artifact("scan-b", "2026-09-20T00:00:00Z"), async () => {
        expect(await readPublishedCounts(pool, "scan-a")).toEqual(before);
      })).rejects.toThrow("Injected second INSERT failure");
      expect(await readPublishedCounts(pool, "scan-a")).toEqual(before);
      expect((await readPublishedCounts(pool, "scan-b")).header).toBeNull();
      expect((await readPublishedCounts(pool, "scan-b")).counts.scans).toBe(0);
    });
  });

  it("serializes parallel same-repo publishers and preserves latest detail", async () => {
    await withReadModelDatabase(async pool => {
      await Promise.all([
        publishScan(pool, artifact("scan-a"), { uploadedByUserId: null }),
        publishScan(pool, artifact("scan-z"), { uploadedByUserId: null }),
        publishScan(pool, artifact("scan-m", "2026-09-18T00:00:00Z"), { uploadedByUserId: null }),
      ]);
      expect((await pool.query("SELECT scan_id FROM scan_read_models WHERE details_retained ORDER BY scan_id")).rows).toEqual([{ scan_id: "scan-z" }]);
      expect((await pool.query("SELECT count(*)::int AS n FROM scan_component_facts")).rows[0].n).toBe(3);
      expect((await pool.query("SELECT scan_id FROM scan_occurrence_views")).rows).toEqual([{ scan_id: "scan-z" }]);
    });
  });

  it("publishes the first of parallel uploads of one commit and reports the others as that scan", async () => {
    await withReadModelDatabase(async pool => {
      const results = await Promise.all(["scan-a", "scan-b", "scan-c"].map(scanId =>
        publishScan(pool, sampleArtifact({ scanId, commit: "shared" }), { uploadedByUserId: null })));
      const { rows: survivors } = await pool.query("SELECT scan_id FROM scans");
      expect(survivors).toHaveLength(1);
      const survivor = survivors[0].scan_id;
      expect(results.map(result => [result.status, result.scanId]).sort())
        .toEqual([["exists", survivor], ["exists", survivor], ["inserted", survivor]]);
    });
  });

  it("keeps exactly one scan when parallel rescans upload the same commit", async () => {
    await withReadModelDatabase(async pool => {
      const results = await Promise.all(["scan-a", "scan-b", "scan-c"].map(scanId =>
        publishScan(pool, sampleArtifact({ scanId, commit: "shared" }), { uploadedByUserId: null, rescan: true })));
      expect(results.map(result => result.status)).toEqual(["inserted", "inserted", "inserted"]);
      const { rows: survivors } = await pool.query("SELECT scan_id FROM scans");
      expect(survivors).toHaveLength(1);
      expect((await readPublishedCounts(pool, survivors[0].scan_id)).header).toMatchObject({ state: "ready", details_retained: true });
      expect((await pool.query("SELECT DISTINCT scan_id FROM scan_component_facts")).rows).toEqual(survivors);
    });
  });

  it("refuses a rescan from an older release CLI than the stored scan's and keeps the stored scan", async () => {
    await withReadModelDatabase(async pool => {
      const stored = sampleArtifact({ scanId: "scan-a", commit: "a1c9e04d2f" });
      stored.meta.scannerVersion = "0.10.0";
      await publishScan(pool, stored, { uploadedByUserId: null });
      const older = sampleArtifact({ scanId: "scan-b", commit: "a1c9e04d2f" });
      older.meta.scannerVersion = "0.9.0";
      await expect(publishScan(pool, older, { uploadedByUserId: null, rescan: true })).rejects.toMatchObject({
        code: "scanned_with_newer_cli",
        message: "Couldn't upload the scan: a1c9e04 was scanned with a newer CLI (0.10.0). Upgrade the CLI to 0.10.0 or newer, or run npx @scoutui/cli@0.10.0 scan --rescan.",
      });
      expect((await pool.query("SELECT scan_id FROM scans")).rows).toEqual([{ scan_id: "scan-a" }]);
    });
  });

  it.each([["0.9.0", "0.10.0"], ["0.10.0", "0.10.0"]])("replaces a commit's scan from release %s with a rescan from release %s", async (storedVersion, rescanVersion) => {
    await withReadModelDatabase(async pool => {
      const stored = sampleArtifact({ scanId: "scan-a", commit: "shared" });
      stored.meta.scannerVersion = storedVersion;
      await publishScan(pool, stored, { uploadedByUserId: null });
      const rescan = sampleArtifact({ scanId: "scan-b", commit: "shared" });
      rescan.meta.scannerVersion = rescanVersion;
      expect((await publishScan(pool, rescan, { uploadedByUserId: null, rescan: true })).status).toBe("inserted");
      expect((await pool.query("SELECT scan_id FROM scans")).rows).toEqual([{ scan_id: "scan-b" }]);
    });
  });

  it.each([
    ["replaces it when no rebuild is queued", false, "inserted", "scan-b"],
    ["reports it as the scan when a rebuild is queued", true, "exists", "scan-a"],
  ])("given a stored scan that can't be read, a plain upload of its commit %s", async (_, queueRebuild, status, survivor) => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, sampleArtifact({ scanId: "scan-a", commit: "shared" }), { uploadedByUserId: null });
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'scan-a'");
      if (queueRebuild) await reconcileScanJobs(pool, 10);
      const result = await publishScan(pool, sampleArtifact({ scanId: "scan-b", commit: "shared" }), { uploadedByUserId: null });
      expect([result.status, result.scanId]).toEqual([status, survivor]);
      expect((await pool.query("SELECT scan_id FROM scans")).rows).toEqual([{ scan_id: survivor }]);
    });
  });

  it("lets a snapshot CLI rescan a commit that a release CLI scanned", async () => {
    await withReadModelDatabase(async pool => {
      const stored = sampleArtifact({ scanId: "scan-a", commit: "shared" });
      stored.meta.scannerVersion = "0.10.0";
      await publishScan(pool, stored, { uploadedByUserId: null });
      const snapshot = sampleArtifact({ scanId: "scan-b", commit: "shared" });
      snapshot.meta.scannerVersion = "0.0.0-pr-752-a1c9e04-20260928120000";
      expect((await publishScan(pool, snapshot, { uploadedByUserId: null, rescan: true })).status).toBe("inserted");
      expect((await pool.query("SELECT scan_id FROM scans")).rows).toEqual([{ scan_id: "scan-b" }]);
    });
  });

  it("refuses a new scan whose repository name the dashboard has from another remote and keeps the stored scans", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, scanOfAcmeWeb("scan-a", "git@github.com:acme/web.git"), { uploadedByUserId: null });
      await expect(publishScan(pool, scanOfAcmeWeb("scan-b", "https://github.com/other/web.git"), { uploadedByUserId: null })).rejects.toMatchObject({
        code: "repo_remote_mismatch",
        message: "Couldn't upload the scan: acme/web on the dashboard comes from github.com/acme/web. Scan a clone of that repository, or choose another repoId in scout.config.json.",
      });
      expect((await pool.query("SELECT scan_id FROM scans")).rows).toEqual([{ scan_id: "scan-a" }]);
    });
  });

  it("refuses a scan of a stored commit from another remote instead of reporting it as already on the dashboard", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, scanOfAcmeWeb("scan-a", "git@github.com:acme/web.git", "shared"), { uploadedByUserId: null });
      await expect(publishScan(pool, scanOfAcmeWeb("scan-b", "https://github.com/other/web.git", "shared"), { uploadedByUserId: null }))
        .rejects.toMatchObject({ code: "repo_remote_mismatch" });
    });
  });

  it.each([
    ["in different letter case", "git@github.com:acme/web.git", "https://github.com/Acme/Web"],
    ["on different ports", "ssh://git@forge.example.com:2222/team/app.git", "https://forge.example.com:8443/team/app.git"],
  ])("accepts a new scan of the same repository over SSH and HTTPS %s", async (_, storedRemote, incomingRemote) => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, scanOfAcmeWeb("scan-a", storedRemote), { uploadedByUserId: null });
      expect((await publishScan(pool, scanOfAcmeWeb("scan-b", incomingRemote), { uploadedByUserId: null })).status).toBe("inserted");
    });
  });

  it("accepts a remote neither side can parse only when the strings are equal, and names the stored one as written", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, scanOfAcmeWeb("scan-a", "/srv/git/acme-web.git"), { uploadedByUserId: null });
      expect((await publishScan(pool, scanOfAcmeWeb("scan-b", "/srv/git/acme-web.git"), { uploadedByUserId: null })).status).toBe("inserted");
      await expect(publishScan(pool, scanOfAcmeWeb("scan-c", "/srv/git/other-web.git"), { uploadedByUserId: null })).rejects.toMatchObject({
        code: "repo_remote_mismatch",
        message: "Couldn't upload the scan: acme/web on the dashboard comes from /srv/git/acme-web.git. Scan a clone of that repository, or choose another repoId in scout.config.json.",
      });
    });
  });

  it("fills a repository's missing remote from its next scan, then refuses a scan from a third remote", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, scanOfAcmeWeb("scan-a", null), { uploadedByUserId: null });
      await publishScan(pool, scanOfAcmeWeb("scan-b", "git@github.com:acme/web.git"), { uploadedByUserId: null });
      expect((await pool.query("SELECT git_remote FROM repos")).rows).toEqual([{ git_remote: "git@github.com:acme/web.git" }]);
      await expect(publishScan(pool, scanOfAcmeWeb("scan-c", "https://github.com/other/web.git"), { uploadedByUserId: null }))
        .rejects.toMatchObject({ code: "repo_remote_mismatch" });
    });
  });

  it("still rebuilds a stored scan whose own remote differs from the repository's stored one", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, scanOfAcmeWeb("scan-a", "git@github.com:acme/web.git"), { uploadedByUserId: null });
      await pool.query("UPDATE repos SET git_remote = 'https://github.com/other/web.git'");
      expect(await republishScan(pool, "scan-a", { force: true })).toMatchObject({ status: "rebuilt" });
    });
  });

  it("leaves a repository's cleared remote empty when it rebuilds a stored scan", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, scanOfAcmeWeb("scan-a", "git@github.com:acme/web.git"), { uploadedByUserId: null });
      await pool.query("UPDATE repos SET git_remote = NULL");
      await republishScan(pool, "scan-a", { force: true });
      expect((await pool.query("SELECT git_remote FROM repos")).rows).toEqual([{ git_remote: null }]);
    });
  });

  it("doesn't bring back a scan that another publish replaced during its republish", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, sampleArtifact({ scanId: "scan-a", commit: "shared" }), { uploadedByUserId: null });
      let replaced = false;
      const racing = new Proxy(pool, {
        get(target, key) {
          if (key === "query") return async (query: string, values?: unknown[]) => {
            if (!replaced && query.startsWith("SELECT repo_id, commit_sha, scanner_version, source_upload_id FROM scans")) {
              replaced = true;
              await publishScan(target, sampleArtifact({ scanId: "scan-b", commit: "shared" }), { uploadedByUserId: null, rescan: true });
            }
            return target.query(query, values);
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(await republishScan(racing, "scan-a", {})).toBeNull();
      expect((await pool.query("SELECT scan_id FROM scans")).rows).toEqual([{ scan_id: "scan-b" }]);
    });
  });

  it("uses the winning canonical source when parallel same-ID inputs differ", async () => {
    await withReadModelDatabase(async pool => {
      const input = artifact();
      const results = await Promise.all([
        publishScan(pool, input, { uploadedByUserId: null }),
        publishScan(pool, { ...input, components: [], occurrences: [] }, { uploadedByUserId: null }),
      ]);
      expect(results.map(result => result.status).sort()).toEqual(["exists", "inserted"]);
      const stored = (await pool.query("SELECT artifact FROM scans WHERE scan_id = 'scan-a'")).rows[0].artifact;
      expect((await readPublishedCounts(pool, "scan-a")).counts.scan_component_facts).toBe(stored.components.length);
    });
  });

  it("keeps the component that renders each call, one row per rendering component, and leaves off one the scan doesn't hold", async () => {
    const validated = validateArtifact(JSON.parse(readFileSync(new URL("../../../../packages/cli/tests/integration/__baselines__/current/react-shapes.json", import.meta.url), "utf8")));
    if (!validated.ok) throw new Error(`react-shapes.json is not a valid scan: ${validated.reason}`);
    const id = (filePath: string, exportName: string) => componentKey(repoDeclaration("react-shapes", filePath, exportName));
    const unheld = validated.artifact.occurrences.find(call => call.ownerComponentId === id("src/helper-multi-caller-mixed/Views.tsx", "ViewB"));
    if (!unheld) throw new Error("react-shapes.json no longer has ViewB's call in helper-multi-caller-mixed");
    unheld.ownerComponentId = "not-in-this-scan";
    await withReadModelDatabase(async pool => {
      await publishScan(pool, validated.artifact, { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      const calls = async (componentId: string) => (await driver.getComponentUsage("react-shapes", componentId))
        .map(({ filePath, line, column, owner }) => ({ filePath, line, column, owner }));
      expect(await calls(id("src/helper-fanout-data-factory/Leaf.tsx", "Leaf"))).toEqual([
        { filePath: "src/helper-fanout-data-factory/config.tsx", line: 6, column: 10, owner: { componentId: id("src/helper-fanout-data-factory/ViewA.tsx", "ViewA"), displayName: "ViewA" } },
        { filePath: "src/helper-fanout-data-factory/config.tsx", line: 6, column: 10, owner: { componentId: id("src/helper-fanout-data-factory/ViewB.tsx", "ViewB"), displayName: "ViewB" } },
      ]);
      expect(await calls(id("src/helper-orphan-no-caller/Leaf.tsx", "Leaf"))).toEqual([
        { filePath: "src/helper-orphan-no-caller/unused.tsx", line: 4, column: 48, owner: undefined },
      ]);
      expect(await calls(id("src/helper-multi-caller-mixed/Leaf.tsx", "Leaf"))).toEqual([
        { filePath: "src/helper-multi-caller-mixed/build.tsx", line: 4, column: 44, owner: { componentId: id("src/helper-multi-caller-mixed/Views.tsx", "ViewA"), displayName: "ViewA" } },
        { filePath: "src/helper-multi-caller-mixed/build.tsx", line: 4, column: 44, owner: undefined },
      ]);
    });
  });
});

describe.skipIf(!databaseUrl)("workspace packages in the read model", { timeout: 30_000 }, () => {
  const id = (filePath: string, exportName: string) => componentKey(repoDeclaration("whole-repo-scope", filePath, exportName));
  const sharedButton = id("packages/shared-ui/src/SharedButton.tsx", "SharedButton");

  it("keeps each use's package, each component's uses per package and the scan's scope", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, baseline("whole-repo-scope"), { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      const rows = await driver.listComponentsForRepo("whole-repo-scope", "");
      expect(Object.fromEntries(rows.map(r => [r.displayName, r.usedIn]))).toEqual({
        App: undefined, Demo: undefined, Preview: undefined,
        Button: { "@example/web": { occurrenceCount: 1, fileCount: 1 }, "@example/shared-ui": { occurrenceCount: 1, fileCount: 1 } },
        SharedButton: {
          "@example/playground": { occurrenceCount: 1, fileCount: 1 },
          "@example/web": { occurrenceCount: 2, fileCount: 1 },
          "whole-repo-scope": { occurrenceCount: 1, fileCount: 1 },
        },
      });
      expect((await driver.getComponentUsage("whole-repo-scope", sharedButton)).map(({ filePath, line, usedIn }) => ({ filePath, line, usedIn }))).toEqual([
        { filePath: "apps/playground/src/Demo.tsx", line: 4, usedIn: "@example/playground" },
        { filePath: "apps/web/src/App.tsx", line: 6, usedIn: "@example/web" },
        { filePath: "apps/web/src/App.tsx", line: 7, usedIn: "@example/web" },
        { filePath: "scripts/preview.tsx", line: 4, usedIn: "whole-repo-scope" },
      ]);
      expect((await driver.getRepo("whole-repo-scope"))?.scope).toEqual({
        folder: "", exclude: [],
        packages: [
          { name: "whole-repo-scope", folder: "" },
          { name: "@example/playground", folder: "apps/playground" },
          { name: "@example/web", folder: "apps/web" },
          { name: "@example/shared-ui", folder: "packages/shared-ui" },
        ],
      });
    });
  });

  it("reads a scan with no scope and no packages on its uses", async () => {
    const { meta: { scope: _scope, ...meta }, occurrences, ...rest } = baseline("whole-repo-scope");
    const scan: ScanArtifact = { ...rest, meta, occurrences: occurrences.map(({ usedIn: _usedIn, ...call }) => call) };
    await withReadModelDatabase(async pool => {
      await publishScan(pool, scan, { uploadedByUserId: null });
      const driver = new PostgresDriver(pool);
      expect(Object.fromEntries((await driver.listComponentsForRepo("whole-repo-scope", "")).map(r => [r.displayName, r.usedIn]))).toStrictEqual({
        App: undefined, Button: undefined, Demo: undefined, Preview: undefined, SharedButton: undefined,
      });
      expect((await driver.getComponentUsage("whole-repo-scope", sharedButton)).map(({ filePath, line, usedIn }) => ({ filePath, line, usedIn }))).toEqual([
        { filePath: "apps/playground/src/Demo.tsx", line: 4, usedIn: undefined },
        { filePath: "apps/web/src/App.tsx", line: 6, usedIn: undefined },
        { filePath: "apps/web/src/App.tsx", line: 7, usedIn: undefined },
        { filePath: "scripts/preview.tsx", line: 4, usedIn: undefined },
      ]);
      expect((await driver.getRepo("whole-repo-scope"))?.scope).toBeNull();
    });
  });
});

describe.skipIf(!databaseUrl)("what a scan couldn't see", { timeout: 30_000 }, () => {
  it.each([
    ["react-shapes", [
      { kind: "import-not-found", count: 2, examples: [{ text: "ds-icons", count: 2 }], more: 0 },
      { kind: "not-imported", count: 1, examples: [{ text: "Disclosure", count: 1 }], more: 0 },
      { kind: "not-matched", count: 4, examples: [{ text: "Alias", count: 1 }, { text: "Read", count: 1 }, { text: "Shown", count: 1 }], more: 1 },
      { kind: "passed-in", count: 5, examples: [{ text: "C", count: 2 }, { text: "Child", count: 1 }, { text: "Component", count: 1 }], more: 1 },
    ]],
    ["unresolved-install", [{ kind: "package-not-installed", count: 1, examples: [{ text: "@example/ui", count: 1 }], more: 0 }]],
    ["design-system-upgrade", [{ kind: "package-exports", count: 1, examples: [{ text: "@example/loop-kit", count: 1 }], more: 0 }]],
  ])("reads back what the %s scan couldn't see", async (name, findings) => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, baseline(name), { uploadedByUserId: null });
      expect((await new PostgresDriver(pool).getRepo(name))?.findings).toEqual(findings);
    });
  });
});

describe.skipIf(!databaseUrl)("large scan publication", { timeout: 30_000 }, () => {
  it("publishes every row of a scan past a single insert's bind-parameter and call-stack limits", async () => {
    await withReadModelDatabase(async pool => {
      const components = Array.from({ length: 15_000 }, (_, i) => component(packageExport("@x/p", `C${i}`)));
      const scan = v2Artifact({ scanId: "scan-large", repoId: "repo-large", components, occurrences: [] });
      expect((await publishScan(pool, scan, { uploadedByUserId: null })).status).toBe("inserted");
      const { header, counts } = await readPublishedCounts(pool, "scan-large");
      expect(counts).toMatchObject({ scan_component_facts: 15_000 });
      expect(header).toMatchObject({ state: "ready" });
      expect(header.expected_counts).toEqual(header.actual_counts);
    });
  });
});

async function claimUpload(pool: Pool, value: unknown) {
  const uploadId = await receiveArtifact(pool, value);
  const job = await claimScanJob(pool, "publisher") as ClaimedScanJob;
  expect(job.uploadId).toBe(uploadId);
  return { uploadId, options: { uploadedByUserId: null, sourceUploadId: uploadId, guard: { jobId: job.id, leaseToken: job.leaseToken } } };
}
async function receiptOf(pool: Pool, uploadId: string) {
  return (await pool.query("SELECT state, scan_id, error_code FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows[0];
}

describe.skipIf(!databaseUrl)("upload-backed publication", { timeout: 30_000 }, () => {
  it("stores verified metadata with the archive locator instead of artifact JSON", async () => {
    await withReadModelDatabase(async pool => {
      const { uploadId, options } = await claimUpload(pool, artifact());
      expect(await publishScan(pool, artifact(), options)).toEqual({ status: "inserted", scanId: "scan-a", revision: 1 });
      expect((await pool.query("SELECT artifact, source_upload_id, repo_id, commit_sha FROM scans")).rows).toEqual([{ artifact: null, source_upload_id: uploadId, repo_id: "repo-a", commit_sha: "commit-scan-a" }]);
      expect(await receiptOf(pool, uploadId)).toEqual({ state: "ready", scan_id: "scan-a", error_code: null });
      expect((await readPublishedCounts(pool, "scan-a")).header).toMatchObject({ state: "ready", projection_version: PROJECTION_VERSION });
    });
  });

  it("rebuilds an archive-backed scan from its stored archive, not the caller's input", async () => {
    await withReadModelDatabase(async pool => {
      const { options } = await claimUpload(pool, artifact());
      await publishScan(pool, artifact(), options);
      await pool.query("DELETE FROM scan_component_facts WHERE scan_id = 'scan-a'");
      const replacement = { ...artifact(), components: [], occurrences: [] };
      expect(await publishScan(pool, replacement, { uploadedByUserId: null })).toMatchObject({ status: "rebuilt", revision: 2 });
      expect((await readPublishedCounts(pool, "scan-a")).counts).toMatchObject({ scan_component_facts: 1 });
    });
  });

  it("keeps the replaced scan, its upload and its chunks when a same-commit publish fails", async () => {
    await withReadModelDatabase(async pool => {
      const first = await claimUpload(pool, sampleArtifact({ scanId: "scan-a", commit: "shared" }));
      await publishScan(pool, sampleArtifact({ scanId: "scan-a", commit: "shared" }), first.options);
      const stored = async () => ({
        published: await readPublishedCounts(pool, "scan-a"),
        upload: await receiptOf(pool, first.uploadId),
        chunks: (await pool.query("SELECT count(*)::int AS n FROM scan_artifact_chunks WHERE upload_id = $1", [first.uploadId])).rows[0].n,
      });
      const before = await stored();
      expect(before.chunks).toBeGreaterThan(0);
      await expect(publishWithInjectedBatchFailure(pool, sampleArtifact({ scanId: "scan-b", commit: "shared" }), async () => {}, { uploadedByUserId: null, rescan: true }))
        .rejects.toThrow("Injected second INSERT failure");
      expect(await stored()).toEqual(before);
      expect((await readPublishedCounts(pool, "scan-b")).counts.scans).toBe(0);
    });
  });
});
