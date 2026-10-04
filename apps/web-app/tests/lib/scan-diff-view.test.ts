import { describe, expect, it } from "vitest";
import { deltaOf, deltaTone, ghostRow, movementParts, signedCount, sinceLastScan } from "@/lib/scan-diff-view";

describe("movementParts", () => {
  it("orders added · removed · changed and omits zero parts", () => {
    expect(movementParts({ added: 3, removed: 8, changed: 18 })).toEqual([
      { word: "added", n: 3 },
      { word: "removed", n: 8 },
      { word: "changed", n: 18 },
    ]);
    expect(movementParts({ added: 0, removed: 2, changed: 10 })).toEqual([
      { word: "removed", n: 2 },
      { word: "changed", n: 10 },
    ]);
    expect(movementParts({ added: 0, removed: 0, changed: 0 })).toEqual([]);
  });
});

describe("signedCount", () => {
  it("signs non-zero counts with a real minus and renders zero as a dash, never ±0", () => {
    expect(signedCount(3)).toBe("+3");
    expect(signedCount(-16)).toBe("−16");
    expect(signedCount(1234)).toBe("+1,234");
    expect(signedCount(0)).toBe("—");
  });
});

describe("sinceLastScan", () => {
  it("joins the signed non-zero parts and is null when nothing was added or removed", () => {
    expect(sinceLastScan({ added: 3, removed: 16, changed: 18, deprecated: 0 })).toBe("+3 −16");
    expect(sinceLastScan({ added: 0, removed: 2, changed: 0, deprecated: -1 })).toBe("−2");
    expect(sinceLastScan({ added: 1, removed: 0, changed: 0, deprecated: 0 })).toBe("+1");
    expect(sinceLastScan({ added: 0, removed: 0, changed: 5, deprecated: -2 })).toBeNull();
  });
});

describe("deltaOf", () => {
  it("added is +occurrences, removed is −occurrences, changed carries its delta, unmarked is 0", () => {
    expect(deltaOf({ kind: "added" }, 7)).toBe(7);
    expect(deltaOf({ kind: "removed" }, 7)).toBe(-7);
    expect(deltaOf({ kind: "changed", delta: -2 }, 7)).toBe(-2);
    expect(deltaOf(undefined, 7)).toBe(0);
  });
});

describe("deltaTone", () => {
  it("colours a deprecated component's Δ by retirement polarity: more is red, fewer is plain ink, zero is ink", () => {
    expect(deltaTone(3, true)).toBe("text-status-err");
    expect(deltaTone(1, true)).toBe("text-status-err");
    expect(deltaTone(-2, true)).toBe("text-foreground");
    expect(deltaTone(0, true)).toBe("text-foreground");
  });

  it("keeps every other component's Δ in neutral ink, whichever way it moved", () => {
    expect(deltaTone(3, false)).toBe("text-foreground");
    expect(deltaTone(-2, false)).toBe("text-foreground");
    expect(deltaTone(0, false)).toBe("text-foreground");
  });
});

describe("ghostRow", () => {
  it("is a ComponentRow keyed by the component id with the previous occurrence total and no version or files", () => {
    expect(
      ghostRow({
        componentId: "c", displayName: "x-button", packageName: "@x/wc", scope: "external", kind: "custom-element",
        occurrenceCount: 8, deprecated: true, tags: [{ id: "t1", value: "forms", category: null, color: "teal" }],
      }),
    ).toEqual({
      componentId: "c", kind: "custom-element", scope: "external", packageName: "@x/wc",
      displayName: "x-button", disambiguator: null, version: null, occurrenceCount: 8, fileCount: 0,
      deprecated: true, tags: [{ id: "t1", value: "forms", category: null, color: "teal" }],
    });
  });
});
