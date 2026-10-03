import { gitFailed } from "../scan/meta.js";
import { runGit, shortCommit, STATUS_MAX_BUFFER } from "../util/git.js";

/** A commit on the tracked branch, with its committer date as an ISO 8601 UTC timestamp. */
export type ChainCommit = { commit: string; committedAt: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The commits on `ref`'s first-parent chain, newest first. */
export async function firstParentChain(cwd: string, ref: string): Promise<ChainCommit[]> {
  const log = await runGit(cwd, ["log", "--first-parent", "--no-show-signature", "--format=%H %cI", ref], {
    maxBuffer: STATUS_MAX_BUFFER,
  });
  if (!log.ok) throw gitFailed(cwd, log.detail);
  return log.stdout.split("\n").map((line) => {
    const [commit = "", committedAt = ""] = line.split(" ");
    return { commit, committedAt: new Date(Date.parse(committedAt)).toISOString() };
  });
}

/** The time of 00:00 UTC on the Monday that starts the week of `iso`. */
function weekStart(iso: string): number {
  const date = new Date(iso);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
}

/**
 * The tip of `chain`, then the newest commit in chain order of each earlier week, Monday to Sunday in UTC,
 * dated on or after `since`.
 */
export function weeklyCommits(chain: readonly ChainCommit[], since: string): ChainCommit[] {
  const [tip, ...rest] = chain;
  if (tip === undefined) return [];
  const sinceTime = Date.parse(`${since}T00:00:00Z`);
  const tipWeek = weekStart(tip.committedAt);
  const weeks = new Set<number>();
  const picked = [tip];
  for (const entry of rest) {
    const week = weekStart(entry.committedAt);
    if (Date.parse(entry.committedAt) < sinceTime || week >= tipWeek || weeks.has(week)) continue;
    weeks.add(week);
    picked.push(entry);
  }
  return picked;
}

/** `value` when it is a real calendar date written `YYYY-MM-DD`, otherwise null. */
export function parseSince(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

/** Six calendar months before `today`'s UTC date, as `YYYY-MM-DD`, on the month's last day when it is shorter. */
export function defaultSince(today: Date): string {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() - 6;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(today.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

/** The UTC day of `iso`, written like `6 Apr 2026`. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The commit as the run's lines name it: its first seven characters and its UTC day, like `a1c9e04 (28 Sep 2026)`. */
export function commitLabel({ commit, committedAt }: ChainCommit): string {
  return `${shortCommit(commit)} (${formatDay(committedAt)})`;
}
