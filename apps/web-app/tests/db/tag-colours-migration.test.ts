import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withReadModelDatabase } from "../helpers/read-model-db";

const { DATABASE_URL: databaseUrl } = process.env;
describe.skipIf(!databaseUrl)("tag colours migration", { timeout: 30_000 }, () => {
  it("names each palette colour, and gives grey and custom colours the colour fewest tags use", async () => {
    await withReadModelDatabase(async pool => {
      await pool.query("ALTER TABLE tags DROP CONSTRAINT tags_color");
      await pool.query(`INSERT INTO tags (id, value, color, rule, created_at) VALUES
        ('a', 'a', '#009598', '{"glob":[],"exact":[]}', '2026-01-01'),
        ('b', 'b', '#9B6BCE', '{"glob":[],"exact":[]}', '2026-01-02'),
        ('c', 'c', '#7d8088', '{"glob":[],"exact":[]}', '2026-01-03'),
        ('d', 'd', '#2863ab', '{"glob":[],"exact":[]}', '2026-01-04'),
        ('e', 'e', '#123456', '{"glob":[],"exact":[]}', '2026-01-05'),
        ('f', 'f', '#7d8088', '{"glob":[],"exact":[]}', '2026-01-06'),
        ('g', 'g', 'red', '{"glob":[],"exact":[]}', '2026-01-07')`);

      await pool.query(readFileSync(new URL("../../drizzle/migrations/0008_tag_colour_names.sql", import.meta.url), "utf8"));

      expect((await pool.query("SELECT id, color FROM tags ORDER BY id")).rows).toEqual([
        { id: "a", color: "teal" },
        { id: "b", color: "violet" },
        { id: "c", color: "berry" },
        { id: "d", color: "blue" },
        { id: "e", color: "orchid" },
        { id: "f", color: "teal" },
        { id: "g", color: "violet" },
      ]);
      await expect(pool.query(`UPDATE tags SET color = 'grey' WHERE id = 'a'`)).rejects.toThrow(/tags_color/);
    });
  });
});
