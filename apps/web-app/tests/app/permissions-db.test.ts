import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { DashboardInput, GovernanceInput, TagInput } from "@scoutui/web-shared";
import { deleteDashboard, saveDashboard, setDashboardVisibility } from "@/app/charts/dashboard-actions";
import { deleteGovernance, saveGovernance } from "@/app/governance/governance-actions";
import { deleteTag, quickTagPackage, saveTag } from "@/app/packages/tag-actions";
import { getPool } from "@/db/client";
import { CHART_REFUSAL, EDIT_REFUSAL } from "@/lib/access";
import { getStorage } from "@/lib/storage";
import { insertPerson } from "../helpers/people";
import { openReadModelDatabase } from "../helpers/read-model-db";

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => session.current) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => navigation);

// biome-ignore lint/complexity/useLiteralKeys: env access
const RUN_DB = process.env["DATABASE_URL"] != null;

const dashboard: DashboardInput = {
  name: "Local usage",
  description: null,
  config: { scope: { kind: "all" }, cohorts: [{ kind: "local" }], chartType: "trend", metric: "count" },
  visibility: "everyone",
};
const governance: GovernanceInput = {
  grain: "component",
  targetPackage: "@example/old",
  targetExport: "Button",
  disposition: { kind: "retired", reason: "Use the new button" },
};
const tag: TagInput = { value: "core", category: "library", color: "teal", rule: { glob: ["@example/*"], exact: [] } };

