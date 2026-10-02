import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { migrateOnStart, resolveMigrationsDir } from "@/lib/startup";

// biome-ignore lint/complexity/useLiteralKeys: env access
const SERVER_URL = process.env["DATABASE_URL"];
const RUN_DB = SERVER_URL != null;

/**
 * These tests own an empty database on the same server, created here and
 * dropped at the end, rather than a clone of the migrated template: migrating
 * it is what they test.
 */
describe.skipIf(!RUN_DB)("migrateOnStart", () => {
  const dbName = `cc_startup_${randomBytes(4).toString("hex")}`;
  let databaseUrl: string;
  let admin: Client;
  const migrationsDir = resolveMigrationsDir({});
  const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number }[];
  };
  const expected = journal.entries.length;

  const applied = async (): Promise<number> => {
    const c = new Client({ connectionString: databaseUrl });
    await c.connect();
    try {
      const { rows } = await c.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
      return rows[0]?.n ?? 0;
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: SERVER_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const u = new URL(SERVER_URL as string);
    u.pathname = `/${dbName}`;
    databaseUrl = u.toString();
  });

  afterAll(async () => {
    await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.end();
  });

  it("applies every journal entry to a fresh database", async () => {
    const result = await migrateOnStart({ databaseUrl, migrationsDir });
    expect(result.applied).toBe(expected);
    expect(await applied()).toBe(expected);
  });

  it("is a no-op the second time", async () => {
    const result = await migrateOnStart({ databaseUrl, migrationsDir });
    expect(result.applied).toBe(0);
    expect(await applied()).toBe(expected);
  });

  it("serialises concurrent starters on the lock", async () => {
    await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const results = await Promise.all([
      migrateOnStart({ databaseUrl, migrationsDir }),
      migrateOnStart({ databaseUrl, migrationsDir }),
    ]);
    expect(results.map((r) => r.applied).sort()).toEqual([0, expected]);
    expect(await applied()).toBe(expected);
  });
});
