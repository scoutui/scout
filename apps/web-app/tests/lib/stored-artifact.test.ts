import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { validateArtifact } from "@scoutui/scan-format";
import { PostgresDriver, PROJECTION_VERSION, type StorageDriver } from "@scoutui/web-shared";
import { decodeCanonicalSource, readStoredArtifact } from "@/lib/stored-artifact";
import { claimScanJob, enqueueScanJob, SCAN_JOB_PRIORITY } from "@/lib/scan-jobs";
import { republishScan } from "@/lib/scan-projection";
import { processScanJob } from "@/worker/runner";
import { withReadModelDatabase } from "../helpers/read-model-db";
import { receiveArtifact, sampleArtifact } from "../helpers/scan-artifact";

vi.mock("@scoutui/scan-format", async importOriginal => {
  const original = await importOriginal<typeof import("@scoutui/scan-format")>();
  return { ...original, validateArtifact: vi.fn(original.validateArtifact) };
});
let database: Pool;
let driver: StorageDriver;
vi.mock("@/db/client", () => ({ getPool: () => database }));
vi.mock("@/lib/storage", () => ({ getStorage: () => driver }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/identity", () => ({ identify: async () => null }));

const v1Artifact = {
  meta: { scanId: "scan-a", scannerVersion: "0", scannedAt: "2026-09-19T00:00:00Z", repo: { id: "repo-a", commit: "abc", branch: null, gitRemote: null, initialCommit: null } },
  components: [{ id: "button", logicalId: "logical-button", identity: { scope: "external", kind: "react-component", packageName: "@sample/core", exportName: "Button" }, stats: { occurrenceCount: 1, fileCount: 1 }, usage: "direct", manifest: null, version: null, props: {}, createdAt: null, updatedAt: null }],
  occurrences: [{ occurrenceId: "call", componentId: "button", filePath: "src/view.tsx", line: 1, column: 2, props: {}, depth: 0, viaChain: [], via: { kind: "direct-import", specifier: "@sample/core", import: "Button" } }],
  relationships: [{ sourceId: "button", type: "wraps", target: { logicalKey: "other" } }],
  diagnostics: [],
};

async function seedScan(pool: Pool, value: unknown, uploadId: string | null = null) {
  await pool.query("INSERT INTO repos (repo_id) VALUES ('repo-a')");
  await pool.query(`INSERT INTO scans (scan_id, repo_id, committed_at, commit_sha, branch, scanner_version, artifact, source_upload_id)
    VALUES ('scan-a', 'repo-a', '2026-09-19T00:00:00Z', 'commit-scan-a', NULL, '0', $1, $2)`,
  [uploadId ? null : JSON.stringify(value), uploadId]);
}

const { DATABASE_URL: databaseUrl } = process.env;
describe.skipIf(!databaseUrl)("version-aware canonical sources", { timeout: 30_000 }, () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["v2", sampleArtifact(), { version: 2, artifact: sampleArtifact() }],
    ["v1", v1Artifact, { unknown: true, version: 1, reason: "unsupported_version" }],
    ["future", { ...sampleArtifact(), meta: { ...sampleArtifact().meta, schemaVersion: 3 } }, { unknown: true, version: 3, reason: "unsupported_version" }],
    ["non-numeric", { ...sampleArtifact(), meta: { ...sampleArtifact().meta, schemaVersion: "two" } }, { unknown: true, version: "invalid", reason: "invalid_artifact" }],
  ])("decodes %s from uploads and legacy columns without validation", async (_, value, expected) => {
    await withReadModelDatabase(async pool => {
      const uploadId = await receiveArtifact(pool, value);
      await seedScan(pool, value);
      const client = await pool.connect();
      try {
        expect(await decodeCanonicalSource(client, { uploadId }, 1024 * 1024)).toEqual(expected);
        expect(await decodeCanonicalSource(client, { scanId: "scan-a" }, 1024 * 1024)).toEqual(expected);
        expect(await readStoredArtifact(client, "scan-a")).toEqual("artifact" in expected ? { artifact: value } : { degraded: true, reason: expected.reason });
        await pool.query("UPDATE scans SET source_upload_id = $1, artifact = NULL", [uploadId]);
        expect(await decodeCanonicalSource(client, { scanId: "scan-a" }, 1024 * 1024)).toEqual(expected);
        expect(validateArtifact).not.toHaveBeenCalled();
      } finally { client.release(); }
    });
  });

  it("validates exactly once when publishing an upload", async () => {
    await withReadModelDatabase(async pool => {
      const input = sampleArtifact();
      vi.mocked(validateArtifact).mockClear();
      const uploadId = await receiveArtifact(pool, input);
      const job = await claimScanJob(pool, "version-test");
      if (!job) throw new Error("Expected upload job");
      await processScanJob(pool, job, new AbortController().signal);
      expect(validateArtifact).toHaveBeenCalledTimes(1);
      expect((await pool.query("SELECT state FROM scan_uploads WHERE upload_id = $1", [uploadId])).rows).toEqual([{ state: "ready" }]);
      expect((await pool.query("SELECT scanner, scanner_version FROM scans")).rows).toEqual([{ scanner: "@scoutui/cli", scanner_version: input.meta.scannerVersion }]);
    });
  });

  it("checks the legacy column's byte limit before loading it", async () => {
    await withReadModelDatabase(async pool => {
      await seedScan(pool, sampleArtifact());
      const { rows: [row] } = await pool.query("SELECT octet_length(artifact::text) AS bytes FROM scans");
      const client = await pool.connect();
      try {
        expect(await decodeCanonicalSource(client, { scanId: "scan-a" }, row.bytes - 1))
          .toEqual({ unknown: true, version: "invalid", reason: "decoded_limit" });
        expect(await decodeCanonicalSource(client, { scanId: "scan-a" }, row.bytes)).toMatchObject({ version: 2 });
      } finally { client.release(); }
    });
  });

  it("degrades an unsupported legacy structure and distinguishes a missing scan", async () => {
    await withReadModelDatabase(async pool => {
      await seedScan(pool, { meta: {} });
      const client = await pool.connect();
      try {
        expect(await readStoredArtifact(client, "scan-a")).toEqual({ degraded: true, reason: "unsupported_version" });
        expect(await readStoredArtifact(client, "missing")).toBeNull();
      } finally { client.release(); }
    });
  });

  it("never validates a stored scan when reading or rebuilding it", async () => {
    await withReadModelDatabase(async pool => {
      const input = sampleArtifact();
      await seedScan(pool, input);
      await pool.query("UPDATE scans SET scanner_version = $1", [input.meta.scannerVersion]);
      vi.mocked(validateArtifact).mockClear();
      const client = await pool.connect();
      try {
        expect(await readStoredArtifact(client, "scan-a")).toEqual({ artifact: input });
      } finally { client.release(); }
      expect(validateArtifact).not.toHaveBeenCalled();
      try {
        expect(await republishScan(pool, "scan-a", { force: true })).toMatchObject({ status: "rebuilt" });
      } finally {
        expect(validateArtifact).not.toHaveBeenCalled();
      }
    });
  });

  it("preserves the malformed archive error code when a stored scan rebuild fails, and asks for a new scan of the commit", async () => {
    await withReadModelDatabase(async pool => {
      database = pool;
      driver = new PostgresDriver(pool);
      const uploadId = await receiveArtifact(pool, Buffer.from("not a gzip archive"));
      await seedScan(pool, null, uploadId);
      await pool.query("DELETE FROM scan_jobs WHERE upload_id = $1", [uploadId]);
      const client = await pool.connect();
      try {
        await enqueueScanJob(client, "scan-a", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest);
      } finally { client.release(); }
      const job = await claimScanJob(pool, "version-test");
      if (!job || job.scanId !== "scan-a") throw new Error("Expected stored scan rebuild job");
      await processScanJob(pool, job, new AbortController().signal);
      expect((await pool.query("SELECT state, error_code, error_message FROM scan_jobs WHERE id = $1", [job.id])).rows)
        .toEqual([{ state: "failed", error_code: "invalid_gzip", error_message: "degraded: invalid_gzip" }]);
      expect(await claimScanJob(pool, "retry")).toBeNull();
      const { default: page, generateMetadata } = await import("@/app/repos/[repoId]/page");
      const params = { params: Promise.resolve({ repoId: "repo-a" }), searchParams: Promise.resolve({}) };
      expect(await generateMetadata(params)).toEqual({ title: "repo-a" });
      const html = renderToStaticMarkup(await page(params));
      expect(html).toContain("Scan this commit again to replace it.");
      expect(html).toContain("repo-a · ");
    });
  });

  it("renders the repository page as can't be read after a stored scan in an unsupported format fails rebuilding", async () => {
    await withReadModelDatabase(async pool => {
      database = pool;
      driver = new PostgresDriver(pool);
      await seedScan(pool, v1Artifact);
      const client = await pool.connect();
      try {
        expect(await readStoredArtifact(client, "scan-a")).toEqual({ degraded: true, reason: "unsupported_version" });
        await enqueueScanJob(client, "scan-a", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest);
      } finally { client.release(); }
      const job = await claimScanJob(pool, "version-test");
      if (!job) throw new Error("Expected rebuild job");
      await processScanJob(pool, job, new AbortController().signal);
      expect((await pool.query("SELECT state, error_message FROM scan_jobs WHERE id = $1", [job.id])).rows)
        .toEqual([{ state: "failed", error_message: "degraded: unsupported_version" }]);
      expect(await claimScanJob(pool, "retry")).toBeNull();
      const { default: page, generateMetadata } = await import("@/app/repos/[repoId]/page");
      const params = { params: Promise.resolve({ repoId: "repo-a" }), searchParams: Promise.resolve({}) };
      expect(await generateMetadata(params)).toEqual({ title: "repo-a" });
      const html = renderToStaticMarkup(await page(params));
      expect(html).toContain("Scan data can&#x27;t be read");
      expect(html).toContain("Scan this commit again to replace it.");
    });
  });
});
