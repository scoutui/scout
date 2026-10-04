import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresDriver } from "@scoutui/web-shared";
import { deleteRepo, removeScan } from "@/app/repos/repo-actions";
import { getPool } from "@/db/client";
import { REPO_ADMIN_REFUSAL } from "@/lib/access";
import { claimScanJob, getUploadStatus } from "@/lib/scan-jobs";
import { listRemovals } from "@/lib/scan-removal";
import { processScanJob } from "@/worker/runner";
import { insertPerson } from "../helpers/people";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => session.current) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => navigation);

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;

const HISTORY_CHANGED = { ok: false, error: "The scan history has changed since the page loaded. Reload to see it." };

describe.skipIf(!RUN_DB)("removing scans and deleting repos against PostgreSQL", { timeout: 30_000 }, () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  let admin: string;

  const signInAs = (userId: string) => {
    session.current = { user: { id: userId } };
  };
  const runJobs = async () => {
    for (let job = await claimScanJob(pool, "test"); job; job = await claimScanJob(pool, "test")) {
      await processScanJob(pool, job, new AbortController().signal);
    }
  };
  const upload = async (scanId: string, day: number, repoId = "repo-a", gitRemote = `https://github.com/example/${repoId}`) => {
    const scan = sampleArtifact({ scanId, repoId });
    scan.meta.repo.committedAt = `2026-09-0${day}T00:00:00.000Z`;
    scan.meta.repo.gitRemote = gitRemote;
    const uploadId = await receiveArtifact(pool, scan);
    await runJobs();
    return uploadId;
  };
  const stored = async () => (await pool.query(`SELECT
      (SELECT array_agg(repo_id ORDER BY repo_id) FROM repos) AS repos,
      (SELECT array_agg(scan_id ORDER BY scan_id) FROM scans) AS scans,
      (SELECT array_agg(upload_id ORDER BY upload_id) FROM scan_uploads) AS uploads,
      (SELECT array_agg(DISTINCT upload_id ORDER BY upload_id) FROM scan_artifact_chunks) AS archives,
      (SELECT array_agg(scan_id ORDER BY scan_id) FROM scan_read_models) AS read_models`)).rows[0];
  const details = async (scanId: string) => (await pool.query(`SELECT details_retained AS retained,
      (SELECT count(*)::int FROM scan_component_details WHERE scan_id = $1) AS rows
    FROM scan_read_models WHERE scan_id = $1`, [scanId])).rows[0];
  const queuedJobs = async () =>
    (await pool.query("SELECT kind, scan_id FROM scan_jobs WHERE state = 'queued' ORDER BY kind")).rows;

  beforeAll(async () => {
    database = openReadModelDatabase();
    pool = await database.pool;
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
  });

  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
    vi.stubEnv("SCOUTUI_ADMINS", undefined);
    vi.stubEnv("SCOUTUI_ADMIN_GROUP", undefined);
    admin = await insertPerson(pool, { email: "ana@example.com", role: "admin" });
    signInAs(admin);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    session.current = null;
    navigation.redirect.mockClear();
    await pool.query("DELETE FROM scans");
    await pool.query("DELETE FROM scan_uploads");
    await pool.query("DELETE FROM scan_jobs");
    await pool.query("DELETE FROM repos");
    await pool.query("DELETE FROM removals");
    await pool.query('DELETE FROM "user"');
  });

  afterAll(async () => {
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  it("removes the latest scan with its upload and archive, and the previous scan becomes the latest and gets its details back", async () => {
    const older = await upload("scan-a", 1);
    await upload("scan-b", 2);
    expect(await details("scan-a")).toEqual({ retained: false, rows: 0 });

    expect(await removeScan("repo-a", "scan-b")).toEqual({ ok: true });

    expect(await stored()).toEqual({ repos: ["repo-a"], scans: ["scan-a"], uploads: [older], archives: [older], read_models: ["scan-a"] });
    expect((await new PostgresDriver(pool).getRepo("repo-a"))?.scanId).toBe("scan-a");
    expect(await queuedJobs()).toEqual([{ kind: "results", scan_id: null }, { kind: "scan", scan_id: "scan-a" }]);
    await runJobs();
    expect(await details("scan-a")).toEqual({ retained: true, rows: 1 });
    expect(await listRemovals(pool, 20)).toEqual([
      expect.objectContaining({ actorEmail: "ana@example.com", repoId: "repo-a", commitSha: "commit-scan-b", scanCount: null }),
    ]);
  });

  it("removes an older scan and leaves the latest scan's details alone", async () => {
    await upload("scan-a", 1);
    const latest = await upload("scan-b", 2);

    expect(await removeScan("repo-a", "scan-a")).toEqual({ ok: true });

    expect(await stored()).toEqual({ repos: ["repo-a"], scans: ["scan-b"], uploads: [latest], archives: [latest], read_models: ["scan-b"] });
    expect(await queuedJobs()).toEqual([{ kind: "results", scan_id: null }]);
    expect(await details("scan-b")).toEqual({ retained: true, rows: 1 });
  });

  it("deletes a repo with all its scans, uploads and archives, records it, and takes a scan of that name from another remote afterwards", async () => {
    await upload("scan-a", 1);
    await upload("scan-b", 2);
    const other = await upload("scan-c", 1, "repo-b");

    expect(await deleteRepo("repo-a")).toBeUndefined();

    expect(navigation.redirect).toHaveBeenCalledWith("/repos");
    expect(await stored()).toEqual({ repos: ["repo-b"], scans: ["scan-c"], uploads: [other], archives: [other], read_models: ["scan-c"] });
    expect(await queuedJobs()).toEqual([{ kind: "results", scan_id: null }]);
    expect(await listRemovals(pool, 20)).toEqual([
      expect.objectContaining({ actorEmail: "ana@example.com", repoId: "repo-a", commitSha: null, scanCount: 2 }),
    ]);

    const again = await upload("scan-d", 3, "repo-a", "https://github.com/example/forked-repo-a");
    expect(await getUploadStatus(pool, again)).toMatchObject({ state: "ready", scanId: "scan-d" });
  });

  it("refuses someone signed out, a Viewer and an Editor and keeps everything", async () => {
    await upload("scan-a", 1);
    await upload("scan-b", 2);
    const before = await stored();
    const viewer = await insertPerson(pool, { email: "bo@example.com" });
    const editor = await insertPerson(pool, { email: "cy@example.com", role: "editor" });

    session.current = null;
    expect(await removeScan("repo-a", "scan-b")).toEqual({ ok: false, error: "not_authenticated" });
    expect(await deleteRepo("repo-a")).toEqual({ ok: false, error: "not_authenticated" });
    for (const person of [viewer, editor]) {
      signInAs(person);
      expect(await removeScan("repo-a", "scan-b")).toEqual({ ok: false, error: REPO_ADMIN_REFUSAL });
      expect(await deleteRepo("repo-a")).toEqual({ ok: false, error: REPO_ADMIN_REFUSAL });
    }

    expect(await stored()).toEqual(before);
    expect(await listRemovals(pool, 20)).toEqual([]);
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["the repo's only scan", "repo-b", "scan-c"],
    ["a scan of another repo", "repo-a", "scan-c"],
    ["a scan that has gone", "repo-a", "scan-z"],
  ])("keeps %s and says the scan history has changed", async (_, repoId, scanId) => {
    await upload("scan-a", 1);
    await upload("scan-b", 2);
    await upload("scan-c", 1, "repo-b");
    const before = await stored();

    expect(await removeScan(repoId, scanId)).toEqual(HISTORY_CHANGED);

    expect(await stored()).toEqual(before);
    expect(await listRemovals(pool, 20)).toEqual([]);
  });

  it("goes to the repos list without recording anything when the repo has already gone", async () => {
    expect(await deleteRepo("repo-z")).toBeUndefined();
    expect(navigation.redirect).toHaveBeenCalledWith("/repos");
    expect(await listRemovals(pool, 20)).toEqual([]);
  });
});
