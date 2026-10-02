/**
 * Compact relative-time formatter. Renders the same way in every locale; pair it
 * with the absolute timestamp in a `title` attribute.
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * A duration in the compact units: `just now`, `Nm`, `Nh`, `Nd`, `Nmo`, `Ny`.
 * The one home of the unit logic: `relativeTime` suffixes it with `ago`, the
 * scan-diff line with `earlier`.
 */
export function durationLabel(seconds: number): string {
  // Floor, not round, so a value just short of a boundary stays in its unit:
  // 59m59s renders as "59m", not "60m".
  if (seconds < MINUTE) return "just now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`;
  if (seconds < MONTH) return `${Math.floor(seconds / DAY)}d`;
  if (seconds < YEAR) return `${Math.floor(seconds / MONTH)}mo`;
  return `${Math.floor(seconds / YEAR)}y`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const secondsAgo = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  const label = durationLabel(secondsAgo);
  return label === "just now" ? label : `${label} ago`;
}
