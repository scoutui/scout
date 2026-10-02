import { describe, it, expect, beforeEach } from "vitest";
import { useDriverDatabase } from "../helpers/driver-db.js";

describe.skipIf(!process.env.DATABASE_URL)("PostgresDriver tags", () => {
  const db = useDriverDatabase();
  beforeEach(async () => { await db.pool.query("DELETE FROM scan_jobs"); await db.pool.query("DELETE FROM tags"); });

  it("creates, lists, updates and deletes", async () => {
    const created = await db.driver.upsertTag({ value: "web", category: "library", color: "#000", rule: { glob: ["@scope/web-*"], exact: [] } });
    expect((await db.driver.listTags()).map(t => t.id)).toContain(created.id);
    const updated = await db.driver.upsertTag({ id: created.id, value: "web", category: "library", color: "#fff", rule: { glob: [], exact: ["x"] } });
    // biome-ignore lint/style/noNonNullAssertion: fixture-driven test; element existence asserted by surrounding expectations
    const fromDb = (await db.driver.listTags()).find(t => t.id === created.id)!;
    expect(fromDb.color).toBe("#fff");
    expect(fromDb.rule).toEqual({ glob: [], exact: ["x"] });
    await db.driver.deleteTag(created.id);
    expect((await db.driver.listTags()).find(t => t.id === created.id)).toBeUndefined();
  });

  it("records who created a tag and who last changed it, and keeps the tag when an author's account goes", async () => {
    await db.pool.query(
      `INSERT INTO "user" (id, email) VALUES ('tag-author-a', 'tag-author-a@example.com'), ('tag-author-b', 'tag-author-b@example.com') ON CONFLICT (id) DO NOTHING`,
    );
    const authors = async (id: string) =>
      (await db.pool.query("SELECT created_by_user_id, updated_by_user_id FROM tags WHERE id = $1", [id])).rows;

    const created = await db.driver.upsertTag({ value: "web", category: null, color: "#000", rule: { glob: [], exact: [] } }, "tag-author-a");
    expect(await authors(created.id)).toEqual([{ created_by_user_id: "tag-author-a", updated_by_user_id: "tag-author-a" }]);

    await db.driver.upsertTag({ id: created.id, value: "web", category: null, color: "#fff", rule: { glob: [], exact: [] } }, "tag-author-b");
    expect(await authors(created.id)).toEqual([{ created_by_user_id: "tag-author-a", updated_by_user_id: "tag-author-b" }]);

    await db.pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [["tag-author-a", "tag-author-b"]]);
    expect(await authors(created.id)).toEqual([{ created_by_user_id: null, updated_by_user_id: null }]);
  });

  it("queues one chart results job with each upsert and delete", async () => {
    const tag = await db.driver.upsertTag({ value: "web", category: "library", color: "#000", rule: { glob: ["@scope/web-*"], exact: [] } });
    expect(await db.queuedResults()).toBe(1);
    await db.pool.query("DELETE FROM scan_jobs");
    await db.driver.deleteTag(tag.id);
    expect(await db.queuedResults()).toBe(1);
  });

  it("rejects writes through a read snapshot", async () => {
    await expect(db.driver.withReadSnapshot(snapshot => snapshot.upsertTag({ value: "web", category: null, color: "#000", rule: { glob: [], exact: [] } })))
      .rejects.toThrow(/snapshot/);
    expect(await db.driver.listTags()).toEqual([]);
    expect(await db.queuedResults()).toBe(0);
  });
});
