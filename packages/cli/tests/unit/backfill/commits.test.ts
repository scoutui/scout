import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChainCommit, defaultSince, formatDay, parseSince, weeklyCommits } from "../../../src/backfill/commits.js";

beforeEach(() => {
  vi.stubEnv("TZ", "Pacific/Kiritimati");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function chain(...dates: string[]): ChainCommit[] {
  return dates.map((committedAt, i) => ({ commit: `c${i}`, committedAt }));
}

describe("weeklyCommits", () => {
  it.each<[string, string, string[], string[]]>([
    ["keeps the tip of a chain of one", "2026-01-01", ["2026-06-24T08:00:00Z"], ["c0"]],
    ["keeps the tip although it is dated before the since date", "2026-06-01", ["2026-05-20T08:00:00Z"], ["c0"]],
    [
      "drops the other commits in the tip's week",
      "2026-01-01",
      ["2026-06-24T08:00:00Z", "2026-06-23T08:00:00Z", "2026-06-22T08:00:00Z", "2026-06-19T08:00:00Z"],
      ["c0", "c3"],
    ],
    [
      "keeps the newest commit of a week in chain order, though an older one in the chain has a later date",
      "2026-01-01",
      ["2026-06-24T08:00:00Z", "2026-06-16T08:00:00Z", "2026-06-18T08:00:00Z"],
      ["c0", "c1"],
    ],
    [
      "drops a commit dated before the since date and still picks older commits in the chain dated after it",
      "2026-06-01",
      ["2026-06-24T08:00:00Z", "2026-06-17T08:00:00Z", "2026-05-20T08:00:00Z", "2026-06-10T08:00:00Z"],
      ["c0", "c1", "c3"],
    ],
    [
      "drops a commit dated in a week after the tip's",
      "2026-01-01",
      ["2026-06-24T08:00:00Z", "2026-07-01T08:00:00Z", "2026-06-17T08:00:00Z"],
      ["c0", "c2"],
    ],
    [
      "puts Sunday 21 Jun 23:30 UTC in the week of Monday 15 Jun, as weeks run in UTC",
      "2026-01-01",
      ["2026-06-30T08:00:00Z", "2026-06-23T08:00:00Z", "2026-06-21T23:30:00Z", "2026-06-16T08:00:00Z"],
      ["c0", "c1", "c2"],
    ],
    [
      "puts Thu 31 Dec 2026 and Fri 1 Jan 2027 in one week, from Monday 28 Dec 2026",
      "2026-01-01",
      ["2027-01-13T08:00:00Z", "2027-01-01T08:00:00Z", "2026-12-31T08:00:00Z", "2026-12-27T08:00:00Z"],
      ["c0", "c1", "c3"],
    ],
    [
      "keeps a commit at 00:00 UTC on the since date and drops one a second earlier",
      "2026-06-01",
      ["2026-06-24T08:00:00Z", "2026-06-01T00:00:00Z", "2026-05-31T23:59:59Z"],
      ["c0", "c1"],
    ],
  ])("%s", (_, since, dates, expected) => {
    expect(weeklyCommits(chain(...dates), since).map((c) => c.commit)).toEqual(expected);
  });
});

describe("defaultSince", () => {
  it.each<[string, string, string]>([
    ["goes back six calendar months", "2026-10-02T08:00:00Z", "2026-04-02"],
    ["stops at the last day of a shorter month", "2026-08-31T08:00:00Z", "2026-02-28"],
    ["stops at 29 Feb in a leap year", "2028-08-31T08:00:00Z", "2028-02-29"],
    ["counts from today's UTC date", "2026-03-14T22:30:00Z", "2025-09-14"],
  ])("%s", (_, today, expected) => {
    expect(defaultSince(new Date(today))).toBe(expected);
  });
});

describe("formatDay", () => {
  it.each<[string, string, string]>([
    ["writes September as Sep", "2026-09-28T08:00:00Z", "28 Sep 2026"],
    ["writes the UTC day, unpadded", "2026-04-06T23:30:00Z", "6 Apr 2026"],
  ])("%s", (_, iso, expected) => {
    expect(formatDay(iso)).toBe(expected);
  });
});

describe("parseSince", () => {
  it("accepts a date written YYYY-MM-DD", () => {
    expect(parseSince("2026-04-02")).toBe("2026-04-02");
  });

  it.each<[string, string]>([
    ["a month and day without leading zeros", "2026-4-2"],
    ["a day the month doesn't have", "2026-02-30"],
    ["a month the year doesn't have", "2026-13-01"],
    ["a date written DD/MM/YYYY", "02/04/2026"],
    ["an empty value", ""],
  ])("rejects %s", (_, value) => {
    expect(parseSince(value)).toBeNull();
  });
});
