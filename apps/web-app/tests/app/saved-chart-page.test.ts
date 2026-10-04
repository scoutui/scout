import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { componentKey } from "@scoutui/scan-format";
import { PostgresDriver, type DashboardConfig, type DashboardInput, type StorageDriver } from "@scoutui/web-shared";
import { artifact, component, packageExport, resolvedAt } from "../../../../packages/web-shared/tests/helpers/builders.ts";
import { genericArtifacts } from "../../../../packages/web-shared/tests/helpers/fixtures.ts";
import { publishScan } from "../../src/lib/scan-projection.ts";
import type { Person } from "../../src/lib/access.ts";
import { withReadModelDatabase } from "../helpers/read-model-db.ts";

const { DATABASE_URL: databaseUrl } = process.env;

let driver: StorageDriver;
let database: Pool;
let session: { user: { id: string } } | null = null;
const editor: Person = { kind: "person", userId: "reader", email: "ana@example.com", name: null, role: "editor", roleSource: "people" };
let reader = editor;
vi.mock("@/lib/storage", () => ({ getStorage: () => driver }));
vi.mock("@/db/client", () => ({ getPool: () => database }));
vi.mock("@/lib/identity", () => ({
  identify: async () => reader,
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

function hrefsIn(node: ReactNode, found: string[] = []): string[] {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; href?: unknown }>(child)) continue;
    if (typeof child.props.href === "string") found.push(child.props.href);
    hrefsIn(child.props.children, found);
  }
  return found;
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
  await pool.query(`INSERT INTO "user" (id, name, email) VALUES ('reader', 'Ana Lopez', 'ana@example.com')`);
  driver = new PostgresDriver(pool);
  database = pool;
}

async function renderSaved(config: DashboardConfig, chart: Partial<DashboardInput> = {}, searchParams: Record<string, string> = {}) {
  const saved = await driver.upsertDashboard({ visibility: "everyone", name: "Saved", description: null, config, createdByUserId: "reader", ...chart });
  const { default: page } = await import("@/app/charts/[dashboardId]/page");
  return page({ params: Promise.resolve({ dashboardId: saved.id }), searchParams: Promise.resolve(searchParams) });
}

