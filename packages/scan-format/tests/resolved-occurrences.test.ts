import { describe, expect, it } from "vitest";
import { isResolved, resolvedOccurrences } from "../src/resolved-occurrences.js";
import type { Occurrence } from "../src/schema.js";

const occ = (id: string, resolution: Occurrence["resolution"]): Occurrence => ({
  occurrenceId: id, resolution, filePath: "src/a.tsx", line: 1, column: 1,
  credit: { kind: "render" }, trace: [], props: {},
});

describe("resolvedOccurrences", () => {
  it("keeps only resolved occurrences, in order", () => {
    const list = [
      occ("1", { status: "resolved", componentId: "c1" }),
      occ("2", { status: "unresolved", reason: { kind: "module-not-found" } }),
      occ("3", { status: "resolved", componentId: "c2" }),
    ];
    expect(resolvedOccurrences(list).map((o) => o.resolution.componentId)).toEqual(["c1", "c2"]);
    expect(isResolved(list[1])).toBe(false);
  });
  it("returns an empty list when nothing resolved", () => {
    expect(resolvedOccurrences([occ("1", { status: "unresolved", reason: { kind: "unbound-name", name: "X" } })])).toEqual([]);
  });
});
