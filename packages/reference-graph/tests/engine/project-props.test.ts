import { describe, it, expect } from "vitest";
import { projectPropUsages } from "../../src/engine/project-props.js";
import type { PropUsage } from "../../src/types/prop-usage.js";

describe("projectPropUsages", () => {
  it("maps each tier to per-occurrence state, keyed by name", () => {
    const usages: PropUsage[] = [
      { name: "size", tier: "written", value: "md" },
      { name: "variant", tier: "written", valueSet: ["a", "b"] },
      { name: "label", tier: "reference", ref: "props.label" },
      { name: "onX", tier: "dynamic" },
      { name: "n", tier: "written", value: null },
    ];
    expect(projectPropUsages(usages)).toEqual({
      size: { tier: "written", value: "md" },
      variant: { tier: "written", valueSet: ["a", "b"] },
      label: { tier: "reference", ref: "props.label" },
      onX: { tier: "dynamic" },
      n: { tier: "written", value: null },
    });
  });
});
