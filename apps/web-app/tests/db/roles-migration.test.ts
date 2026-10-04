import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withReadModelDatabase } from "../helpers/read-model-db";

const { DATABASE_URL: databaseUrl } = process.env;
describe.skipIf(!databaseUrl)("roles migration", { timeout: 30_000 }, () => {
  it("makes everyone who signed in before the upgrade an Editor, and later sign-ins Viewers", async () => {
    await withReadModelDatabase(async pool => {
      await pool.query(`DROP TABLE role_changes;
        ALTER TABLE "user" DROP CONSTRAINT user_role, DROP COLUMN role, DROP COLUMN last_signed_in_at, DROP COLUMN admin_group`);
      await pool.query(`INSERT INTO "user" (id, email) VALUES ('ana', 'ana@example.com'), ('sam', 'sam@example.com')`);

      await pool.query(readFileSync(new URL("../../drizzle/migrations/0007_roles.sql", import.meta.url), "utf8"));

      expect((await pool.query(`SELECT id, role FROM "user" ORDER BY id`)).rows).toEqual([
        { id: "ana", role: "editor" },
        { id: "sam", role: "editor" },
      ]);
      await pool.query(`INSERT INTO "user" (id, email) VALUES ('new', 'new@example.com')`);
      expect((await pool.query(`SELECT role FROM "user" WHERE id = 'new'`)).rows).toEqual([{ role: "viewer" }]);
      await expect(pool.query(`UPDATE "user" SET role = 'owner' WHERE id = 'new'`)).rejects.toThrow(/user_role/);
    });
  });
});
