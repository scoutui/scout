import { describe, it, expect } from "vitest";
import { rangeStart } from "../src/chart-range.js";

describe("rangeStart", () => {
  const line = (key: string, ts: string[]) => ({ cohortKey: key, label: key, color: "", points: ts.map((t, i) => ({ t, value: i + 1 })) });
  const series = [
    line("a", ["2025-01-15T00:00:00Z", "2026-03-10T00:00:00Z", "2026-07-01T00:00:00Z", "2026-09-30T12:00:00Z"]),
    line("b", ["2026-08-20T00:00:00Z", "2026-09-30T12:00:00Z"]),
  ];

  it.each([
    ["3m", "2026-06-30T12:00:00Z"],
    ["6m", "2026-03-30T12:00:00Z"],
    ["1y", "2025-09-30T12:00:00Z"],
  ] as const)("starts %s back from the chart's latest scan", (range, start) => {
    expect(rangeStart(series, range)).toBe(Date.parse(start));
  });

  it("starts nowhere for All", () => {
    expect(rangeStart(series, "all")).toBeNull();
  });

  it("starts nowhere when every scan is already inside the range", () => {
    expect(rangeStart([line("a", ["2026-07-15T00:00:00Z", "2026-09-30T00:00:00Z"])], "3m")).toBeNull();
    expect(rangeStart([line("a", ["2026-06-15T00:00:00Z", "2026-09-30T00:00:00Z"])], "3m")).not.toBeNull();
  });
});
