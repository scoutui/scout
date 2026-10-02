import path from "node:path";
import { Client, type Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { trustedProxyHops } from "./rate-limit.ts";
import { readScanUploadConfig } from "./scan-upload-config.ts";

/**
 * One fixed key for the migration lock. Every replica takes the same
 * session-level advisory lock before migrating, so pods that start together
 * run the migrator one at a time and the later ones find nothing pending.
 */
export const MIGRATION_LOCK_KEY = 20260916;

type Env = Record<string, string | undefined>;

/** On unless MIGRATE_ON_START is the string "false". */
export function migrateOnStartEnabled(env: Env): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  return env["MIGRATE_ON_START"]?.toLowerCase() !== "false";
}

/**
 * The standalone server changes directory into the app folder before it
 * starts, so the relative default resolves to the copied migrations in the
 * image as well as in a source checkout.
 */
export function resolveMigrationsDir(env: Env): string {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  return env["SCOUTUI_MIGRATIONS_DIR"] ?? path.resolve(process.cwd(), "drizzle/migrations");
}

export async function schemaIsReady(client: Pool | PoolClient, migrationsDir: string): Promise<boolean> {
  const migrations = readMigrationFiles({ migrationsFolder: migrationsDir });
  const { rows: probe } = await client.query<{ present: string | null }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') AS present",
  );
  if (!probe[0]?.present) return false;
  const { rows } = await client.query<{ hash: string; created_at: string }>(
    "SELECT hash, created_at FROM drizzle.__drizzle_migrations",
  );
  return migrations.length > 0 && migrations.every((migration) =>
    rows.some((row) => Number(row.created_at) === migration.folderMillis && row.hash === migration.hash),
  );
}

async function appliedCount(client: Client): Promise<number> {
  // Postgres resolves relation names at parse time, so the existence check
  // has to be its own statement rather than a WHERE clause on the count.
  const { rows: probe } = await client.query<{ present: string | null }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') AS present",
  );
  if (!probe[0]?.present) return 0;
  const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
  return rows[0]?.n ?? 0;
}

/**
 * Apply pending migrations under an advisory lock.
 *
 * The lock and the migrator share one dedicated connection: a lock taken on a
 * pooled connection would not cover a migration run on another. Session-level,
 * so it outlives the migrator's own transactions and is released by Postgres
 * if the process dies mid-way.
 */
export async function migrateOnStart(opts: { databaseUrl: string; migrationsDir: string }): Promise<{ applied: number }> {
  const client = new Client({ connectionString: opts.databaseUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      const before = await appliedCount(client);
      await migrate(drizzle(client), { migrationsFolder: opts.migrationsDir });
      const after = await appliedCount(client);
      return { applied: after - before };
    } finally {
      // A dropped connection fails this too; the session ending releases the
      // lock either way, so the migration error is the one worth keeping.
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  } finally {
    await client.end();
  }
}

/** Everything the server must finish before it answers a request. Throws on failure. */
export async function runStartup(env: Env): Promise<void> {
  readScanUploadConfig(env);
  trustedProxyHops(env);
  if (!migrateOnStartEnabled(env)) {
    console.log("[startup] migrations: off (MIGRATE_ON_START=false)");
    return;
  }
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("[startup] DATABASE_URL is required when MIGRATE_ON_START is on");
  }
  const migrationsDir = resolveMigrationsDir(env);
  console.log(`[startup] migrations: applying pending from ${migrationsDir}`);
  const started = Date.now();
  const { applied } = await migrateOnStart({ databaseUrl, migrationsDir });
  console.log(`[startup] migrations: ${applied} applied in ${Date.now() - started}ms`);
}
