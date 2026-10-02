// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  RAIL_COLLAPSE_KEY,
  readRailCollapsed,
  writeRailCollapsed,
} from "@/components/component-detail/composition/rail-collapse";

describe("rail collapse persistence", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to open", () => {
    expect(readRailCollapsed()).toBe(false);
  });

  it("round-trips a collapse", () => {
    writeRailCollapsed(true);
    expect(window.localStorage.getItem(RAIL_COLLAPSE_KEY)).toBe("1");
    expect(readRailCollapsed()).toBe(true);
  });

  it("round-trips back to open", () => {
    writeRailCollapsed(true);
    writeRailCollapsed(false);
    expect(readRailCollapsed()).toBe(false);
  });

  it("treats an unrecognised stored value as open", () => {
    window.localStorage.setItem(RAIL_COLLAPSE_KEY, "yes-please");
    expect(readRailCollapsed()).toBe(false);
  });
});
