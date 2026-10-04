import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { componentKey } from "@scoutui/scan-format";
import { PostgresDriver, type DashboardConfig, type StorageDriver } from "@scoutui/web-shared";
import { artifact, component, packageExport, resolvedAt } from "../../../../packages/web-shared/tests/helpers/builders.ts";
import { genericArtifacts } from "../../../../packages/web-shared/tests/helpers/fixtures.ts";
import { publishScan } from "../../src/lib/scan-projection.ts";
import { withReadModelDatabase } from "../helpers/read-model-db.ts";

const { DATABASE_URL: databaseUrl } = process.env;

let driver: StorageDriver;
let database: Pool;
let session: { user: { id: string } } | null = null;
vi.mock("@/lib/storage", () => ({ getStorage: () => driver }));
vi.mock("@/db/client", () => ({ getPool: () => database }));
vi.mock("@/lib/identity", () => ({
  requireEditor: async () => session ? { ok: true, userId: session.user.id } : { ok: false, error: "not_authenticated" },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** The text the page renders itself, joined; child components are not rendered. */
function textOf(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : "";
  }).join("");
}

function propsOf(node: ReactNode, name: string): Record<string, unknown> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (typeof child.type === "function" && child.type.name === name) return child.props;
    const nested = propsOf(child.props.children, name);
    if (nested) return nested;
  }
}

async function seed(pool: Pool) {
  for (const artifact of genericArtifacts()) await publishScan(pool, artifact, { uploadedByUserId: null });
  driver = new PostgresDriver(pool);
  database = pool;
}

async function renderSaved(config: DashboardConfig) {
  const saved = await driver.upsertDashboard({ name: "Saved", description: null, config });
  const { default: page } = await import("@/app/charts/[dashboardId]/page");
  return page({ params: Promise.resolve({ dashboardId: saved.id }), searchParams: Promise.resolve({}) });
}

describe.skipIf(!databaseUrl)("saved chart page", { timeout: 30_000 }, () => {
  afterEach(() => {
    session = null;
    vi.restoreAllMocks();
  });

  it("shows an empty state when none of a chart's components can be found, and nothing extra when some can", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const button = componentKey(packageExport("@sample/core", "Button"));
      const missing = await renderSaved({ scope: { kind: "all" }, cohorts: [{ kind: "component", componentId: "v1-logical-id" }, { kind: "component", componentId: "v1-labelled-id", label: "Old button" }], chartType: "trend", metric: "count" });
      const partly = await renderSaved({ scope: { kind: "all" }, cohorts: [{ kind: "component", componentId: "v1-logical-id" }, { kind: "component", componentId: button }], chartType: "trend", metric: "count" });
      const current = await renderSaved({ scope: { kind: "all" }, cohorts: [{ kind: "component", componentId: button }], chartType: "trend", metric: "count" });
      expect(propsOf(missing, "EmptyState")).toMatchObject({
        title: "Couldn't find the components in this chart.",
        description: "Edit the chart to pick them again.",
      });
      expect(propsOf(missing, "DashboardChart")).toBeUndefined();
      expect(propsOf(partly, "EmptyState")).toBeUndefined();
      expect(textOf(partly)).toBe(textOf(current));
    });
  });

  it("names a bars series that only an older scan holds, at 0, reading only that component from older scans", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const retired = component(packageExport("@sample/core", "RetiredBadge"));
      await publishScan(pool, artifact({
        repoId: "repo-a", scanId: "scan-oldest", scannedAt: "2026-05-01T00:00:00Z",
        components: [retired], occurrences: [resolvedAt(retired, "src/app.tsx", 1)],
      }), { uploadedByUserId: null });
      const digests = vi.spyOn(PostgresDriver.prototype, "listScanDigests");
      const tree = await renderSaved({ scope: { kind: "all" }, cohorts: [{ kind: "component", componentId: retired.id }], chartType: "bars", metric: "count" });
      expect(propsOf(tree, "EmptyState")).toBeUndefined();
      expect(propsOf(tree, "DashboardChart")).toMatchObject({ view: {
        kind: "snapshot",
        points: [{ cohortKey: `component:${retired.id}`, label: "RetiredBadge · @sample/core", color: "", value: 0, componentCount: 0 }],
      } });
      expect(digests.mock.calls).toEqual([[undefined, { latestOnly: true }], [undefined, { componentIds: [retired.id] }]]);
    });
  });

  it("says a chart's repo has no scans yet when the repo exists without scans", async () => {
    await withReadModelDatabase(async pool => {
      await pool.query("INSERT INTO repos (repo_id) VALUES ('repo-unscanned')");
      await seed(pool);
      const tree = await renderSaved({ scope: { kind: "repo", repoId: "repo-unscanned" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" });
      expect(propsOf(tree, "EmptyState")).toMatchObject({
        title: "This chart's repo has no scans yet.",
        description: "This chart fills in once the first scan of repo-unscanned is uploaded.",
      });
      expect(propsOf(tree, "DashboardScopeBadge")).toMatchObject({ missing: "scans" });
    });
  });

  it("says a chart's repo may have been renamed or deleted when the repo does not exist", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const tree = await renderSaved({ scope: { kind: "repo", repoId: "repo-gone" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" });
      expect(propsOf(tree, "EmptyState")).toMatchObject({
        title: "This chart's repo no longer exists.",
        description: "There are no scans for repo-gone any more. It may have been renamed or deleted. Edit the chart to pick another repo, or delete it.",
      });
      expect(propsOf(tree, "DashboardScopeBadge")).toMatchObject({ missing: "repo" });
    });
  });

  it("opens a saved chart in the editor and saves the edit over it", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query(`INSERT INTO "user" (id, name, email) VALUES ('maker', 'Maker', 'maker@example.com'), ('editor', 'Editor', 'editor@example.com')`);
      const { saveDashboard } = await import("@/app/charts/dashboard-actions");
      const { default: editPage } = await import("@/app/charts/[dashboardId]/edit/page");
      const button = componentKey(packageExport("@sample/core", "Button"));
      const first: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" };
      const edited: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "local" }, { kind: "component", componentId: button }], chartType: "bars", metric: "share" };

      session = { user: { id: "maker" } };
      await expect(saveDashboard({ name: "Button rollout", description: "Kept", config: first })).rejects.toThrow("NEXT_REDIRECT");
      const [created] = await driver.listDashboards();
      if (!created) throw new Error("Expected the saved chart");
      const opened = await editPage({ params: Promise.resolve({ dashboardId: created.id }) });
      expect(propsOf(opened, "DashboardBuilder")).toMatchObject({ saved: { id: created.id, name: "Button rollout", description: "Kept", config: first } });

      session = { user: { id: "editor" } };
      await expect(saveDashboard({ id: created.id, name: "Button rollout again", description: "Kept", config: edited })).rejects.toThrow("NEXT_REDIRECT");
      expect(await driver.listDashboards()).toHaveLength(1);
      expect(await driver.getDashboard(created.id)).toMatchObject({ name: "Button rollout again", description: "Kept", config: edited, createdByUserId: "maker" });
    });
  });
});
