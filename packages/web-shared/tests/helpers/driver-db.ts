import { afterAll, beforeAll } from "vitest";
import type { Pool } from "pg";
import { PostgresDriver } from "../../src/drivers/postgres.js";
import { openReadModelDatabase } from "../../../../apps/web-app/tests/helpers/read-model-db.ts";

export type DriverDatabase = { pool: Pool; driver: PostgresDriver; queuedResults: () => Promise<number> };

/** Opens one migrated throwaway database for the enclosing describe and drops it after the suite. */
export function useDriverDatabase(): DriverDatabase {
  let database: ReturnType<typeof openReadModelDatabase> | undefined;
  const context = {
    queuedResults: async () =>
      (await context.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM scan_jobs WHERE kind = 'results' AND state = 'queued'")).rows[0]?.n ?? 0,
  } as DriverDatabase;
  beforeAll(async () => {
    database = openReadModelDatabase();
    context.pool = await database.pool;
    context.driver = new PostgresDriver(context.pool);
  });
  afterAll(async () => { await database?.close(); });
  return context;
}
