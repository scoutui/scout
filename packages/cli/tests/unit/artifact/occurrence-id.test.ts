import { describe, it, expect } from "vitest";
import { computeOccurrenceId } from "../../../src/artifact/occurrence-id.js";

describe("computeOccurrenceId", () => {
  it("returns a 16-char lowercase hex string", () => {
    const id = computeOccurrenceId("c-abc", "src/App.tsx", 10, 4);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic across calls with the same inputs", () => {
    const a = computeOccurrenceId("c-abc", "src/App.tsx", 10, 4);
    const b = computeOccurrenceId("c-abc", "src/App.tsx", 10, 4);
    expect(a).toBe(b);
  });

  it("differs when any tuple field changes", () => {
    const base = computeOccurrenceId("c-abc", "src/App.tsx", 10, 4);
    expect(computeOccurrenceId("c-xyz", "src/App.tsx", 10, 4)).not.toBe(base);
    expect(computeOccurrenceId("c-abc", "src/Other.tsx", 10, 4)).not.toBe(base);
    expect(computeOccurrenceId("c-abc", "src/App.tsx", 11, 4)).not.toBe(base);
    expect(computeOccurrenceId("c-abc", "src/App.tsx", 10, 5)).not.toBe(base);
  });
});
