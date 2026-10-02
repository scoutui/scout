import { PostgresDriver, type StorageDriver } from "@scoutui/web-shared";
import { getPool } from "@/db/client";

// Stash on globalThis so the singleton (and its caches) survives Next.js
// dev-mode HMR module re-evaluation. In `next start` this is functionally
// identical to a module-level binding.
const GLOBAL_STORAGE_KEY = "__cc_web_storage" as const;
type GlobalWithStorage = typeof globalThis & { [GLOBAL_STORAGE_KEY]?: StorageDriver };
const g = globalThis as GlobalWithStorage;

export function getStorage(): StorageDriver {
  const existing = g[GLOBAL_STORAGE_KEY];
  if (existing) return existing;
  const fresh = new PostgresDriver(getPool());
  g[GLOBAL_STORAGE_KEY] = fresh;
  return fresh;
}
