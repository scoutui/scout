import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const GLOBAL_KEY = "__cc_web_db_pool" as const;
type GlobalWithPool = typeof globalThis & { [GLOBAL_KEY]?: Pool };
const g = globalThis as GlobalWithPool;

const DEFAULT_POOL_MAX = 10;

function poolMax(): number {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const raw = process.env["DATABASE_POOL_MAX"];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POOL_MAX;
}

/**
 * The one pool this process opens. Connections per deployment are
 * replicas × DATABASE_POOL_MAX, so the operator sizes it against the
 * database's connection limit.
 */
export function getPool(): Pool {
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation
  const url = process.env["DATABASE_URL"];
  if (!url) {
    // During `next build` page-data collection, the auth config transitively
    // constructs a pool. Returning a dummy pool with a placeholder URL lets
    // the build complete; the build process never issues a real query, and
    // `next start` creates a fresh pool from the runtime env.
    // biome-ignore lint/complexity/useLiteralKeys: env access
    if (process.env["NEXT_PHASE"] === "phase-production-build") {
      const dummy = new Pool({ connectionString: "postgres://build:build@localhost:5432/build", max: 1 });
      g[GLOBAL_KEY] = dummy;
      return dummy;
    }
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({ connectionString: url, max: poolMax() });
  g[GLOBAL_KEY] = pool;
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export { schema };
