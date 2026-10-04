import { AsyncLocalStorage } from "node:async_hooks";
import { Client, type Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { componentKey } from "@scoutui/scan-format";
import {
  PostgresDriver, PROJECTION_VERSION, type ComponentRow, type ComponentSummary, type CompositionGraph, type PackageDetail,
  type PackageSummary, type RepoDetail, type RepoSummary, type ScanSummary, type StorageDriver,
} from "@scoutui/web-shared";
import { component, packageExport, repoDeclaration } from "../../../../packages/web-shared/tests/helpers/builders.ts";
import { genericArtifacts } from "../../../../packages/web-shared/tests/helpers/fixtures.ts";
import { claimScanJob, enqueueScanJob, failScanJob, SCAN_JOB_PRIORITY } from "../../src/lib/scan-jobs.ts";
import { publishScan } from "../../src/lib/scan-projection.ts";
import { readModelPage } from "../../src/lib/read-model-page.ts";
import type { Person } from "../../src/lib/access.ts";
import { baseline } from "../helpers/cli-baseline.ts";
import { withReadModelDatabase } from "../helpers/read-model-db.ts";

const { DATABASE_URL: databaseUrl } = process.env;

let driver: StorageDriver;
let database: Pool;
vi.mock("@/lib/storage", () => ({ getStorage: () => driver }));
vi.mock("@/db/client", () => ({ getPool: () => database }));
const editor: Person = { kind: "person", userId: "reader", email: "ana@example.com", name: null, role: "editor", roleSource: "people" };
let reader = editor;
vi.mock("@/lib/identity", () => ({ identify: async () => reader }));

const scope = new AsyncLocalStorage<{ usage: boolean }>();

function recordQueries(allowUsage = false) {
  const queries: string[] = [];
  const forbiddenRawQueries: string[] = [];
  const componentHeadOccurrenceQueries: string[] = [];
  const query = Client.prototype.query;
  vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...args) {
    const current = scope.getStore();
    const input = args[0] as string | { text: string };
    const text = typeof input === "string" ? input : input.text;
    if (current) {
      queries.push(text);
      const normalized = text.replaceAll('"', "");
      if (/\bscan_artifact_chunks\b/i.test(normalized)
        || (/\b(?:from|join)\s+(?:\w+\.)?scans\b/i.test(normalized)
          && (/\bartifact\b/i.test(normalized) || /select\s+(?:\w+\.)?\*\s+from\s+(?:\w+\.)?scans\b/i.test(normalized)))) {
        forbiddenRawQueries.push(text);
        throw new Error(`Forbidden raw query: ${text}`);
      }
      if (/\bscan_occurrence_views\b/i.test(normalized) && !current.usage) {
        componentHeadOccurrenceQueries.push(text);
        throw new Error(`Occurrence query outside explicit Usage: ${text}`);
      }
    }
    return query.apply(this, args);
  });
  const usage = PostgresDriver.prototype.getComponentUsage;
  vi.spyOn(PostgresDriver.prototype, "getComponentUsage").mockImplementation(function (this: PostgresDriver, ...args) {
    return scope.run({ usage: allowUsage }, () => usage.apply(this, args));
  });
  return {
    queries, forbiddenRawQueries, componentHeadOccurrenceQueries,
    read: <T>(fn: () => Promise<T>) => scope.run({ usage: false }, fn),
  };
}

type PageProps = { children?: ReactNode; fallbacks?: unknown; ownPage?: boolean; detail?: unknown; graph?: unknown; source?: unknown; rows?: unknown; notInLatest?: unknown; packages?: unknown; tracking?: unknown; notice?: unknown; allTags?: unknown; records?: unknown; stats?: unknown };

/** A read of every component fact in a scan, not one component's. */
const readsEveryComponent = (query: string) => /\bscan_component_facts\b/.test(query) && !/\bcomponent_id = \$2\b/.test(query);

function propsFor(node: ReactNode, name: string): PageProps | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<PageProps>(child)) continue;
    if (typeof child.type === "function" && child.type.name === name) return child.props;
    const nested = propsFor(child.props.children as ReactNode, name);
    if (nested) return nested;
    for (const value of Object.values(child.props)) {
      if (isValidElement(value)) {
        const nestedProp = propsFor(value, name);
        if (nestedProp) return nestedProp;
      }
    }
  }
}

