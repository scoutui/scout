import { describe, it, expect } from "vitest";
import { applyCompositionRollup } from "../../src/composition-rollup.js";
import type { RolledComponent } from "../../src/rollup.js";
import type { ResolvedOccurrence } from "@scoutui/scan-format";

const comp = (id: string): RolledComponent => ({
  id,
  identity: { kind: "repository-declaration", repoId: "r", filePath: `src/${id}.tsx`, exportName: id },
  framework: "react",
  stats: { occurrenceCount: 0, fileCount: 0 },
  usage: "none",
  props: {},
  version: null,
});

const occ = ({
  componentId = "X",
  ...overrides
}: Partial<Omit<ResolvedOccurrence, "resolution">> & { componentId?: string }): ResolvedOccurrence => ({
  occurrenceId: "occ-0",
  resolution: { status: "resolved", componentId },
  filePath: "src/a.tsx",
  line: 1,
  column: 1,
  credit: { kind: "render" },
  trace: [],
  props: {},
  ...overrides,
});

describe("applyCompositionRollup (owner-edge)", () => {
  it("populates rendersByCount on owner; renderedByCount on child", () => {
    const components = [comp("Page"), comp("Button")];
    const occs = [
      occ({ componentId: "Button", occurrenceId: "o1", ownerComponentId: "Page" }),
    ];
    const out = applyCompositionRollup(components, occs);
    const page = out.find((c) => c.id === "Page");
    const button = out.find((c) => c.id === "Button");
    if (!page || !button) throw new Error("missing component in output");
    expect(page.composition?.rendersByCount).toEqual({ Button: 1 });
    expect(page.composition?.renderedByCount).toEqual({});
    expect(button.composition?.renderedByCount).toEqual({ Page: 1 });
    expect(button.composition?.rendersByCount).toEqual({});
  });

  it("isRootCount increments when ownerComponentId is absent", () => {
    const components = [comp("Button")];
    const occs = [occ({ componentId: "Button", occurrenceId: "o1" })];
    const out = applyCompositionRollup(components, occs);
    expect(out[0]?.composition?.isRootCount).toBe(1);
  });

  it("isLeafCount increments when component has empty rendersByCount", () => {
    const components = [comp("Page"), comp("Button")];
    const occs = [occ({ componentId: "Button", occurrenceId: "o1", ownerComponentId: "Page" })];
    const out = applyCompositionRollup(components, occs);
    const button = out.find((c) => c.id === "Button");
    if (!button) throw new Error("missing component in output");
    expect(button.composition?.isLeafCount).toBe(1);
  });

  it("handles owner cycles (A renders B; B renders A)", () => {
    const components = [comp("A"), comp("B")];
    const occs = [
      occ({ componentId: "B", occurrenceId: "o1", ownerComponentId: "A", filePath: "x", line: 1, column: 1 }),
      occ({ componentId: "A", occurrenceId: "o2", ownerComponentId: "B", filePath: "x", line: 2, column: 1 }),
    ];
    const out = applyCompositionRollup(components, occs);
    const a = out.find((c) => c.id === "A");
    const b = out.find((c) => c.id === "B");
    if (!a || !b) throw new Error("missing component in output");
    expect(a.composition?.rendersByCount).toEqual({ B: 1 });
    expect(a.composition?.renderedByCount).toEqual({ B: 1 });
    expect(b.composition?.rendersByCount).toEqual({ A: 1 });
    expect(b.composition?.renderedByCount).toEqual({ A: 1 });
  });

  it("filters dangling rendersByCount/renderedByCount keys not present in components[]", () => {
    // Only "Page" is in components[]. Occurrences reference a phantom child "Phantom"
    // (e.g. a non-exported local helper that emits occurrences but never gets seeded).
    const components = [comp("Page")];
    const occs = [
      occ({ componentId: "Phantom", occurrenceId: "o1", ownerComponentId: "Page" }),
    ];
    const out = applyCompositionRollup(components, occs);
    const page = out.find((c) => c.id === "Page");
    if (!page) throw new Error("missing component in output");
    expect(page.composition?.rendersByCount).toEqual({});
    expect(page.composition?.renderedByCount).toEqual({});
  });

  it("emits composition block on components with zero occurrences", () => {
    const components = [comp("LonelyPage")];
    const out = applyCompositionRollup(components, []);
    expect(out[0]?.composition).toBeDefined();
    expect(out[0]?.composition?.rendersByCount).toEqual({});
    expect(out[0]?.composition?.renderedByCount).toEqual({});
    expect(out[0]?.composition?.isRootCount).toBe(0);
    expect(out[0]?.composition?.isLeafCount).toBe(0);
  });
});
