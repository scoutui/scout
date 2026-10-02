import { describe, expect, it } from "vitest";
import { durationLabel, relativeTime } from "@/lib/relative-time";

const NOW = new Date("2026-05-16T12:00:00Z");

function ago(deltaSeconds: number): string {
  return new Date(NOW.getTime() - deltaSeconds * 1000).toISOString();
}

describe("relativeTime", () => {
  it("returns 'just now' for very recent timestamps", () => {
    expect(relativeTime(ago(5), NOW)).toBe("just now");
    expect(relativeTime(ago(44), NOW)).toBe("just now");
  });

  it("renders minute-grain for sub-hour deltas", () => {
    expect(relativeTime(ago(60), NOW)).toBe("1m ago");
    expect(relativeTime(ago(15 * 60), NOW)).toBe("15m ago");
    expect(relativeTime(ago(59 * 60), NOW)).toBe("59m ago");
  });

  it("never returns '60m ago' just shy of an hour", () => {
    // Minutes round down, so 3590s..3599s stay under the hour.
    expect(relativeTime(ago(3590), NOW)).toBe("59m ago");
    expect(relativeTime(ago(3599), NOW)).toBe("59m ago");
  });

  it("renders hour-grain for sub-day deltas", () => {
    expect(relativeTime(ago(3600), NOW)).toBe("1h ago");
    expect(relativeTime(ago(2 * 3600), NOW)).toBe("2h ago");
    expect(relativeTime(ago(23 * 3600), NOW)).toBe("23h ago");
  });

  it("never crosses an hour/day/month/year boundary by one second", () => {
    expect(relativeTime(ago(86399), NOW)).toBe("23h ago");
    expect(relativeTime(ago(30 * 86400 - 1), NOW)).toBe("29d ago");
    expect(relativeTime(ago(365 * 86400 - 1), NOW)).toBe("12mo ago");
  });

  it("renders day-grain for sub-month deltas", () => {
    expect(relativeTime(ago(86400), NOW)).toBe("1d ago");
    expect(relativeTime(ago(7 * 86400), NOW)).toBe("7d ago");
    expect(relativeTime(ago(29 * 86400), NOW)).toBe("29d ago");
  });

  it("renders month-grain for sub-year deltas", () => {
    expect(relativeTime(ago(30 * 86400), NOW)).toBe("1mo ago");
    expect(relativeTime(ago(6 * 30 * 86400), NOW)).toBe("6mo ago");
  });

  it("renders year-grain beyond a year", () => {
    expect(relativeTime(ago(366 * 86400), NOW)).toBe("1y ago");
    expect(relativeTime(ago(3 * 365 * 86400), NOW)).toBe("3y ago");
  });

  it("clamps future timestamps to 'just now'", () => {
    expect(relativeTime(new Date(NOW.getTime() + 10_000).toISOString(), NOW)).toBe("just now");
  });
});

describe("durationLabel", () => {
  it("is the bare unit, with the same floors and thresholds relativeTime suffixes", () => {
    expect(durationLabel(0)).toBe("just now");
    expect(durationLabel(44)).toBe("just now");
    expect(durationLabel(60)).toBe("1m");
    expect(durationLabel(3599)).toBe("59m");
    expect(durationLabel(3600)).toBe("1h");
    expect(durationLabel(86399)).toBe("23h");
    expect(durationLabel(3 * 86400)).toBe("3d");
    expect(durationLabel(30 * 86400 - 1)).toBe("29d");
    expect(durationLabel(30 * 86400)).toBe("1mo");
    expect(durationLabel(365 * 86400 - 1)).toBe("12mo");
    expect(durationLabel(366 * 86400)).toBe("1y");
  });
});
