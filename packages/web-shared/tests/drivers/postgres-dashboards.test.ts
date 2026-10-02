import { describe, it, expect, beforeEach } from "vitest";
import type { DashboardInput } from "../../src/dto.js";
import { useDriverDatabase } from "../helpers/driver-db.js";

const baseInput: DashboardInput = {
  name: "web vs legacy",
  description: null,
  config: { scope: { kind: "all" }, cohorts: [{ kind: "tag", tagId: "web" }], chartType: "trend", metric: "count" },
};

/** Seeded per test: the FK on created_by_user_id is real once migrated. */
const CREATOR = "u1";

describe.skipIf(!process.env.DATABASE_URL)("PostgresDriver dashboards", () => {
  const db = useDriverDatabase();

  beforeEach(async () => {
    await db.pool.query("DELETE FROM scan_jobs");
    await db.pool.query("DELETE FROM dashboards");
    await db.pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [CREATOR, "Creator", "creator-dashboards-test@example.com"],
    );
  });

  it("creates, gets, updates, lists, deletes", async () => {
    const created = await db.driver.upsertDashboard({ ...baseInput, createdByUserId: null });
    expect(created.id).toBeTruthy();
    expect(await db.driver.getDashboard(created.id)).toEqual(created);
    expect(created.createdByUserId).toBeNull();

    const updated = await db.driver.upsertDashboard({ id: created.id, name: "renamed", description: "d", config: baseInput.config });
    expect(updated.name).toBe("renamed");
    expect(updated.description).toBe("d");
    expect(updated.createdAt).toBe(created.createdAt); // ON CONFLICT preserves created_at

    await db.driver.withReadSnapshot(async snapshot => {
      expect((await snapshot.listDashboards()).map((d) => d.name)).toEqual(["renamed"]);
      expect(await snapshot.getDashboard(updated.id)).toEqual(updated);
    });

    await db.driver.deleteDashboard(created.id);
    expect(await db.driver.listDashboards()).toEqual([]);
    expect(await db.driver.getDashboard(created.id)).toBeNull();
  });

  it("round-trips the config jsonb structurally", async () => {
    const cfg = { scope: { kind: "repo" as const, repoId: "example-web" }, cohorts: [{ kind: "tag" as const, tagId: "web" }, { kind: "local" as const }], chartType: "stacked-share" as const, metric: "share" as const };
    const created = await db.driver.upsertDashboard({ name: "mix", description: null, config: cfg });
    expect((await db.driver.getDashboard(created.id))?.config).toEqual(cfg);
  });

  it("update cannot overwrite createdByUserId (immutable creator)", async () => {
    const created = await db.driver.upsertDashboard({ ...baseInput, createdByUserId: CREATOR });
    const updated = await db.driver.upsertDashboard({ id: created.id, name: "x", description: null, config: baseInput.config, createdByUserId: "attacker" });
    expect(updated.createdByUserId).toBe(CREATOR);
  });

  it("queues one chart results job with each upsert and delete", async () => {
    const created = await db.driver.upsertDashboard(baseInput);
    expect(await db.queuedResults()).toBe(1);
    await db.pool.query("DELETE FROM scan_jobs");
    await db.driver.upsertDashboard({ ...baseInput, id: created.id, name: "renamed" });
    expect(await db.queuedResults()).toBe(1);
    await db.pool.query("DELETE FROM scan_jobs");
    await db.driver.deleteDashboard(created.id);
    expect(await db.queuedResults()).toBe(1);
  });
});
