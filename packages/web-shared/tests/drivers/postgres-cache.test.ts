import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresDriver } from "../../src/drivers/postgres.js";

function connection() {
  const query = vi.fn(async (_sql: string) => ({ rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] }));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const pool = { connect } as unknown as Pool;
  return { driver: new PostgresDriver(pool), query, release, connect };
}

describe("PostgresDriver snapshot lifetime", () => {
  it("reuses one connection and transaction for nested reads", async () => {
    const { driver, query, connect, release } = connection();
    const result = await driver.withReadSnapshot(async snapshot => {
      expect(await snapshot.listTags()).toEqual([]);
      return snapshot.withReadSnapshot(nested => nested.listGovernance());
    });
    expect(result).toEqual([]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(query.mock.calls.filter(call => call[0] === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases after callback failure", async () => {
    const { driver, query, release } = connection();
    const error = new Error("failed page read");
    await expect(driver.withReadSnapshot(async () => { throw error; })).rejects.toBe(error);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("opens a fresh transaction for a later read", async () => {
    const { driver, connect, release } = connection();
    await driver.withReadSnapshot(snapshot => snapshot.listTags());
    await driver.withReadSnapshot(snapshot => snapshot.listTags());
    expect(connect).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
