import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { enqueueChartResults, PostgresDriver, PROJECTION_VERSION, type Dashboard, type GovernanceRecord, type StorageDriver } from "@scoutui/web-shared";
import { genericArtifacts } from "../../../../packages/web-shared/tests/helpers/fixtures.ts";
import { processChartResultsJob } from "../../src/lib/chart-results-job.ts";
import { claimScanJob, enqueueScanJob, failScanJob, SCAN_JOB_PRIORITY } from "../../src/lib/scan-jobs.ts";
import { publishScan } from "../../src/lib/scan-projection.ts";
import { withReadModelDatabase } from "../helpers/read-model-db.ts";

const { DATABASE_URL: databaseUrl } = process.env;

let driver: StorageDriver;
let database: Pool;
vi.mock("@/lib/storage", () => ({ getStorage: () => driver }));
vi.mock("@/db/client", () => ({ getPool: () => database }));
vi.mock("@/auth", () => ({ auth: async () => null }));

type Props = { children?: ReactNode; kind?: string; entries?: { id: string }[]; tracking?: { id: string }[] | null; notice?: unknown };

function allPropsFor(node: ReactNode, name: string, found: Props[] = []): Props[] {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Props>(child)) continue;
    if (typeof child.type === "function" && child.type.name === name) found.push(child.props);
    allPropsFor(child.props.children, name, found);
    for (const [key, value] of Object.entries(child.props)) {
      if (key !== "children" && isValidElement(value)) allPropsFor(value, name, found);
    }
  }
  return found;
}

const preparing = { state: "preparing", scans: [], retryable: true };

type Seeded = { retired: GovernanceRecord; unseen: GovernanceRecord; saved: Dashboard };

async function seed(pool: Pool): Promise<Seeded> {
  for (const artifact of genericArtifacts()) await publishScan(pool, artifact, { uploadedByUserId: null });
  await pool.query("UPDATE scans SET artifact = '{}'::json");
  driver = new PostgresDriver(pool);
  database = pool;
  return {
    retired: await driver.createGovernance({ grain: "package", targetPackage: "@sample/core", targetExport: null, disposition: { kind: "retired", reason: "Retired" } }),
    unseen: await driver.createGovernance({ grain: "package", targetPackage: "@sample/unused", targetExport: null, disposition: { kind: "retired", reason: "Retired" } }),
    saved: await driver.upsertDashboard({ name: "Local usage", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } }),
  };
}

async function storeResults(pool: Pool) {
  const job = await claimScanJob(pool, "stored-results-pages");
  if (job?.kind !== "results") throw new Error("Expected a queued results job");
  expect(await processChartResultsJob(pool, job, new AbortController().signal)).toBe("written");
}

function trackingParams(id: string) {
  return { params: Promise.resolve({ dashboardId: encodeURIComponent(id) }), searchParams: Promise.resolve({}) };
}

afterEach(() => vi.restoreAllMocks());

