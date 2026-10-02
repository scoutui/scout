import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

async function run(connectionString: string, sql: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try { await client.query(sql); } finally { await client.end(); }
}

/**
 * Vitest global setup: migrates one template database for the run, which
 * read-model-db.ts clones for each test database, and drops it afterwards.
 * Postgres refuses to clone a template while anything is connected to it, so
 * the migration connection is closed before tests start.
 */
export async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const { DATABASE_URL: connectionString } = process.env;
  if (!connectionString) return undefined;
  const name = `cc_read_model_template_${randomUUID().replaceAll("-", "")}`;
  const drop = () => run(connectionString, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await run(connectionString, `CREATE DATABASE "${name}"`);
  try {
    const url = new URL(connectionString);
    url.pathname = `/${name}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await migrate(drizzle(client), {
        migrationsFolder: fileURLToPath(new URL("../../drizzle/migrations", import.meta.url)),
      });
    } finally { await client.end(); }
  } catch (error) {
    await drop();
    throw error;
  }
  project.provide("readModelTemplate", name);
  return drop;
}
