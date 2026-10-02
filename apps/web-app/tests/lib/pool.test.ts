import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const constructed: Array<{ max?: number }> = [];
vi.mock("pg", () => ({
  Pool: class {
    constructor(opts: Record<string, unknown>) {
      constructed.push(opts);
    }
    on() {}
    query() {
      return Promise.resolve({ rows: [] });
    }
    connect() {
      return Promise.reject(new Error("not in this test"));
    }
    end() {
      return Promise.resolve();
    }
  },
}));

async function loadBoth() {
  vi.resetModules();
  const client = await import("@/db/client");
  const storage = await import("@/lib/storage");
  return { client, storage };
}

describe("one pool per process", () => {
  beforeEach(() => {
    constructed.length = 0;
    Reflect.deleteProperty(globalThis, "__cc_web_db_pool");
    Reflect.deleteProperty(globalThis, "__cc_web_storage");
    vi.stubEnv("DATABASE_URL", "postgres://t:t@localhost:1/t");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getDb and getStorage share a single Pool", async () => {
    const { client, storage } = await loadBoth();
    client.getDb();
    storage.getStorage();
    client.getDb();
    storage.getStorage();
    expect(constructed).toHaveLength(1);
  });

  it("defaults the pool size to 10", async () => {
    vi.stubEnv("DATABASE_POOL_MAX", undefined);
    const { client } = await loadBoth();
    client.getPool();
    expect(constructed[0]?.max).toBe(10);
  });

  it("sizes the pool from DATABASE_POOL_MAX", async () => {
    vi.stubEnv("DATABASE_POOL_MAX", "5");
    const { client } = await loadBoth();
    client.getPool();
    expect(constructed[0]?.max).toBe(5);
  });

  it("ignores a non-positive or non-numeric DATABASE_POOL_MAX", async () => {
    vi.stubEnv("DATABASE_POOL_MAX", "0");
    const { client } = await loadBoth();
    client.getPool();
    expect(constructed[0]?.max).toBe(10);
  });
});
