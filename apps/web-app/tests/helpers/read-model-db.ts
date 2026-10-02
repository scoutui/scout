import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** The migrated database that template-db.ts creates for the run. */
    readModelTemplate: string;
  }
}

/** Runs fn against a private database cloned from the run's migrated template, and drops it after. */
export async function withReadModelDatabase<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const { DATABASE_URL: connectionString } = process.env;
  if (!connectionString) throw new Error("DATABASE_URL is required for database tests");
  const template = inject("readModelTemplate");
  if (!template) throw new Error("Add apps/web-app/tests/helpers/template-db.ts to this package's vitest globalSetup");
  const name = `cc_read_models_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  const connectionsEnded: Promise<void>[] = [];
  let pool: Pool | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    created = true;
    const url = new URL(connectionString);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on("connect", client => {
      connectionsEnded.push(new Promise<void>(resolve => client.once("end", resolve)));
    });
    return await fn(pool);
  } finally {
    await pool?.end();
    await Promise.all(connectionsEnded);
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

/** Keeps one private database open across a suite; call close() in afterAll. */
export function openReadModelDatabase(): { pool: Promise<Pool>; close: () => Promise<void> } {
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  let opened: (pool: Pool) => void = () => {};
  const pool = new Promise<Pool>(resolve => { opened = resolve; });
  const done = withReadModelDatabase(async database => {
    opened(database);
    await released;
  });
  return {
    pool: Promise.race([pool, done.then(() => { throw new Error("Database closed before opening"); })]),
    close: async () => { release(); await done; },
  };
}