async function seed(pool: Pool) {
  for (const artifact of genericArtifacts()) await publishScan(pool, artifact, { uploadedByUserId: null });
  await pool.query("UPDATE scans SET artifact = '{}'::json");
  driver = new PostgresDriver(pool);
  database = pool;
}

const button = componentKey(packageExport("@sample/core", "Button"));
const panel = componentKey(repoDeclaration("repo-a", "src/panel.tsx", "Panel"));
const otherPanel = componentKey(repoDeclaration("repo-a", "src/other/panel.tsx", "Panel"));
const repoParams = { params: Promise.resolve({ repoId: "repo-a" }) };
const componentParams = { params: Promise.resolve({ repoId: "repo-a", componentId: button }) };
const packageParams = { params: Promise.resolve({ packageName: "%40sample%2Fcore" }) };
const crossParams = { params: Promise.resolve({ componentId: button }) };
const searchParams = Promise.resolve({});

afterEach(() => {
  vi.restoreAllMocks();
  reader = editor;
});

describe.skipIf(!databaseUrl)("page read boundaries", () => {
  it.each(["being rebuilt", "failed"] as const)("returns a trend preview's state while an older scan is %s, after the chart builder loads", async state => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const oldest = genericArtifacts()[0];
      if (!oldest) throw new Error("Missing scan fixture");
      oldest.meta.scanId = "scan-oldest";
      oldest.meta.repo.commit = "oldest";
      oldest.meta.repo.committedAt = "2026-05-01T00:00:00Z";
      await publishScan(pool, oldest, { uploadedByUserId: null });
      await pool.query("UPDATE scans SET artifact = '{}'::json");
      if (state === "being rebuilt") await pool.query("UPDATE scan_read_models SET format_version = format_version + 1 WHERE scan_id = 'scan-oldest'");
      else {
        await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'scan-oldest'");
        await pool.query("INSERT INTO scan_jobs (id, scan_id, projection_version, kind, state) VALUES ('oldest-job', 'scan-oldest', 1, 'scan', 'failed')");
      }
      const { default: builder } = await import("@/app/charts/new/page");
      const { previewDashboard } = await import("@/app/charts/dashboard-actions");
      const recorder = recordQueries();
      expect(propsFor(await recorder.read(() => builder({ searchParams: Promise.resolve({}) })), "DashboardBuilder")).toBeDefined();
      const config = { scope: { kind: "repo", repoId: "repo-a" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } as const;
      const preview = await recorder.read(() => previewDashboard({ ...config, cohorts: [...config.cohorts] }));
      expect(preview).toMatchObject(state === "being rebuilt"
        ? { state: "preparing", scans: [], retryable: true }
        : { state: "ready", fallbacks: [], gaps: [{ scanId: "scan-oldest", repoId: "repo-a", commit: "oldest", state: "failed" }] });
      expect(JSON.parse(JSON.stringify(preview))).toEqual(preview);
      const snapshot = await recorder.read(() => previewDashboard({ ...config, cohorts: [...config.cohorts], chartType: "bars" }));
      expect(snapshot).toMatchObject({ state: "ready", value: { kind: "snapshot" } });
    });
  });

  it("lists the scoped chart picker's options from the newest ready scan, and waits while the repo is being rebuilt", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query("UPDATE scan_read_models SET format_version = format_version + 1 WHERE scan_id = 'scan-current'");
      const { pickableForRepo } = await import("@/app/charts/dashboard-actions");
      const recorder = recordQueries();
      expect(await recorder.read(() => pickableForRepo("repo-a"))).toMatchObject({ state: "ready", value: { packages: ["@sample/core"] } });
      await pool.query("UPDATE scan_read_models SET format_version = format_version + 1 WHERE scan_id = 'scan-previous'");
      expect(await recorder.read(() => pickableForRepo("repo-a"))).toEqual({ state: "preparing", scans: [], retryable: true });
    });
  });

  it("propagates unexpected database errors from chart actions", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query("ALTER TABLE scan_component_facts RENAME TO unavailable_component_facts");
      const { pickableForRepo, previewDashboard } = await import("@/app/charts/dashboard-actions");
      await expect(pickableForRepo("repo-a")).rejects.toThrow();
      await expect(previewDashboard({ scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" })).rejects.toThrow();
    });
  });

  it("returns ready only after closing the snapshot and preserves unrelated errors", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const recorder = recordQueries();
      const page = await recorder.read(() => readModelPage(driver, snapshot => snapshot.getRepo("repo-a")));
      expect(page.state).toBe("ready");
      expect(recorder.queries.filter(query => query.startsWith("BEGIN"))).toHaveLength(1);
      expect(recorder.queries.at(-1)).toBe("COMMIT");
      const failure = Object.assign(new Error("Connection interrupted"), { name: "ReadModelUnavailableError", state: "failed" });
      await expect(recorder.read(() => readModelPage(driver, async () => { throw failure; }))).rejects.toBe(failure);
      expect(recorder.queries.at(-1)).toBe("ROLLBACK");
    });
  });

  it("loads component metadata without reading occurrences", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const { generateMetadata } = await import("@/app/repos/[repoId]/components/[componentId]/page");
      const recorder = recordQueries();
      expect(await recorder.read(() => generateMetadata(componentParams))).toEqual({ title: "Button" });
      expect(recorder.componentHeadOccurrenceQueries).toEqual([]);
      expect(recorder.forbiddenRawQueries).toEqual([]);
    });
  });

  it("assembles component head, every Usage row and stored graph without raw archives", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const { default: page } = await import("@/app/repos/[repoId]/components/[componentId]/page");
      const recorder = recordQueries(true);
      const tree = await recorder.read(() => page(componentParams));
      const tabs = propsFor(tree, "DetailTabs");
      expect(tabs?.detail).toMatchObject({ displayName: "Button", occurrences: [{ filePath: "src/z.tsx", line: 3 }] });
      const graph = tabs?.graph as CompositionGraph | undefined;
      expect(graph?.nodes.map(node => node.id).sort()).toEqual([button, panel].sort());
      expect(graph?.edges).toEqual([{ source: panel, target: button, count: 1 }]);
      expect(tabs?.source).toEqual({ remote: null, commit: "abc" });
      expect(recorder.queries.filter(readsEveryComponent)).toEqual([]);
      expect(recorder.forbiddenRawQueries).toEqual([]);
      expect(recorder.componentHeadOccurrenceQueries).toEqual([]);
      expect(recorder.queries.filter(q => q.startsWith("BEGIN"))).toHaveLength(1);
      expect(recorder.queries.at(-1)).toBe("COMMIT");
    });
  });

  it("titles a repo page without reading its components, and 404s an unknown repo", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const { generateMetadata } = await import("@/app/repos/[repoId]/page");
      const recorder = recordQueries();
      expect(await recorder.read(() => generateMetadata(repoParams))).toEqual({ title: "repo-a" });
      expect(recorder.queries.filter(readsEveryComponent)).toEqual([]);
      await expect(generateMetadata({ params: Promise.resolve({ repoId: "missing" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    });
  });

  it("collects repo header, table, history and adoption data before returning JSX, and shows an empty state for a scan with no components", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const { default: page } = await import("@/app/repos/[repoId]/page");
      const recorder = recordQueries();
      const tree = await recorder.read(() => page({ ...repoParams, searchParams }));
      const explorer = propsFor(tree, "ComponentsExplorer");
      expect(explorer?.rows).toEqual(expect.arrayContaining([expect.objectContaining({ componentId: button })]));
      expect(propsFor(tree, "RepoAdoptionPanel")).toMatchObject({ tracking: null, notice: null });
      expect(recorder.queries.filter(q => q.startsWith("BEGIN"))).toHaveLength(1);
      expect(recorder.queries.at(-1)).toBe("COMMIT");
      const empty = await page({ params: Promise.resolve({ repoId: "repo-empty" }), searchParams });
      expect(propsFor(empty, "EmptyState")).toMatchObject({
        title: "No components found",
        description: 'This scan found no components. Check "include" and "exclude" in scout.config.json, then scan again.',
      });
    });
  });

  it("flags the components an older scan has that the latest scan doesn't", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const field = componentKey(packageExport("@sample/mixed", "Field"));
      const next = genericArtifacts()[0];
      if (!next) throw new Error("Missing scan fixture");
      next.meta.scanId = "scan-next";
      next.meta.repo.commit = "next";
      next.meta.repo.committedAt = "2026-06-03T00:00:00Z";
      next.components = next.components.filter(c => c.id !== field);
      next.occurrences = next.occurrences.filter(o => o.occurrenceId !== "field");
      await publishScan(pool, next, { uploadedByUserId: null });
      const { default: page } = await import("@/app/repos/[repoId]/page");
      const older = await page({ ...repoParams, searchParams: Promise.resolve({ scan: "scan-current" }) });
      expect(propsFor(older, "ComponentsExplorer")?.notInLatest).toEqual([field]);
      const latest = await page({ ...repoParams, searchParams });
      expect(propsFor(latest, "ComponentsExplorer")?.notInLatest).toEqual([]);
    });
  });

  it("gives the components table the scan's packages", async () => {
    await withReadModelDatabase(async pool => {
      await publishScan(pool, baseline("whole-repo-scope"), { uploadedByUserId: null });
      driver = new PostgresDriver(pool);
      database = pool;
      const { default: page } = await import("@/app/repos/[repoId]/page");
      const tree = await page({ params: Promise.resolve({ repoId: "whole-repo-scope" }), searchParams });
      expect(propsFor(tree, "ComponentsExplorer")?.packages).toEqual([
        { name: "whole-repo-scope", folder: "" },
        { name: "@example/playground", folder: "apps/playground" },
        { name: "@example/web", folder: "apps/web" },
        { name: "@example/shared-ui", folder: "packages/shared-ui" },
      ]);
    });
  });

  it("keeps the header, table and overlays on one version when another scan publishes between reads", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const { default: page } = await import("@/app/repos/[repoId]/page");
      const next = genericArtifacts()[0];
      if (!next) throw new Error("Missing scan fixture");
      next.meta.scanId = "scan-next";
      next.meta.repo.commit = "next";
      next.meta.repo.committedAt = "2026-06-03T00:00:00Z";
      const late = component(packageExport("@sample/core", "Late"), { usage: "direct", stats: { occurrenceCount: 1, fileCount: 1 } });
      next.components.push(late);
      const getRepo = PostgresDriver.prototype.getRepo;
      let published = false;
      vi.spyOn(PostgresDriver.prototype, "getRepo").mockImplementation(async function (this: PostgresDriver, ...args) {
        const result = await getRepo.apply(this, args);
        if (!published) {
          published = true;
          await scope.exit(async () => {
            await publishScan(pool, next, { uploadedByUserId: null });
            await pool.query("INSERT INTO tags (id, value, category, color, rule) VALUES ('new-tag', 'new', 'library', 'teal', '{\"glob\":[],\"exact\":[\"@sample/core\"]}')");
            await pool.query("INSERT INTO governance (id, grain, target_package, target_export, disposition) VALUES ('new-record', 'package', '@sample/core', NULL, '{\"kind\":\"retired\",\"reason\":\"Retired\"}')");
          });
        }
        return result;
      });
      const recorder = recordQueries();
      const tree = await recorder.read(() => page({ ...repoParams, searchParams }));
      expect(propsFor(tree, "RepoDetailHeader")?.detail).toMatchObject({ scanId: "scan-current", deprecatedCount: 0 });
      const rows = propsFor(tree, "ComponentsExplorer")?.rows as Array<{ componentId: string; tags: unknown[]; deprecated: boolean }>;
      expect(rows.some(row => row.componentId === late.id)).toBe(false);
      expect(rows.every(row => row.tags.length === 0 && !row.deprecated)).toBe(true);
      expect(propsFor(tree, "RepoAdoptionPanel")).toMatchObject({ tracking: null, notice: null });
      const fresh = await recorder.read(() => page({ ...repoParams, searchParams }));
      expect(propsFor(fresh, "RepoDetailHeader")?.detail).toMatchObject({ scanId: "scan-next" });
      expect(propsFor(fresh, "ComponentsExplorer")?.rows).toEqual(expect.arrayContaining([expect.objectContaining({ componentId: late.id, deprecated: true, tags: [expect.objectContaining({ id: "new-tag" })] })]));
    });
  });

  it("shows /repos and the repo's page at its newest ready scan, with the band, when the newest failed", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'scan-current'");
      await pool.query("INSERT INTO scan_jobs (id, scan_id, projection_version, kind, state) VALUES ('current-job', 'scan-current', 1, 'scan', 'failed')");
      const failed = [expect.objectContaining({ repoId: "repo-a", state: "failed", latest: expect.objectContaining({ scanId: "scan-current" }) })];
      const repos = await (await import("@/app/repos/page")).default();
      expect(propsFor(repos, "SkippedScansNotice")).toEqual({ fallbacks: failed });
      expect((propsFor(repos, "ReposExplorer")?.rows as Array<{ repoId: string }>).map(row => row.repoId)).toContain("repo-a");
      const repo = await (await import("@/app/repos/[repoId]/page")).default({ ...repoParams, searchParams });
      expect(propsFor(repo, "SkippedScansNotice")).toEqual({ fallbacks: failed, ownPage: true });
      expect(propsFor(repo, "RepoDetailHeader")?.detail).toMatchObject({ scanId: "scan-previous" });
    });
  });

  it("keeps governance settings and health available when scan preparation fails", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query("DELETE FROM scan_read_models WHERE scan_id = 'scan-current'");
      const client = await pool.connect();
      try { await enqueueScanJob(client, "scan-current", PROJECTION_VERSION, SCAN_JOB_PRIORITY.latest); } finally { client.release(); }
      const rebuild = await claimScanJob(pool, "page-reads");
      if (rebuild?.scanId !== "scan-current") throw new Error("Expected the scan rebuild job");
      await failScanJob(pool, rebuild, { code: "projection_failed", message: "Projection failed" });
      await driver.upsertTag({ id: "editable", value: "editable", category: null, color: "teal", rule: { glob: [], exact: [] } });
      await driver.createGovernance({ grain: "package", targetPackage: "@sample/core", targetExport: null, disposition: { kind: "retired", reason: "Retired" } });
      const { default: page } = await import("@/app/governance/page");
      const { GET } = await import("@/app/api/health/route");
      const tree = await page();
      expect(propsFor(tree, "ChartResultsState")?.notice).toMatchObject({ unavailable: { state: "failed", scans: [expect.objectContaining({ scanId: "scan-current" })] } });
      expect(propsFor(tree, "TagsPanel")?.allTags).toEqual([expect.objectContaining({ id: "editable" })]);
      expect(propsFor(tree, "GovernanceManager")?.records).toEqual([expect.objectContaining({ targetPackage: "@sample/core" })]);
      expect(propsFor(tree, "GovernanceManager")?.stats).toEqual({});
      expect(await GET().json()).toEqual({ status: "ok" });
    });
  });

  it.each([
    {
      url: "/governance", page: "GovernanceManager", line: "Only Editors can see Governance. Ask an Admin for access.",
      open: async () => (await import("@/app/governance/page")).default(),
    },
    {
      url: "/charts/new", page: "DashboardBuilder", line: "Only Editors can make charts. Ask an Admin for access.",
      open: async () => (await import("@/app/charts/new/page")).default({ searchParams: Promise.resolve({}) }),
    },
    {
      url: "/charts/[id]/edit", page: "DashboardBuilder", line: "Only Editors can change charts. Ask an Admin for access.",
      open: async (dashboardId: string) => (await import("@/app/charts/[dashboardId]/edit/page")).default({ params: Promise.resolve({ dashboardId }) }),
    },
  ])("shows a Viewer one line instead of $url, and an Editor the page", async ({ page, line, open }) => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query(`INSERT INTO "user" (id, email) VALUES ('reader', 'ana@example.com')`);
      const saved = await driver.upsertDashboard({ visibility: "everyone", name: "Local usage", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" }, createdByUserId: "reader" });
      reader = { ...editor, role: "viewer" };
      expect(propsFor(await open(saved.id), "EmptyState")).toEqual({ titleAs: "h1", title: line });
      reader = editor;
      expect(propsFor(await open(saved.id), page)).toBeDefined();
    });
  });

  it("serves list, package, chart, history and cross-repo surfaces in narrow snapshots", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const repos = await import("@/app/repos/page");
      const packages = await import("@/app/packages/page");
      const pkg = await import("@/app/packages/[packageName]/page");
      const cross = await import("@/app/components/[componentId]/page");
      const history = await import("@/app/repos/[repoId]/scans/page");
      const repo = await import("@/app/repos/[repoId]/page");
      const chart = await import("@/app/charts/new/page");
      const charts = await import("@/app/charts/page");
      const savedChart = await driver.upsertDashboard({ visibility: "everyone", name: "Local usage", description: null, config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" } });
      const chartDetail = await import("@/app/charts/[dashboardId]/page");
      const chartParams = { params: Promise.resolve({ dashboardId: savedChart.id }) };
      const { pickableForRepo, previewDashboard } = await import("@/app/charts/dashboard-actions");
      const recorder = recordQueries();
      const reads: Array<() => Promise<unknown>> = [
        () => repos.default(), () => packages.default(), () => pkg.default(packageParams),
        () => cross.default(crossParams), () => history.default(repoParams), () => chart.default({ searchParams: Promise.resolve({}) }),
        () => repo.default({ ...repoParams, searchParams: Promise.resolve({ scan: "scan-previous" }) }),
        () => repo.generateMetadata(repoParams), () => pkg.generateMetadata(packageParams),
        () => cross.generateMetadata(crossParams), () => history.generateMetadata(repoParams),
        () => pickableForRepo("repo-a"),
        () => chartDetail.default({ ...chartParams, searchParams }), () => chartDetail.generateMetadata(chartParams),
        () => previewDashboard({ scope: { kind: "repo", repoId: "repo-a" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" }),
      ];
      for (const read of reads) {
        recorder.queries.length = 0;
        expect(await recorder.read(read)).toBeTruthy();
        expect(recorder.queries.filter(q => q.startsWith("BEGIN"))).toHaveLength(1);
        expect(recorder.queries.at(-1)).toBe("COMMIT");
      }
      // Charts reads its failed-scan notice through the pool once a saved chart exists, outside
      // the snapshot transaction, so it gets its own boundary check rather than the loop above.
      recorder.queries.length = 0;
      expect(await recorder.read(() => charts.default())).toBeTruthy();
      expect(recorder.queries.filter(q => q.startsWith("BEGIN"))).toHaveLength(1);
      expect(recorder.queries).toContain("COMMIT");
      expect(recorder.forbiddenRawQueries).toEqual([]);
      expect(recorder.componentHeadOccurrenceQueries).toEqual([]);
    });
  }, 30_000);

  it("shows each scan's commit date, arrival time and uploader on the Scans page, and marks scans that couldn't be prepared or can't be read", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const oldest = genericArtifacts()[0];
      if (!oldest) throw new Error("Missing scan fixture");
      oldest.meta.scanId = "01K6HZQ4M8R2VXJ3T5N7P9B0CD";
      oldest.meta.repo.commit = "oldest";
      oldest.meta.repo.committedAt = "2026-05-01T00:00:00Z";
      await publishScan(pool, oldest, { uploadedByUserId: null });
      await pool.query("UPDATE scans SET created_at = '2026-06-02T00:05:00Z' WHERE scan_id = 'scan-current'");
      await pool.query("UPDATE scans SET created_at = '2026-06-05T09:00:00Z' WHERE scan_id = 'scan-previous'");
      await pool.query("UPDATE scans SET created_at = '2026-05-01T00:05:00Z' WHERE scan_id = '01K6HZQ4M8R2VXJ3T5N7P9B0CD'");
      await pool.query(`INSERT INTO "user" (id, name, email) VALUES ('named', 'Priya Raman', 'priya@example.com'), ('unnamed', NULL, 'tomas@example.com')`);
      await pool.query("UPDATE scans SET uploaded_by_user_id = 'named' WHERE scan_id = 'scan-current'");
      await pool.query("UPDATE scans SET uploaded_by_user_id = 'unnamed' WHERE scan_id = 'scan-previous'");
      await pool.query("DELETE FROM scan_read_models WHERE scan_id IN ('scan-current', '01K6HZQ4M8R2VXJ3T5N7P9B0CD')");
      await pool.query(`INSERT INTO scan_jobs (id, scan_id, projection_version, kind, state, error_message) VALUES
        ('current-job', 'scan-current', 1, 'scan', 'failed', 'Projection failed'), ('oldest-job', '01K6HZQ4M8R2VXJ3T5N7P9B0CD', 1, 'scan', 'failed', 'degraded: unknown_format')`);
      const history = await import("@/app/repos/[repoId]/scans/page");
      const [header, ...rows] = renderToStaticMarkup(await history.default(repoParams)).split("<tr").slice(1);
      expect(header).toMatch(/Committed.*Branch.*Commit.*Scanned<.*Scanned by<.*Scan ID/);
      const uploaders = rows.map(row => row.split("<td")[5] ?? "");
      expect(uploaders.map(cell => [cell.match(/title="([^"]+)"/)?.[1] ?? null, [...cell.matchAll(/>([^<]+)</g)].map(match => match[1]).join("")])).toEqual([
        ["priya@example.com", "Priya Raman"],
        ["tomas@example.com", "tomas@example.com"],
        [null, "—"],
      ]);
      expect(rows.map(row => {
        const cell = row.split("<td")[6] ?? "";
        return [cell.match(/title="([^"]+)"/)?.[1], cell.match(/>([^<]+)</)?.[1]];
      })).toEqual([
        ["scan-current", "scan-current"],
        ["scan-previous", "scan-previou"],
        ["01K6HZQ4M8R2VXJ3T5N7P9B0CD", "01K6HZQ4M8R2"],
      ]);
      expect(rows.map(row => [...row.matchAll(/title="([^"]+ UTC)"/g)].map(match => match[1]))).toEqual([
        ["2026-06-02 00:00 UTC", "2026-06-02 00:05 UTC"],
        ["2026-06-01 00:00 UTC", "2026-06-05 09:00 UTC"],
        ["2026-05-01 00:00 UTC", "2026-05-01 00:05 UTC"],
      ]);
      expect(rows.map(row => [...row.matchAll(/>(latest|couldn(?:'|&#x27;)t be prepared|can(?:'|&#x27;)t be read)</g)].map(match => match[1]?.replace("&#x27;", "'")))).toEqual([
        ["latest", "couldn't be prepared"],
        [],
        ["can't be read"],
      ]);
    });
  });

  it("serves API data after closing each snapshot", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const repos = await import("@/app/api/repos/route");
      const repo = await import("@/app/api/repos/[repoId]/route");
      const components = await import("@/app/api/components/route");
      const rows = await import("@/app/api/repos/[repoId]/components/route");
      const history = await import("@/app/api/repos/[repoId]/scans/route");
      const packages = await import("@/app/api/packages/route");
      const pkg = await import("@/app/api/packages/[packageName]/route");
      const request = (query = "") => new Request(`http://localhost/api${query}`);
      const recorder = recordQueries();
      const served = async (read: () => Promise<Response>) => {
        recorder.queries.length = 0;
        const response = await recorder.read(read);
        expect(response.status).toBe(200);
        expect(recorder.queries.filter(q => q.startsWith("BEGIN"))).toHaveLength(1);
        expect(recorder.queries.at(-1)).toBe("COMMIT");
        return response.json();
      };
      const repoList: RepoSummary[] = await served(repos.GET);
      expect(repoList.map(summary => summary.repoId).sort()).toEqual(["repo-a", "repo-b", "repo-empty"]);
      const componentList: ComponentSummary[] = await served(components.GET);
      expect(componentList.map(summary => summary.componentId)).toContain(button);
      const packageList: PackageSummary[] = await served(packages.GET);
      expect(packageList.map(summary => summary.packageName)).toContain("@sample/core");
      const newest: RepoDetail = await served(() => repo.GET(request(), repoParams));
      expect(newest.scanId).toBe("scan-current");
      const previous: RepoDetail = await served(() => repo.GET(request("?scan=scan-previous"), repoParams));
      expect(previous.scanId).toBe("scan-previous");
      const emptyScan: RepoDetail = await served(() => repo.GET(request("?scan="), repoParams));
      expect(emptyScan.scanId).toBe("scan-current");
      const repoRows: ComponentRow[] = await served(() => rows.GET(request(), repoParams));
      expect(repoRows.map(row => row.componentId)).toEqual(expect.arrayContaining([button, panel, otherPanel]));
      const localRows: ComponentRow[] = await served(() => rows.GET(request("?q=scope%3Alocal"), repoParams));
      expect(localRows.map(row => row.componentId).sort()).toEqual([panel, otherPanel].sort());
      const scans: ScanSummary[] = await served(() => history.GET(request(), repoParams));
      expect(scans.map(scan => scan.scanId)).toEqual(["scan-current", "scan-previous"]);
      const packageDetail: PackageDetail = await served(() => pkg.GET(request(), packageParams));
      expect(packageDetail.packageName).toBe("@sample/core");
      expect(packageDetail.cells.map(cell => cell.repoId)).toContain("repo-a");
      expect(packageDetail.components.map(row => row.componentId)).toContain(button);
      expect(recorder.forbiddenRawQueries).toEqual([]);
      expect(recorder.componentHeadOccurrenceQueries).toEqual([]);
    });
  });

  it("returns the preparing state on every surface while a repo is being rebuilt, and unknown repos stay 404", async () => {
    const state = "preparing";
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query("UPDATE scan_read_models SET format_version = format_version + 1 WHERE scan_id IN ('scan-current', 'scan-previous')");
      const { GET } = await import("@/app/api/repos/[repoId]/route");
      const response = await GET(new Request("http://localhost/api"), repoParams);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ state, scans: [], retryable: true });
      expect((await GET(new Request("http://localhost/api"), { params: Promise.resolve({ repoId: "missing" }) })).status).toBe(404);
      const { default: page, generateMetadata } = await import("@/app/repos/[repoId]/components/[componentId]/page");
      expect(propsFor(await page(componentParams), "ReadModelState")).toMatchObject({ state, scans: [] });
      const stateTitle = "Preparing scan data";
      expect(await generateMetadata(componentParams)).toEqual({ title: stateTitle });

      const repos = await import("@/app/api/repos/route");
      const components = await import("@/app/api/components/route");
      const rows = await import("@/app/api/repos/[repoId]/components/route");
      const history = await import("@/app/api/repos/[repoId]/scans/route");
      const packages = await import("@/app/api/packages/route");
      const pkg = await import("@/app/api/packages/[packageName]/route");
      const request = new Request("http://localhost/api");
      const reads: Array<() => Promise<Response>> = [repos.GET, components.GET, packages.GET,
        () => rows.GET(request, repoParams), () => history.GET(request, repoParams), () => pkg.GET(request, packageParams)];
      for (const read of reads) {
        const response = await read();
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ state, scans: [], retryable: true });
      }
      const reposPage = await import("@/app/repos/page");
      const packagesPage = await import("@/app/packages/page");
      const builder = await import("@/app/charts/new/page");
      const pages = [() => reposPage.default(), () => packagesPage.default(), () => builder.default({ searchParams: Promise.resolve({}) })];
      for (const page of pages) expect(propsFor(await page(), "ReadModelState")).toMatchObject({ state });
      const repo = await import("@/app/repos/[repoId]/page");
      const repoHistory = await import("@/app/repos/[repoId]/scans/page");
      const packageDetail = await import("@/app/packages/[packageName]/page");
      const cross = await import("@/app/components/[componentId]/page");
      for (const tree of [await repo.default({ ...repoParams, searchParams }), await repoHistory.default(repoParams), await packageDetail.default(packageParams), await cross.default(crossParams)]) {
        expect(propsFor(tree, "ReadModelState")).toMatchObject({ state });
      }
      expect(await repo.generateMetadata(repoParams)).toEqual({ title: "repo-a" });
      expect(await repoHistory.generateMetadata(repoParams)).toEqual({ title: "Scan history · repo-a" });
      expect(await packageDetail.generateMetadata(packageParams)).toEqual({ title: "@sample/core" });
      expect(await cross.generateMetadata(crossParams)).toEqual({ title: stateTitle });
      const unknown = { params: Promise.resolve({ repoId: "missing" }) };
      expect((await rows.GET(request, unknown)).status).toBe(404);
      expect((await history.GET(request, unknown)).status).toBe(404);
    });
  });

  it("keeps unknown component, package and scan resources distinct from unavailable data", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const repo = await import("@/app/api/repos/[repoId]/route");
      const pkg = await import("@/app/api/packages/[packageName]/route");
      expect((await repo.GET(new Request("http://localhost/api?scan=missing"), repoParams)).status).toBe(404);
      expect((await pkg.GET(new Request("http://localhost/api"), { params: Promise.resolve({ packageName: "missing" }) })).status).toBe(404);
      const component = await import("@/app/repos/[repoId]/components/[componentId]/page");
      const missing = { params: Promise.resolve({ repoId: "repo-a", componentId: "missing" }) };
      await expect(component.default(missing)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      await expect(component.generateMetadata(missing)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    });
  });

  it("propagates database failures instead of returning an empty page or API payload", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query("ALTER TABLE scan_component_facts RENAME TO unavailable_component_facts");
      const { default: page } = await import("@/app/packages/page");
      const { GET } = await import("@/app/api/packages/route");
      await expect(page()).rejects.toThrow();
      await expect(GET()).rejects.toThrow();
    });
  });
});
