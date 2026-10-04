import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION, type ScanArtifact } from "@scoutui/scan-format";
import type { Identity } from "@/lib/access";
import { resetRateLimitState } from "@/lib/rate-limit";
import { claimScanJob, getUploadStatus, type ClaimedScanJob } from "@/lib/scan-jobs";
import { publishScan } from "@/lib/scan-projection";
import { processScanJob } from "@/worker/runner";
import { openReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

const db = vi.hoisted(() => ({ pool: undefined as Pool | undefined }));
vi.mock("@/db/client", () => ({ getPool: () => db.pool }));
const identity = vi.hoisted(() => ({ value: null as Identity | null }));
vi.mock("@/lib/identity", () => ({ identify: vi.fn(async () => identity.value) }));

import { POST } from "@/app/api/scans/preflight/route";

const editor: Identity = { kind: "person", userId: "u1", email: "ana@example.com", name: null, role: "editor", roleSource: "people" };

const cliVersion: string = JSON.parse(readFileSync(new URL("../../../../packages/cli/package.json", import.meta.url), "utf8")).version;

function request(body: unknown) {
  return new Request("http://x/api/scans/preflight", {
    method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function scanOf(scanId: string, { commit = "a1c9e04d2f", remote = "git@github.com:acme/web.git", scannerVersion, schemaVersion }: {
  commit?: string; remote?: string | null; scannerVersion?: string; schemaVersion?: number;
} = {}): ScanArtifact {
  const scan = sampleArtifact({ scanId, repoId: "acme/web", commit });
  scan.meta.repo.gitRemote = remote;
  if (scannerVersion) scan.meta.scannerVersion = scannerVersion;
  if (schemaVersion !== undefined) Object.assign(scan.meta, { schemaVersion });
  return scan;
}

function checkOf(scan: ScanArtifact, rescan: boolean) {
  const { meta } = scan;
  return {
    repoId: meta.repo.id, remote: meta.repo.gitRemote, scanner: meta.scannerName, scannerVersion: meta.scannerVersion,
    schemaVersion: meta.schemaVersion, rescan, commits: [meta.repo.commit],
  };
}

const { DATABASE_URL: databaseUrl } = process.env;

describe("POST /api/scans/preflight without the database", () => {
  beforeEach(() => { identity.value = editor; db.pool = undefined; resetRateLimitState(); });

  it("refuses a request without a bearer", async () => {
    identity.value = null;
    const response = await POST(request(checkOf(scanOf("scan-a"), false)));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("refuses a request for more than 500 commits", async () => {
    const response = await POST(request({ ...checkOf(scanOf("scan-a"), false), commits: Array.from({ length: 501 }, (_, index) => `commit-${index}`) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid request body" });
  });

  it("says which scan formats it reads when it refuses a scan in another format", async () => {
    const response = await POST(request(checkOf(scanOf("scan-a", { schemaVersion: SCHEMA_VERSION + 1 }), false)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ refusal: { code: "unsupported_version" }, scanFormats: [SCHEMA_VERSION] });
  });
});

describe.skipIf(!databaseUrl)("POST /api/scans/preflight", { timeout: 30_000 }, () => {
  const database = databaseUrl ? openReadModelDatabase() : undefined;
  let pool: Pool;
  beforeAll(async () => { pool = await (database as NonNullable<typeof database>).pool; }, 30_000);
  afterAll(async () => { await database?.close(); }, 30_000);
  beforeEach(async () => {
    db.pool = pool;
    identity.value = editor;
    resetRateLimitState();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await pool.query("TRUNCATE repos, scan_uploads, scan_jobs CASCADE");
  });
  afterEach(() => vi.restoreAllMocks());

  /** The pre-scan check's answer for the scan's commit, with a refusal of the whole scan as that commit's answer. */
  async function checked(scan: ScanArtifact, rescan: boolean) {
    const response = await POST(request(checkOf(scan, rescan)));
    expect(response.status).toBe(200);
    const { refusal, commits } = await response.json();
    if (refusal) {
      expect(commits).toEqual([]);
      return { commit: scan.meta.repo.commit, decision: "refuse", ...refusal };
    }
    expect(commits).toHaveLength(1);
    return commits[0];
  }

  /** What a real upload of the scan did, in the pre-scan check's terms. */
  async function uploaded(scan: ScanArtifact, rescan: boolean) {
    const uploadId = await receiveArtifact(pool, scan, { rescan });
    await processScanJob(pool, await claimScanJob(pool, "preflight-test") as ClaimedScanJob, new AbortController().signal);
    const status = await getUploadStatus(pool, uploadId);
    const commit = scan.meta.repo.commit;
    if (status?.state === "ready") return { commit, decision: "upload" };
    if (status?.state === "duplicate") return { commit, decision: "skip", url: status.url };
    if (status?.state === "failed") return { commit, decision: "refuse", ...status.error };
    return status;
  }

  type Row = {
    stored: ScanArtifact[];
    readModelsGone?: boolean;
    incoming: ScanArtifact;
    rescan?: boolean;
    expected: { decision: "upload" } | { decision: "skip" } | { decision: "refuse"; code: string; message?: string };
    checkedMessage?: string;
  };

  it.each<[string, Row]>([
    ["a new commit", {
      stored: [scanOf("scan-a", { commit: "0b5d7e1f3a" })], incoming: scanOf("scan-b"), expected: { decision: "upload" },
    }],
    ["a stored commit with a ready read model", {
      stored: [scanOf("scan-a")], incoming: scanOf("scan-b"), expected: { decision: "skip" },
    }],
    ["a stored commit whose read model is gone and no rebuild is queued", {
      stored: [scanOf("scan-a")], readModelsGone: true, incoming: scanOf("scan-b"), expected: { decision: "upload" },
    }],
    ["a rescan from the same CLI version", {
      stored: [scanOf("scan-a", { scannerVersion: "0.10.0" })], incoming: scanOf("scan-b", { scannerVersion: "0.10.0" }), rescan: true,
      expected: { decision: "upload" },
    }],
    ["a rescan from a newer CLI", {
      stored: [scanOf("scan-a", { scannerVersion: "0.9.0" })], incoming: scanOf("scan-b", { scannerVersion: "0.10.0" }), rescan: true,
      expected: { decision: "upload" },
    }],
    ["a rescan from an older CLI", {
      stored: [scanOf("scan-a", { scannerVersion: "0.10.0" })], incoming: scanOf("scan-b", { scannerVersion: "0.9.0" }), rescan: true,
      expected: {
        decision: "refuse", code: "scanned_with_newer_cli",
        message: "Couldn't upload the scan: a1c9e04 was scanned with a newer CLI (0.10.0). Upgrade the CLI to 0.10.0 or newer, or run npx @scoutui/cli@0.10.0 scan --rescan.",
      },
    }],
    ["a rescan from release 0.10.0 of a commit scanned by 0.10.0-rc.1", {
      stored: [scanOf("scan-a", { scannerVersion: "0.10.0-rc.1" })], incoming: scanOf("scan-b", { scannerVersion: "0.10.0" }), rescan: true,
      expected: { decision: "upload" },
    }],
    ["a repository name the dashboard has from another remote", {
      stored: [scanOf("scan-a", { commit: "0b5d7e1f3a" })], incoming: scanOf("scan-b", { remote: "https://github.com/other/web.git" }),
      expected: { decision: "refuse", code: "repo_remote_mismatch" },
    }],
    ["a repository name the dashboard has from another remote, for a commit it already has", {
      stored: [scanOf("scan-a")], incoming: scanOf("scan-b", { remote: "https://github.com/other/web.git" }),
      expected: { decision: "refuse", code: "repo_remote_mismatch" },
    }],
    ["a stored null remote", {
      stored: [scanOf("scan-a", { commit: "0b5d7e1f3a", remote: null })], incoming: scanOf("scan-b"), expected: { decision: "upload" },
    }],
    ["an incoming null remote", {
      stored: [scanOf("scan-a", { commit: "0b5d7e1f3a" })], incoming: scanOf("scan-b", { remote: null }), expected: { decision: "upload" },
    }],
    ["an older scan format", {
      stored: [], incoming: scanOf("scan-b", { schemaVersion: 1 }),
      expected: {
        decision: "refuse", code: "unsupported_version",
        message: "Couldn't upload the scan: this CLI is too old for the dashboard. Upgrade the CLI and try again.",
      },
      checkedMessage: `Couldn't upload the scan: this CLI is too old for the dashboard. Upgrade the CLI to ${cliVersion}, or run npx @scoutui/cli@${cliVersion} scan.`,
    }],
    ["a newer scan format", {
      stored: [], incoming: scanOf("scan-b", { schemaVersion: SCHEMA_VERSION + 1 }),
      expected: {
        decision: "refuse", code: "unsupported_version",
        message: "Couldn't upload the scan: this CLI is newer than the dashboard. Ask your dashboard administrator to upgrade it.",
      },
      checkedMessage: `Couldn't upload the scan: this CLI is newer than the dashboard. Ask your dashboard administrator to upgrade it, or run npx @scoutui/cli@${cliVersion} scan.`,
    }],
  ])("gives the upload's answer for %s", async (_, { stored, readModelsGone, incoming, rescan = false, expected, checkedMessage }) => {
    for (const scan of stored) await publishScan(pool, scan, { uploadedByUserId: null });
    if (readModelsGone) await pool.query("DELETE FROM scan_read_models");
    const answer = await checked(incoming, rescan);
    const outcome = await uploaded(incoming, rescan);
    expect(outcome).toMatchObject(expected);
    expect(answer).toEqual(checkedMessage ? { ...outcome, message: checkedMessage } : outcome);
  });

  it("answers each of several commits in request order, as their uploads do", async () => {
    await publishScan(pool, scanOf("scan-a"), { uploadedByUserId: null });
    const newCommit = scanOf("scan-b", { commit: "0b5d7e1f3a" });
    const storedCommit = scanOf("scan-c");
    const response = await POST(request({ ...checkOf(newCommit, false), commits: ["0b5d7e1f3a", "a1c9e04d2f"] }));
    expect(response.status).toBe(200);
    const { commits } = await response.json();
    const outcomes = [await uploaded(newCommit, false), await uploaded(storedCommit, false)];
    expect(outcomes).toMatchObject([{ commit: "0b5d7e1f3a", decision: "upload" }, { commit: "a1c9e04d2f", decision: "skip" }]);
    expect(commits).toEqual(outcomes);
  });

  it("answers a valid request that carries a field it doesn't know", async () => {
    const response = await POST(request({ ...checkOf(scanOf("scan-b"), false), branch: "main" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ refusal: null, commits: [{ commit: "a1c9e04d2f", decision: "upload" }], warning: null, scanFormats: [SCHEMA_VERSION] });
  });
});
