import { setImmediate as nextTurn } from "node:timers/promises";
import { Client, Pool } from "pg";
import { expect, it, vi } from "vitest";
import { withReadModelDatabase } from "./read-model-db.ts";

const { DATABASE_URL: connectionString } = process.env;

it.skipIf(!connectionString)("waits for connection shutdown before dropping the test database", async () => {
  let startShutdown = () => {};
  const shutdownStarted = new Promise<void>(resolve => { startShutdown = resolve; });
  let finishShutdown: (() => Promise<void>) | undefined;
  let clientClosed = false;
  let droppedBeforeClose = false;
  let database: string | undefined;
  const originalQuery = Pool.prototype.query;
  const query = vi.spyOn(Pool.prototype, "query").mockImplementation(function (this: Pool, ...args: unknown[]) {
    if (typeof args[0] === "string" && args[0].startsWith("DROP DATABASE") && !clientClosed) {
      droppedBeforeClose = true;
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return Reflect.apply(originalQuery, this, args);
  });
  const operation = withReadModelDatabase(async pool => {
    const client = await pool.connect();
    if (!(client instanceof Client)) throw new Error("Expected a pg client with a shutdown method");
    database = (await client.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    client.once("end", () => { clientClosed = true; });
    const originalEnd = client.end.bind(client);
    vi.spyOn(client, "end").mockImplementation(callback => {
      finishShutdown = () => new Promise<void>(resolve => {
        originalEnd(error => { callback(error); resolve(); });
      });
      startShutdown();
    });
    client.release();
  });
  try {
    await Promise.race([shutdownStarted, operation]);
    await nextTurn();
    if (!finishShutdown) throw new Error("Connection shutdown was not requested");
    const finish = finishShutdown;
    finishShutdown = undefined;
    await finish();
    await operation;
    expect(droppedBeforeClose).toBe(false);
    expect(clientClosed).toBe(true);
  } finally {
    await finishShutdown?.();
    await operation.catch(() => {});
    query.mockRestore();
    if (database) {
      const admin = new Pool({ connectionString });
      try { await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); }
      finally { await admin.end(); }
    }
  }
});
