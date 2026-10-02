/**
 * In-memory sliding-window rate limiter. Each replica keeps its own window, so
 * the effective ceiling is replicas × `limit`.
 */

/** Bounded so an attacker rotating source addresses can't grow this map without
 * limit. Entries are re-inserted on use, so Map iteration order approximates LRU
 * and eviction takes the least recently used key. */
const MAX_TRACKED_KEYS = 10_000;

const hits = new Map<string, number[]>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Record a hit against `key` and report whether it is within `limit` per
 * `windowMs`. Timestamps outside the window are dropped on read, so a caller
 * that goes quiet stops consuming budget without needing a sweep.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  // Re-insert to move the key to the back of the iteration order (LRU).
  hits.delete(key);

  if (recent.length >= limit) {
    hits.set(key, recent);
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }

  recent.push(now);
  hits.set(key, recent);

  while (hits.size > MAX_TRACKED_KEYS) {
    const lru = hits.keys().next();
    if (lru.done) break;
    hits.delete(lru.value);
  }

  return { ok: true };
}

/**
 * How many proxies in front of the dashboard append to `x-forwarded-for`:
 * `SCOUTUI_TRUSTED_PROXY_HOPS`, default 1 (one ingress). Throws on anything but
 * a positive whole number, so startup can refuse a typo.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const raw = env["SCOUTUI_TRUSTED_PROXY_HOPS"]?.trim();
  if (!raw) return 1;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`SCOUTUI_TRUSTED_PROXY_HOPS is "${raw}". Set it to the number of proxies in front of the dashboard, for example 1.`);
  }
  return Number(raw);
}

/**
 * Client address for rate-limit keying.
 *
 * Each trusted proxy appends the peer it saw to `x-forwarded-for`, so with N
 * trusted hops the client is the Nth entry from the right. Entries left of that
 * are whatever the client sent and are spoofable: keying on them would let an
 * attacker mint a fresh bucket per request. With fewer entries than hops, the
 * leftmost is used.
 */
export function clientKey(req: Request, env: Record<string, string | undefined> = process.env): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const client = parts[Math.max(0, parts.length - trustedProxyHops(env))];
    if (client) return client;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Test-only: drop all recorded state so cases cannot leak into each other. */
export function resetRateLimitState(): void {
  hits.clear();
}

/**
 * One line per rejection, so an operator seeing unexplained 429s can read
 * which key the limiter derived. Behind a proxy that collapses client
 * addresses, that key is what shows every caller sharing one bucket.
 */
export function logRateLimitRejection(route: string, key: string): void {
  console.warn(`[rate-limit] rejected route=${route} key=${key}`);
}
