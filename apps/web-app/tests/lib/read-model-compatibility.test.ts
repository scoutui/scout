import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresDriver, PROJECTION_VERSION } from "@scoutui/web-shared";
import { claimScanJob, enqueueScanJob, failScanJob, SCAN_JOB_PRIORITY, setScanJobStage } from "@/lib/scan-jobs";
import { publishScan } from "@/lib/scan-projection";
import { readModelPage } from "@/lib/read-model-page";
import { chartResultsUnavailable } from "@/lib/read-model-progress";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { sampleArtifact } from "../helpers/scan-artifact";

const db: { pool: Pool | null } = { pool: null };
vi.mock("@/db/client", () => ({ getPool: () => db.pool }));

// biome-ignore lint/complexity/useLiteralKeys: env access
const databaseUrl = process.env["DATABASE_URL"];

describe.skipIf(!databaseUrl)("scoped read model availability", { timeout: 30_000 }, () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  beforeAll(async () => { database = openReadModelDatabase(); pool = await database.pool; db.pool = pool; });
  beforeEach(async () => {
    await pool.query("TRUNCATE repos, scan_uploads, scan_jobs CASCADE");
    await publishScan(pool, sampleArtifact({ scanId: "ready-scan", repoId: "ready-repo" }), { uploadedByUserId: null });
    await publishScan(pool, sampleArtifact({ scanId: "broken-scan", repoId: "broken-repo" }), { uploadedByUserId: null });
    await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'broken-scan'");
    const client = await pool.connect();
    try { await enqueueScanJob(client, "broken-scan", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
  });
  afterAll(async () => { await database.close(); });

  async function claimBrokenScan() {
    const job = await claimScanJob(pool, "test");
    if (job?.scanId !== "broken-scan") throw new Error("Expected the broken scan's job");
    return job;
  }

  const page = (repoId: string) => readModelPage(new PostgresDriver(pool), snapshot => snapshot.getRepo(repoId));

  const broken = { scanId: "broken-scan", repoId: "broken-repo", commit: "commit-broken-scan" };

  it("reports a failed rebuild as failed and not retryable, with the scan's repo and commit", async () => {
    await failScanJob(pool, await claimBrokenScan(), { code: "projection_failed", message: "Projection failed" });
    expect(await page("broken-repo")).toEqual({ state: "failed", scans: [broken], retryable: false });
    expect(await page("ready-repo")).toMatchObject({ state: "ready", value: { repoId: "ready-repo" } });
  });

  it("reports a rebuild in progress as preparing without listing scans", async () => {
    await setScanJobStage(pool, await claimBrokenScan(), "publishing");
    expect(await page("broken-repo")).toEqual({ state: "preparing", scans: [], retryable: true });
    expect(await page("ready-repo")).toMatchObject({ state: "ready", value: { repoId: "ready-repo" } });
  });

  const waiting = { scanId: "waiting-scan", repoId: "waiting-repo", commit: "commit-waiting-scan" };

  async function publishWaitingRepo() {
    await publishScan(pool, sampleArtifact({ scanId: "waiting-scan", repoId: "waiting-repo" }), { uploadedByUserId: null });
    await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'waiting-scan'");
  }

  it.each([
    { state: "failed", message: "Projection failed" },
    { state: "degraded", message: "degraded: unknown_format" },
  ] as const)("leaves a repo whose only scan is $state out of /repos, and a repo whose first scan is being prepared", async ({ state, message }) => {
    await failScanJob(pool, await claimBrokenScan(), { code: "projection_failed", message });
    await publishWaitingRepo();
    const repos = await readModelPage(new PostgresDriver(pool), snapshot => snapshot.listRepos());
    expect(repos).toMatchObject({ state: "ready", value: [{ repoId: "ready-repo" }], gaps: [] });
    expect(repos.state === "ready" && repos.fallbacks).toEqual([
      { repoId: "broken-repo", state, latest: broken, shown: null },
      { repoId: "waiting-repo", state: "preparing", latest: waiting, shown: null },
    ]);
  });

  it("shows the full-page failed state on /repos when every repo is left out", async () => {
    await failScanJob(pool, await claimBrokenScan(), { code: "projection_failed", message: "Projection failed" });
    await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'ready-scan'");
    await pool.query("INSERT INTO scan_jobs (id, scan_id, projection_version, kind, state) VALUES ('ready-job', 'ready-scan', 1, 'scan', 'failed')");
    expect(await readModelPage(new PostgresDriver(pool), snapshot => snapshot.listRepos())).toEqual({
      state: "failed", scans: [broken, { scanId: "ready-scan", repoId: "ready-repo", commit: "commit-ready-scan" }], retryable: false,
    });
  });

  it("waits on /repos while a repo with no ready scan is being rebuilt", async () => {
    await pool.query("UPDATE scan_read_models SET format_version = format_version + 1 WHERE scan_id = 'ready-scan'");
    expect(await readModelPage(new PostgresDriver(pool), snapshot => snapshot.listRepos())).toEqual({ state: "preparing", scans: [], retryable: true });
  });

  it.each(["preparing", "failed", "degraded"] as const)("shows a repo at its newest ready scan while a newer one is %s", async state => {
    await pool.query("DELETE FROM scan_jobs WHERE scan_id = 'broken-scan'");
    await publishScan(pool, sampleArtifact({ scanId: "newer-scan", repoId: "ready-repo", scannedAt: "2026-09-20T00:00:00Z" }), { uploadedByUserId: null });
    await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'newer-scan'");
    const client = await pool.connect();
    try { await enqueueScanJob(client, "newer-scan", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
    const job = await claimScanJob(pool, "test");
    if (job?.scanId !== "newer-scan") throw new Error("Expected the newer scan's job");
    if (state !== "preparing") await failScanJob(pool, job, { code: "projection_failed", message: state === "degraded" ? "degraded: unknown_format" : "Projection failed" });
    expect(await page("ready-repo")).toMatchObject({
      state: "ready", value: { scanId: "ready-scan" }, gaps: [],
      fallbacks: [{
        repoId: "ready-repo", state, latest: { scanId: "newer-scan", repoId: "ready-repo", commit: "commit-newer-scan" },
        shown: { commit: "commit-ready-scan", committedAt: "2026-09-19T00:00:00.000Z" },
      }],
    });
  });

  it("keeps an unknown repo ready and empty", async () => {
    expect(await page("unknown-repo")).toEqual({ state: "ready", value: null, fallbacks: [], gaps: [] });
  });

  it("reports missing chart results as preparing while a scan rebuild is pending", async () => {
    expect(await chartResultsUnavailable(pool)).toEqual({ state: "preparing", scans: [], retryable: true });
  });

  it("reports missing chart results as failed with each scan whose rebuild failed", async () => {
    await failScanJob(pool, await claimBrokenScan(), { code: "projection_failed", message: "Projection failed" });
    expect(await chartResultsUnavailable(pool)).toEqual({ state: "failed", scans: [broken], retryable: false });
  });

  it("lists a repo's failed newest scan for chart results, but not a failed older one", async () => {
    await failScanJob(pool, await claimBrokenScan(), { code: "projection_failed", message: "Projection failed" });
    await publishScan(pool, sampleArtifact({ scanId: "newer-scan", repoId: "ready-repo", scannedAt: "2026-09-20T00:00:00Z" }), { uploadedByUserId: null });
    await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'ready-scan'");
    await pool.query(`INSERT INTO scan_jobs (id, scan_id, projection_version, kind, state) VALUES ('older-job', 'ready-scan', 1, 'scan', 'failed')`);
    expect(await chartResultsUnavailable(pool)).toEqual({ state: "failed", scans: [broken], retryable: false });
  });

  it("reports chart results as failed for a ready header with mismatched counts whose newest job failed", async () => {
    await pool.query("DELETE FROM scan_jobs");
    await pool.query(`UPDATE scan_read_models SET actual_counts = actual_counts || '{"repo": 0}' WHERE scan_id = 'ready-scan'`);
    const client = await pool.connect();
    try { await enqueueScanJob(client, "ready-scan", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
    const job = await claimScanJob(pool, "test");
    if (job?.scanId !== "ready-scan") throw new Error("Expected the ready scan's job");
    await failScanJob(pool, job, { code: "projection_failed", message: "Projection failed" });
    expect((await pool.query("SELECT state FROM scan_read_models WHERE scan_id = 'ready-scan'")).rows).toEqual([{ state: "ready" }]);
    expect(await chartResultsUnavailable(pool)).toEqual({ state: "failed", scans: [{ scanId: "ready-scan", repoId: "ready-repo", commit: "commit-ready-scan" }], retryable: false });
  });

  it("reports missing chart results as failed when the newest results job failed", async () => {
    await pool.query("DELETE FROM scan_jobs WHERE kind <> 'results'");
    const job = await claimScanJob(pool, "test");
    if (job?.kind !== "results") throw new Error("Expected the results job");
    await failScanJob(pool, job, { code: "results_failed", message: "Results failed" });
    expect(await chartResultsUnavailable(pool)).toEqual({ state: "failed", scans: [], retryable: false });
  });
});