describe.skipIf(!databaseUrl)("pages serving stored chart results", { timeout: 30_000 }, () => {
  it("renders /charts tracking rows and previews from stored results without reading digests or tags", async () => {
    await withReadModelDatabase(async pool => {
      const { retired, saved } = await seed(pool);
      const unfound = { kind: "component", componentId: "component-in-no-scan" } as const;
      const gone = await driver.upsertDashboard({ name: "Gone repo", description: null, config: { scope: { kind: "repo", repoId: "repo-gone" }, cohorts: [unfound], chartType: "bars", metric: "count" } });
      await pool.query("INSERT INTO repos (repo_id) VALUES ('repo-unscanned')");
      const unscanned = await driver.upsertDashboard({ name: "Unscanned repo", description: null, config: { scope: { kind: "repo", repoId: "repo-unscanned" }, cohorts: [{ kind: "local" }], chartType: "bars", metric: "count" } });
      const lost = await driver.upsertDashboard({ name: "Lost component", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }, unfound], chartType: "bars", metric: "count" } });
      await storeResults(pool);
      await driver.upsertDashboard({ id: saved.id, name: saved.name, description: null, config: { ...saved.config, cohorts: [...saved.config.cohorts, unfound] } });
      const digests = vi.spyOn(PostgresDriver.prototype, "listScanDigests");
      const tags = vi.spyOn(PostgresDriver.prototype, "listTags");
      const { default: page } = await import("@/app/charts/page");
      const tree = await page();
      expect(digests).not.toHaveBeenCalled();
      expect(tags).not.toHaveBeenCalled();
      const stored = await driver.getStoredTracking({ kind: "all" });
      const retirements = allPropsFor(tree, "TrackingSection").find(section => section.kind === "retirement");
      expect(retirements?.entries).toEqual(stored?.filter(entry => entry.kind === "retirement" && entry.active));
      expect(retirements?.entries?.map(entry => entry.id)).toEqual([`retirement:${retired.id}`]);
      const previews = await driver.getStoredPreviews();
      expect([previews[gone.id]?.missing, previews[saved.id]?.missing]).toEqual([true, false]);
      expect(allPropsFor(tree, "DashboardSparkline")).toEqual([
        expect.objectContaining({ uid: gone.id, view: previews[gone.id]?.view }),
        expect.objectContaining({ uid: saved.id, view: previews[saved.id]?.view }),
        expect.objectContaining({ uid: lost.id, view: previews[lost.id]?.view }),
        expect.objectContaining({ uid: unscanned.id, view: previews[unscanned.id]?.view }),
      ]);
      expect(allPropsFor(tree, "DashboardScopeBadge")).toEqual([
        expect.objectContaining({ scope: gone.config.scope, missing: "repo" }),
        { scope: saved.config.scope },
        { scope: lost.config.scope },
        expect.objectContaining({ scope: unscanned.config.scope, missing: "scans" }),
      ]);
      // Only the lost chart: the gone repo's badge already explains its chart, and the
      // saved chart changed after its preview was stored.
      expect(allPropsFor(tree, "UnknownComponentsBadge")).toHaveLength(1);
      expect(allPropsFor(tree, "ChartResultsState")).toEqual([]);
    });
  });

  it("renders the preparing state where /charts tracking goes and an empty sparkline slot before results are stored", async () => {
    await withReadModelDatabase(async pool => {
      const { saved } = await seed(pool);
      const { default: page } = await import("@/app/charts/page");
      const tree = await page();
      expect(allPropsFor(tree, "ChartResultsState")).toEqual([{ notice: { unavailable: preparing, fallbacks: [] }, besideNumbers: false }]);
      expect(allPropsFor(tree, "TrackingSection")).toEqual([]);
      expect(allPropsFor(tree, "DashboardSparkline")).toEqual([expect.objectContaining({ uid: saved.id, view: null })]);
    });
  });

  it("serves /governance stats and sources from the stored registry without reading digests", async () => {
    await withReadModelDatabase(async pool => {
      const { unseen } = await seed(pool);
      await storeResults(pool);
      const digests = vi.spyOn(PostgresDriver.prototype, "listScanDigests");
      const { default: page } = await import("@/app/governance/page");
      const tree = await page();
      expect(digests).not.toHaveBeenCalled();
      const registry = await driver.getStoredRegistry();
      expect(registry?.stats[unseen.id]?.status).toBe("unseen");
      expect(allPropsFor(tree, "GovernanceManager")).toEqual([expect.objectContaining({ stats: registry?.stats, sources: registry?.sources, repoCount: registry?.repoCount })]);
      expect(allPropsFor(tree, "ChartResultsState")).toEqual([]);
    });
  });

  it("keeps the governance manager and renders the preparing state before the registry is stored", async () => {
    await withReadModelDatabase(async pool => {
      const { retired } = await seed(pool);
      const { default: page } = await import("@/app/governance/page");
      const tree = await page();
      expect(allPropsFor(tree, "ChartResultsState")).toEqual([{ notice: { unavailable: preparing, fallbacks: [] }, besideNumbers: false }]);
      expect(allPropsFor(tree, "GovernanceManager")).toEqual([
        expect.objectContaining({ records: expect.arrayContaining([expect.objectContaining({ id: retired.id })]), stats: {}, sources: [], repoCount: 0 }),
      ]);
    });
  });

  it("renders stored tracking pages, prepares records the stored registry has not seen, and 404s unseen records", async () => {
    await withReadModelDatabase(async pool => {
      const { retired, unseen } = await seed(pool);
      await storeResults(pool);
      const added = await driver.createGovernance({ grain: "package", targetPackage: "@sample/mixed", targetExport: null, disposition: { kind: "retired", reason: "Retired" } });
      const digests = vi.spyOn(PostgresDriver.prototype, "listScanDigests");
      const { default: page } = await import("@/app/charts/[dashboardId]/page");
      const stored = (await driver.getStoredTracking({ kind: "all" }))?.find(entry => entry.id === `retirement:${retired.id}`);
      expect(stored).toBeDefined();
      const tree = await page(trackingParams(`retirement:${retired.id}`));
      expect(allPropsFor(tree, "DashboardChart")).toEqual([expect.objectContaining({ view: { kind: "series", series: stored?.series, coverage: stored?.coverage } })]);
      expect(allPropsFor(await page(trackingParams(`retirement:${added.id}`)), "ReadModelState")).toEqual([preparing]);
      expect(digests).not.toHaveBeenCalled();
      await expect(page(trackingParams(`retirement:${unseen.id}`))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      await expect(page(trackingParams(`migration:${added.id}`))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      await expect(page(trackingParams("migration:missing"))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    });
  });

  it("prepares a tracking page when no registry is stored, and 404s an id whose prefix does not match the record", async () => {
    await withReadModelDatabase(async pool => {
      const { retired } = await seed(pool);
      const { default: page } = await import("@/app/charts/[dashboardId]/page");
      const superseded = await driver.createGovernance({ grain: "component", targetPackage: "@sample/core", targetExport: "Button", disposition: { kind: "superseded", by: { packageName: "@sample/new" } } });
      expect(allPropsFor(await page(trackingParams(`retirement:${retired.id}`)), "ReadModelState")).toEqual([preparing]);
      expect(allPropsFor(await page(trackingParams(`migration:${superseded.id}`)), "ReadModelState")).toEqual([preparing]);
      await expect(page(trackingParams(`migration:${retired.id}`))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      await expect(page(trackingParams(`retirement:${superseded.id}`))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    });
  });

  it("recomputes stored results without a failed latest scan and shows its repo's row beside them", async () => {
    await withReadModelDatabase(async pool => {
      const { retired } = await seed(pool);
      await storeResults(pool);
      const registry = await driver.getStoredRegistry();
      const repoStored = await driver.getStoredTracking({ kind: "repo", repoId: "repo-b" });
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'scan-current'");
      const client = await pool.connect();
      try { await enqueueScanJob(client, "scan-current", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
      const rebuild = await claimScanJob(pool, "stored-results-pages");
      if (rebuild?.scanId !== "scan-current") throw new Error("Expected the scan rebuild job");
      await failScanJob(pool, rebuild, { code: "projection_failed", message: "Projection failed" });
      const added = await driver.createGovernance({ grain: "package", targetPackage: "@sample/mixed", targetExport: null, disposition: { kind: "retired", reason: "Retired" } });
      const results = await claimScanJob(pool, "stored-results-pages");
      if (results?.kind !== "results") throw new Error("Expected a queued results job");
      expect(await processChartResultsJob(pool, results, new AbortController().signal)).toBe("written");
      const failed = { unavailable: null, fallbacks: [expect.objectContaining({ repoId: "repo-a", state: "failed", latest: expect.objectContaining({ scanId: "scan-current" }), shown: expect.objectContaining({ committedAt: "2026-06-01T00:00:00.000Z" }) })] };
      const governance = await import("@/app/governance/page");
      const governanceTree = await governance.default();
      expect(allPropsFor(governanceTree, "ChartResultsState")).toEqual([{ notice: failed, besideNumbers: true }]);
      expect(allPropsFor(governanceTree, "GovernanceManager")).toEqual([expect.objectContaining({ stats: { ...registry?.stats, [added.id]: expect.anything() } })]);
      const charts = await import("@/app/charts/page");
      const chartsTree = await charts.default();
      expect(allPropsFor(chartsTree, "ChartResultsState")).toEqual([{ notice: failed, besideNumbers: true }]);
      const retirements = allPropsFor(chartsTree, "TrackingSection").find(section => section.kind === "retirement");
      expect(retirements?.entries?.map(entry => entry.id).sort()).toEqual([`retirement:${retired.id}`, `retirement:${added.id}`].sort());
      const repo = await import("@/app/repos/[repoId]/page");
      const repoTree = await repo.default({ params: Promise.resolve({ repoId: "repo-b" }), searchParams: Promise.resolve({}) });
      expect(repoStored).not.toBeNull();
      const [adoption] = allPropsFor(repoTree, "RepoAdoptionPanel");
      expect(adoption?.notice).toBeNull();
      expect(adoption?.tracking?.map(entry => entry.id)).toEqual([...(repoStored ?? []).map(entry => entry.id), `retirement:${added.id}`]);
    });
  });

  it("shows a failed latest scan's row beside /charts stored previews when there is no governance tracked", async () => {
    await withReadModelDatabase(async pool => {
      for (const artifact of genericArtifacts()) await publishScan(pool, artifact, { uploadedByUserId: null });
      await pool.query("UPDATE scans SET artifact = '{}'::json");
      driver = new PostgresDriver(pool);
      database = pool;
      const saved = await driver.upsertDashboard({ name: "Local usage", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } });
      await storeResults(pool);
      const previews = await driver.getStoredPreviews();
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'scan-current'");
      const client = await pool.connect();
      try { await enqueueScanJob(client, "scan-current", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
      const rebuild = await claimScanJob(pool, "stored-results-pages");
      if (rebuild?.scanId !== "scan-current") throw new Error("Expected the scan rebuild job");
      await failScanJob(pool, rebuild, { code: "projection_failed", message: "Projection failed" });
      await enqueueChartResults(pool);
      const results = await claimScanJob(pool, "stored-results-pages");
      if (results?.kind !== "results") throw new Error("Expected a queued results job");
      expect(await processChartResultsJob(pool, results, new AbortController().signal)).toBe("written");
      const failed = { unavailable: null, fallbacks: [expect.objectContaining({ repoId: "repo-a", state: "failed", latest: expect.objectContaining({ scanId: "scan-current" }), shown: expect.objectContaining({ committedAt: "2026-06-01T00:00:00.000Z" }) })] };
      const { default: page } = await import("@/app/charts/page");
      const tree = await page();
      expect(allPropsFor(tree, "ChartResultsState")).toEqual([{ notice: failed, besideNumbers: true }]);
      expect(allPropsFor(tree, "DashboardSparkline")).toEqual([expect.objectContaining({ uid: saved.id, view: previews[saved.id]?.view })]);
    });
  });

  it("shows a failed latest scan's row beside a tracking page's stored entry", async () => {
    await withReadModelDatabase(async pool => {
      const { retired } = await seed(pool);
      await storeResults(pool);
      const stored = (await driver.getStoredTracking({ kind: "all" }))?.find(entry => entry.id === `retirement:${retired.id}`);
      expect(stored).toBeDefined();
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'scan-current'");
      const client = await pool.connect();
      try { await enqueueScanJob(client, "scan-current", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
      const rebuild = await claimScanJob(pool, "stored-results-pages");
      if (rebuild?.scanId !== "scan-current") throw new Error("Expected the scan rebuild job");
      await failScanJob(pool, rebuild, { code: "projection_failed", message: "Projection failed" });
      await enqueueChartResults(pool);
      const results = await claimScanJob(pool, "stored-results-pages");
      if (results?.kind !== "results") throw new Error("Expected a queued results job");
      expect(await processChartResultsJob(pool, results, new AbortController().signal)).toBe("written");
      const failed = { unavailable: null, fallbacks: [expect.objectContaining({ repoId: "repo-a", state: "failed", latest: expect.objectContaining({ scanId: "scan-current" }), shown: expect.objectContaining({ committedAt: "2026-06-01T00:00:00.000Z" }) })] };
      const { default: page } = await import("@/app/charts/[dashboardId]/page");
      const tree = await page(trackingParams(`retirement:${retired.id}`));
      expect(allPropsFor(tree, "ChartResultsState")).toEqual([{ notice: failed, besideNumbers: true }]);
      expect(allPropsFor(tree, "DashboardChart")).toEqual([expect.objectContaining({ view: { kind: "series", series: stored?.series, coverage: stored?.coverage } })]);
    });
  });

  it("passes the repo's stored tracking to the adoption panel, and the preparing state before it is stored", async () => {
    await withReadModelDatabase(async pool => {
      const { retired } = await seed(pool);
      const { default: page } = await import("@/app/repos/[repoId]/page");
      const params = { params: Promise.resolve({ repoId: "repo-a" }), searchParams: Promise.resolve({}) };
      expect(allPropsFor(await page(params), "RepoAdoptionPanel")).toEqual([expect.objectContaining({ tracking: null, notice: preparing })]);
      await storeResults(pool);
      const stored = await driver.getStoredTracking({ kind: "repo", repoId: "repo-a" });
      expect(stored?.map(entry => entry.id)).toEqual([`retirement:${retired.id}`]);
      expect(allPropsFor(await page(params), "RepoAdoptionPanel")).toEqual([expect.objectContaining({ tracking: stored, notice: null })]);
    });
  });
});
