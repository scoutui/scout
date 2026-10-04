import { describe, it, expect } from "vitest";
import {
  barRowLabel,
  deltaDirection,
  formatChange,
  formatDayTick,
  formatPct,
  formatMetric,
  formatReposAdded,
  formatScanStamp,
} from "@/lib/dashboard-format";

describe("barRowLabel", () => {
  it("names a scoped package by its last segment, with its scope as the muted line", () => {
    expect(barRowLabel("@example-design-system/button-group")).toEqual({
      name: "button-group",
      attribution: "@example-design-system",
    });
  });

  it("names a component, with its package as the muted line", () => {
    expect(barRowLabel("Button · @example/ui")).toEqual({ name: "Button", attribution: "@example/ui" });
  });
});

describe("formatPct", () => {
  it("formats fractions as one-decimal percentages", () => {
    expect(formatPct(0.5)).toBe("50%");
    expect(formatPct(0.123)).toBe("12.3%");
  });
  it("reads 0% for zero", () => {
    expect(formatPct(0)).toBe("0%");
  });
  it("never reads 0% for a tiny non-zero share", () => {
    expect(formatPct(0.0004)).toBe("<0.1%");
  });
  it("drops a redundant trailing .0", () => {
    expect(formatPct(1)).toBe("100%");
    expect(formatPct(0.5)).toBe("50%");
  });
  it("keeps a meaningful decimal", () => {
    expect(formatPct(0.465)).toBe("46.5%");
  });
});

describe("formatMetric", () => {
  it("uses thousands separators for counts", () => {
    expect(formatMetric(1234, "count")).toBe("1,234");
  });
  it("uses percentages for share", () => {
    expect(formatMetric(0.25, "share")).toBe("25%");
  });
});

describe("formatChange", () => {
  it.each([
    [-6, "6 fewer"],
    [2, "2 more"],
    [1234, "1,234 more"],
    [0, "no change"],
    [null, "—"],
  ] as const)("reads %s as %s", (delta, text) => {
    expect(formatChange(delta)).toBe(text);
  });
});

describe("formatReposAdded", () => {
  it.each([
    [1, "1 repo added"],
    [3, "3 repos added"],
    [0, null],
  ] as const)("reads %s as %s", (count, text) => {
    expect(formatReposAdded(count)).toBe(text);
  });
});

describe("deltaDirection", () => {
  it.each([
    [-37, "forward"],
    [37, "backward"],
    [1, "backward"],
    [0, "none"],
    [null, "none"],
  ] as const)("reads a change of %s in what is left as %s", (delta, direction) => {
    expect(deltaDirection(delta)).toBe(direction);
  });
});

describe("time-axis labels", () => {
  it("formatDayTick renders the day grammar from epoch ms", () => {
    expect(formatDayTick(Date.parse("2026-07-13T09:00:00.000Z"))).toBe("13 Jul");
  });

  it("formatScanStamp renders a deterministic UTC stamp", () => {
    expect(formatScanStamp(Date.parse("2026-07-13T09:05:00.000Z"))).toBe("2026-07-13 · 09:05");
  });
});
