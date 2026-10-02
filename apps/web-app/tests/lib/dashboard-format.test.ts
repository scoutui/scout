import { describe, it, expect } from "vitest";
import {
  barRowLabel,
  deltaDirection,
  formatDeltaFrom,
  formatDayTick,
  formatPct,
  formatMetric,
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

describe("formatDeltaFrom", () => {
  it("phrases a migration Δ as the previous share level", () => {
    // current 49% with a +14.2pp move ⇒ it was 34.8% last scan.
    expect(formatDeltaFrom("migration", 0.49, 14.2)).toBe("up from 34.8% last scan");
    expect(formatDeltaFrom("migration", 0.45, -15)).toBe("down from 60% last scan");
  });

  it("phrases a retirement Δ as the previous remaining count", () => {
    expect(formatDeltaFrom("retirement", 821, 121)).toBe("up from 700 last scan");
    expect(formatDeltaFrom("retirement", 700, -1400)).toBe("down from 2,100 last scan");
  });

  it("keeps the unitless ±0 inside deltaDirection's band", () => {
    expect(formatDeltaFrom("migration", 0.49, 0.04)).toBe("±0 since last scan");
    expect(formatDeltaFrom("retirement", 821, 0)).toBe("±0 since last scan");
  });

  it("reads an em dash when either endpoint is unknowable", () => {
    expect(formatDeltaFrom("migration", 0.49, null)).toBe("—");
    expect(formatDeltaFrom("migration", null, 14.2)).toBe("—");
  });
});

describe("deltaDirection", () => {
  // The sign inverts by row kind.
  it("reads a falling migration as backward and a rising one as forward", () => {
    expect(deltaDirection("migration", -15)).toBe("backward");
    expect(deltaDirection("migration", 15)).toBe("forward");
  });

  it("reads a rising retirement as backward: up is bad when work should be going away", () => {
    expect(deltaDirection("retirement", 37)).toBe("backward");
    expect(deltaDirection("retirement", -37)).toBe("forward");
  });

  it("flags a single new occurrence of a retired component", () => {
    expect(deltaDirection("retirement", 1)).toBe("backward");
  });

  it("never contradicts a rendered ±0, in either direction", () => {
    // formatDeltaFrom renders "±0" exactly on this band, so no colour may fire inside it.
    expect(deltaDirection("migration", -0.04)).toBe("none");
    expect(deltaDirection("migration", 0.04)).toBe("none");
    expect(deltaDirection("migration", -0.05)).toBe("backward");
    expect(deltaDirection("migration", 0.05)).toBe("forward");
    expect(deltaDirection("retirement", 0)).toBe("none");
  });

  it("is neutral when there is no previous scan to compare against", () => {
    expect(deltaDirection("migration", null)).toBe("none");
    expect(deltaDirection("retirement", null)).toBe("none");
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
