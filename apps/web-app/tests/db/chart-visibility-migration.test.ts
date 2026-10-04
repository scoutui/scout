import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withReadModelDatabase } from "../helpers/read-model-db";

const { DATABASE_URL: databaseUrl } = process.env;
describe.skipIf(!databaseUrl)("chart visibility migration", { timeout: 30_000 }, () => {
  it("shares every chart saved before the upgrade with everyone, and makes later charts private", async () => {
    await withReadModelDatabase(async pool => {
      await pool.query("ALTER TABLE dashboards DROP CONSTRAINT dashboards_visibility, DROP COLUMN visibility");
      await pool.query(`INSERT INTO dashboards (id, name, config) VALUES ('kits', 'Kits', '{}'), ('rollout', 'Rollout', '{}')`);

      await pool.query(readFileSync(new URL("../../drizzle/migrations/0010_chart_visibility.sql", import.meta.url), "utf8"));

      expect((await pool.query("SELECT id, visibility FROM dashboards ORDER BY id")).rows).toEqual([
        { id: "kits", visibility: "everyone" },
        { id: "rollout", visibility: "everyone" },
      ]);
      await pool.query(`INSERT INTO dashboards (id, name, config) VALUES ('new', 'New', '{}')`);
      expect((await pool.query(`SELECT visibility FROM dashboards WHERE id = 'new'`)).rows).toEqual([{ visibility: "private" }]);
      await expect(pool.query(`UPDATE dashboards SET visibility = 'team' WHERE id = 'new'`)).rejects.toThrow(/dashboards_visibility/);
    });
  });
});