describe.skipIf(!databaseUrl)("saved chart page", { timeout: 30_000 }, () => {
  afterEach(() => {
    session = null;
    reader = editor;
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
      expect(propsOf(missing, "LinkedDashboardChart")).toBeUndefined();
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
      expect(propsOf(tree, "LinkedDashboardChart")).toMatchObject({ view: {
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

  it("shows Edit, Delete and how to fix a chart to its creator and an Admin, and Duplicate to every Editor", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const goneRepo: DashboardConfig = { scope: { kind: "repo", repoId: "repo-gone" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" };
      const lostComponents: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "component", componentId: "v1-logical-id" }], chartType: "trend", metric: "count" };
      const editLinks = (tree: ReactNode) => hrefsIn(tree).filter(href => href.endsWith("/edit"));
      const anas = { createdByUserId: "reader" };

      reader = { ...editor, role: "viewer" };
      const viewerGone = await renderSaved(goneRepo, anas);
      expect(editLinks(viewerGone)).toEqual([]);
      expect(propsOf(viewerGone, "DeleteDashboardButton")).toBeUndefined();
      expect(propsOf(viewerGone, "ChartMenu")).toEqual({ id: expect.any(String), canDuplicate: false, visibility: null, exportSubmenu: true });
      expect(propsOf(viewerGone, "EmptyState")).toMatchObject({
        title: "This chart's repo no longer exists.",
        description: "There are no scans for repo-gone any more. It may have been renamed or deleted.",
      });
      expect(propsOf(await renderSaved(lostComponents, anas), "EmptyState")).toEqual({
        icon: expect.anything(),
        title: "Couldn't find the components in this chart.",
      });

      reader = { ...editor, userId: "someone-else" };
      const otherEditorGone = await renderSaved(goneRepo, anas);
      expect(editLinks(otherEditorGone)).toEqual([]);
      expect(propsOf(otherEditorGone, "DeleteDashboardButton")).toBeUndefined();
      expect(propsOf(otherEditorGone, "ChartMenu")).toEqual({ id: expect.any(String), canDuplicate: true, visibility: null, exportSubmenu: true });
      expect(propsOf(otherEditorGone, "EmptyState")).toMatchObject({ description: "There are no scans for repo-gone any more. It may have been renamed or deleted." });

      reader = editor;
      const creatorGone = await renderSaved(goneRepo, anas);
      expect(editLinks(creatorGone)).toHaveLength(1);
      expect(propsOf(creatorGone, "DeleteDashboardButton")).toEqual({ id: expect.any(String) });
      expect(propsOf(creatorGone, "ChartMenu")).toEqual({ id: expect.any(String), canDuplicate: true, visibility: "everyone", exportSubmenu: true });
      expect(propsOf(creatorGone, "EmptyState")).toMatchObject({ description: expect.stringContaining("Edit the chart to pick another repo") });

      reader = { ...editor, userId: "someone-else", role: "admin" };
      const adminGone = await renderSaved(goneRepo, anas);
      expect(editLinks(adminGone)).toHaveLength(1);
      expect(propsOf(adminGone, "DeleteDashboardButton")).toEqual({ id: expect.any(String) });
    });
  });

  it("gives a Viewer the chart's menu to export it under its name, and never hands the menu the chart's view", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      reader = { ...editor, role: "viewer" };
      const tree = await renderSaved({ scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" }, { name: "Local usage" });
      expect(propsOf(tree, "LinkedDashboardChart")).toMatchObject({ view: { kind: "series" } });
      expect(propsOf(tree, "ChartExportProvider")).toEqual({ title: "Local usage", children: expect.anything() });
      expect(propsOf(tree, "ChartMenu")).toEqual({ id: expect.any(String), canDuplicate: false, visibility: null, exportSubmenu: true });
    });
  });

  it("opens a chart at the range in its link, else at its saved range, else at All", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const config: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" };
      expect(propsOf(await renderSaved(config), "LinkedDashboardChart")).toMatchObject({ range: "all" });
      expect(propsOf(await renderSaved({ ...config, range: "6m" }), "LinkedDashboardChart")).toMatchObject({ range: "6m" });
      expect(propsOf(await renderSaved({ ...config, range: "6m" }, {}, { range: "1y" }), "LinkedDashboardChart")).toMatchObject({ range: "1y" });
      expect(propsOf(await renderSaved({ ...config, range: "6m" }, {}, { range: "2y" }), "LinkedDashboardChart")).toMatchObject({ range: "6m" });
    });
  });

  it("names the chart's creator and marks a private chart, and shows anyone else only that it's private", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const config: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" };
      const { generateMetadata } = await import("@/app/charts/[dashboardId]/page");
      const saved = await driver.upsertDashboard({ visibility: "private", name: "Secret rollout", description: null, config, createdByUserId: "reader" });
      const open = async () => (await import("@/app/charts/[dashboardId]/page")).default({ params: Promise.resolve({ dashboardId: saved.id }), searchParams: Promise.resolve({}) });

      const own = await open();
      expect(textOf(own)).toContain("Created by Ana Lopez");
      expect(textOf(own)).toContain("Private");
      expect(propsOf(own, "LinkedDashboardChart")).toBeDefined();
      expect(await generateMetadata({ params: Promise.resolve({ dashboardId: saved.id }) })).toEqual({ title: "Secret rollout" });

      reader = { ...editor, userId: "someone-else" };
      const theirs = await open();
      expect(propsOf(theirs, "LinkedDashboardChart")).toBeUndefined();
      expect(propsOf(theirs, "ChartMenu")).toBeUndefined();
      expect(propsOf(theirs, "EmptyState")).toEqual({ titleAs: "h1", title: "This chart is private.", description: "Ask Ana Lopez to share it with everyone." });
      expect(textOf(theirs)).not.toContain("Secret rollout");
      expect(await generateMetadata({ params: Promise.resolve({ dashboardId: saved.id }) })).toEqual({ title: "Private chart" });

      reader = { ...editor, userId: "someone-else", role: "admin" };
      expect(propsOf(await open(), "LinkedDashboardChart")).toBeDefined();

      reader = editor;
      const everyone = textOf(await renderSaved(config, { createdByUserId: null }));
      expect(everyone).not.toContain("Created by");
      expect(everyone).not.toContain("Private");
    });
  });

  it("tells anyone else to ask an Admin once the creator was removed or deleted, and still names a removed creator", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const config: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" };
      const saved = await driver.upsertDashboard({ visibility: "private", name: "Secret rollout", description: null, config, createdByUserId: "reader" });
      const open = async () => (await import("@/app/charts/[dashboardId]/page")).default({ params: Promise.resolve({ dashboardId: saved.id }), searchParams: Promise.resolve({}) });
      const askAnAdmin = { titleAs: "h1", title: "This chart is private.", description: "Ask an Admin to share it with everyone." };

      await pool.query(`UPDATE "user" SET role = NULL WHERE id = 'reader'`);
      reader = { ...editor, userId: "someone-else" };
      expect(propsOf(await open(), "EmptyState")).toEqual(askAnAdmin);
      reader = { ...editor, userId: "someone-else", role: "admin" };
      expect(textOf(await open())).toContain("Created by Ana Lopez");

      await pool.query(`DELETE FROM "user" WHERE id = 'reader'`);
      reader = { ...editor, userId: "someone-else" };
      expect(propsOf(await open(), "EmptyState")).toEqual(askAnAdmin);
    });
  });

  it("opens a copy of a chart in the builder for someone who can open it, and shows anyone else only that it's private", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query(`INSERT INTO "user" (id, name, email) VALUES ('maker', 'Maker', 'maker@example.com')`);
      const { default: newPage } = await import("@/app/charts/new/page");
      const config: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" };
      const shared = await driver.upsertDashboard({ visibility: "everyone", name: "Local usage", description: "Kept", config, createdByUserId: "maker" });
      const hidden = await driver.upsertDashboard({ visibility: "private", name: "Secret rollout", description: null, config, createdByUserId: "maker" });
      const copy = (from: string) => newPage({ searchParams: Promise.resolve({ from }) });

      expect(propsOf(await copy(shared.id), "DashboardBuilder")).toMatchObject({
        saved: { id: shared.id, name: "Copy of Local usage", description: "Kept", config },
        duplicate: true,
      });
      expect(propsOf(await copy(hidden.id), "DashboardBuilder")).toBeUndefined();
      expect(propsOf(await copy(hidden.id), "EmptyState")).toMatchObject({ title: "This chart is private." });
      await expect(copy("missing")).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
      expect(propsOf(await newPage({ searchParams: Promise.resolve({}) }), "DashboardBuilder")).not.toHaveProperty("saved");
    });
  });

  it("opens a saved chart in the editor for its creator, refuses anyone else, and saves an Admin's edit over it", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await pool.query(`INSERT INTO "user" (id, name, email) VALUES ('maker', 'Maker', 'maker@example.com'), ('admin', 'Admin', 'admin@example.com')`);
      const { saveDashboard } = await import("@/app/charts/dashboard-actions");
      const { default: editPage } = await import("@/app/charts/[dashboardId]/edit/page");
      const button = componentKey(packageExport("@sample/core", "Button"));
      const first: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" };
      const edited: DashboardConfig = { scope: { kind: "all" }, cohorts: [{ kind: "local" }, { kind: "component", componentId: button }], chartType: "trend", metric: "share", range: "6m" };

      session = { user: { id: "maker" } };
      reader = { ...editor, userId: "maker" };
      await expect(saveDashboard({ name: "Button rollout", description: "Kept", config: first })).rejects.toThrow("NEXT_REDIRECT");
      const [created] = await driver.listDashboards();
      if (!created) throw new Error("Expected the saved chart");
      const edit = () => editPage({ params: Promise.resolve({ dashboardId: created.id }) });
      expect(propsOf(await edit(), "DashboardBuilder")).toMatchObject({ saved: { id: created.id, name: "Button rollout", description: "Kept", config: first } });

      reader = editor;
      expect(propsOf(await edit(), "EmptyState")).toEqual({ titleAs: "h1", title: "This chart is private.", description: "Ask Maker to share it with everyone." });
      await driver.setDashboardVisibility(created.id, "everyone");
      const refused = await edit();
      expect(propsOf(refused, "DashboardBuilder")).toBeUndefined();
      expect(propsOf(refused, "EmptyState")).toMatchObject({ titleAs: "h1", title: "Only the chart's creator or an Admin can change it." });
      const { action } = propsOf(refused, "EmptyState") ?? {};
      expect(hrefsIn(action as ReactNode)).toEqual([`/charts/new?from=${encodeURIComponent(created.id)}`]);

      session = { user: { id: "admin" } };
      reader = { ...editor, userId: "admin", role: "admin" };
      await expect(saveDashboard({ id: created.id, name: "Button rollout again", description: "Kept", config: edited })).rejects.toThrow("NEXT_REDIRECT");
      expect(await driver.listDashboards()).toHaveLength(1);
      expect(await driver.getDashboard(created.id)).toMatchObject({ name: "Button rollout again", description: "Kept", config: edited, createdByUserId: "maker" });
    });
  });
});
