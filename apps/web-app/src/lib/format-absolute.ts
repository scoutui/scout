const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Deterministic absolute timestamp: identical on server and client, so it is
 * hydration-safe and never leaks the server's timezone or locale.
 */
export function formatAbsoluteUtc(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