describe.skipIf(!RUN_DB)("edit actions against PostgreSQL", () => {
  let pool: Pool;
  let database: ReturnType<typeof openReadModelDatabase>;
  let viewer: string;
  let editor: string;

  const signInAs = (userId: string) => {
    session.current = { user: { id: userId } };
  };
  const count = async (table: "dashboards" | "governance" | "tags"): Promise<number> =>
    (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  const exactPackages = async (tagId: string): Promise<string[]> =>
    (await pool.query("SELECT rule->'exact' AS exact FROM tags WHERE id = $1", [tagId])).rows[0].exact;

  beforeAll(async () => {
    database = openReadModelDatabase();
    pool = await database.pool;
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
  });

  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", pool.options.connectionString);
    viewer = await insertPerson(pool, { email: "ana@example.com" });
    editor = await insertPerson(pool, { email: "bo@example.com", role: "editor" });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    session.current = null;
    navigation.redirect.mockClear();
    await pool.query("DELETE FROM dashboards");
    await pool.query("DELETE FROM governance");
    await pool.query("DELETE FROM tags");
    await pool.query('DELETE FROM "user"');
  });

  afterAll(async () => {
    await getPool().end();
    vi.unstubAllEnvs();
    await database.close();
  });

  describe("charts", () => {
    it("refuses a Viewer's new chart without storing it, and saves an Editor's and opens it", async () => {
      signInAs(viewer);
      expect(await saveDashboard(dashboard)).toEqual({ ok: false, error: EDIT_REFUSAL });
      expect(await count("dashboards")).toBe(0);
      expect(navigation.redirect).not.toHaveBeenCalled();

      signInAs(editor);
      await saveDashboard(dashboard);
      const { rows } = await pool.query("SELECT id, visibility FROM dashboards");
      expect(rows).toEqual([{ id: expect.any(String), visibility: "everyone" }]);
      expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith(`/charts/${rows[0].id}`);
    });

    it("refuses an Editor's save over a chart that no longer exists, and stores nothing", async () => {
      signInAs(editor);
      expect(await saveDashboard({ ...dashboard, id: "deleted-chart" })).toEqual({ ok: false, error: "This chart was deleted." });
      expect(await count("dashboards")).toBe(0);
    });

    it("refuses a Viewer's delete and keeps the chart, and deletes it for the Editor who made it", async () => {
      const { id } = await getStorage().upsertDashboard({ ...dashboard, createdByUserId: editor });
      signInAs(viewer);
      expect(await deleteDashboard(id)).toEqual({ ok: false, error: EDIT_REFUSAL });
      expect(await count("dashboards")).toBe(1);

      signInAs(editor);
      expect(await deleteDashboard(id)).toEqual({ ok: true });
      expect(await count("dashboards")).toBe(0);
    });

    it("refuses another Editor's save over a chart, and who can see it with it, and their delete, and allows them for an Admin", async () => {
      const other = await insertPerson(pool, { email: "cy@example.com", role: "editor" });
      const admin = await insertPerson(pool, { email: "di@example.com", role: "admin" });
      const { id } = await getStorage().upsertDashboard({ ...dashboard, visibility: "private", createdByUserId: editor });

      signInAs(other);
      expect(await saveDashboard({ ...dashboard, id, name: "Taken over" })).toEqual({ ok: false, error: CHART_REFUSAL });
      expect(await deleteDashboard(id)).toEqual({ ok: false, error: CHART_REFUSAL });
      expect(await getStorage().getDashboard(id)).toMatchObject({ name: "Local usage", visibility: "private" });

      signInAs(admin);
      await saveDashboard({ ...dashboard, id, name: "Renamed by an Admin" });
      expect(await getStorage().getDashboard(id)).toMatchObject({ name: "Renamed by an Admin", createdByUserId: editor, visibility: "everyone" });
      expect(await deleteDashboard(id)).toEqual({ ok: true });
      expect(await count("dashboards")).toBe(0);
    });

    it("lets a chart's creator and an Admin share it or make it private, and refuses another Editor", async () => {
      const other = await insertPerson(pool, { email: "cy@example.com", role: "editor" });
      const admin = await insertPerson(pool, { email: "di@example.com", role: "admin" });
      const { id } = await getStorage().upsertDashboard({ ...dashboard, visibility: "private", createdByUserId: editor });
      const visibility = async () => (await getStorage().getDashboard(id))?.visibility;

      signInAs(other);
      expect(await setDashboardVisibility(id, "everyone")).toEqual({ ok: false, error: CHART_REFUSAL });
      expect(await visibility()).toBe("private");

      signInAs(editor);
      expect(await setDashboardVisibility(id, "everyone")).toEqual({ ok: true });
      expect(await visibility()).toBe("everyone");

      signInAs(admin);
      expect(await setDashboardVisibility(id, "private")).toEqual({ ok: true });
      expect(await visibility()).toBe("private");
    });
  });

  describe("governance", () => {
    it("refuses a Viewer's new record without storing it, and saves an Editor's", async () => {
      signInAs(viewer);
      expect(await saveGovernance(governance)).toEqual({ ok: false, error: EDIT_REFUSAL });
      expect(await count("governance")).toBe(0);

      signInAs(editor);
      const saved = await saveGovernance(governance);
      const { rows } = await pool.query("SELECT id FROM governance");
      expect(rows).toHaveLength(1);
      expect(saved).toEqual({ ok: true, id: rows[0].id });
    });

    it("refuses a Viewer's delete and keeps the record, and deletes it for an Editor", async () => {
      const { id } = await getStorage().createGovernance(governance);
      signInAs(viewer);
      expect(await deleteGovernance(id)).toEqual({ ok: false, error: EDIT_REFUSAL });
      expect(await count("governance")).toBe(1);

      signInAs(editor);
      expect(await deleteGovernance(id)).toEqual({ ok: true });
      expect(await count("governance")).toBe(0);
    });
  });

  describe("tags", () => {
    it("refuses a Viewer's new tag without storing it, and saves an Editor's", async () => {
      signInAs(viewer);
      expect(await saveTag(tag)).toEqual({ ok: false, error: EDIT_REFUSAL });
      expect(await count("tags")).toBe(0);

      signInAs(editor);
      expect(await saveTag(tag)).toEqual({ ok: true });
      expect(await count("tags")).toBe(1);
    });

    it("refuses a Viewer's delete and keeps the tag, and deletes it for an Editor", async () => {
      const { id } = await getStorage().upsertTag(tag);
      signInAs(viewer);
      expect(await deleteTag(id)).toEqual({ ok: false, error: EDIT_REFUSAL });
      expect(await count("tags")).toBe(1);

      signInAs(editor);
      expect(await deleteTag(id)).toEqual({ ok: true });
      expect(await count("tags")).toBe(0);
    });

    it("refuses a Viewer's quick tag and leaves the tag as it was, and adds the package for an Editor", async () => {
      const { id } = await getStorage().upsertTag(tag);
      signInAs(viewer);
      expect(await quickTagPackage(id, "@example/button", true)).toEqual({ ok: false, error: EDIT_REFUSAL });
      expect(await exactPackages(id)).toEqual([]);

      signInAs(editor);
      expect(await quickTagPackage(id, "@example/button", true)).toEqual({ ok: true });
      expect(await exactPackages(id)).toEqual(["@example/button"]);
    });
  });

  describe("a promotion", () => {
    it("lets a Viewer made an Editor save on their next call", async () => {
      signInAs(viewer);
      expect(await saveTag(tag)).toEqual({ ok: false, error: EDIT_REFUSAL });
      await pool.query(`UPDATE "user" SET role = 'editor' WHERE id = $1`, [viewer]);
      expect(await saveTag(tag)).toEqual({ ok: true });
      expect(await count("tags")).toBe(1);
    });
  });
});
