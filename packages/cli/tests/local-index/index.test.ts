import { describe, expect, it } from "vitest";
import type { LocalDefinition } from "../../src/local-index/types.js";
import { buildLocalIndex } from "../../src/local-index/index.js";

// buildLocalIndex is a pure fold: it consumes a flat LocalDefinition[] and
// emits the byPath / byTag indices. File walking + detector dispatch live in
// scan.ts, so these tests construct definitions directly.

function wcDef(tag: string, filePath: string, exportName: string): LocalDefinition {
  return {
    componentId: { kind: "custom-element", tagName: tag, source: { type: "local", filePath } },
    exportName,
    isDefault: false,
    detector: "wc-decorator",
  };
}

function vueDef(name: string, filePath: string): LocalDefinition {
  return {
    componentId: { kind: "vue-component", export: name, source: { type: "local", filePath } },
    exportName: name,
    isDefault: false,
    detector: "vue-define-component",
  };
}

describe("buildLocalIndex: byTag", () => {
  it("keeps every registration of a tag, in stream order", () => {
    const a = wcDef("x-btn", "A.ts", "XBtnA");
    const b = wcDef("x-btn", "B.ts", "XBtnB");
    const index = buildLocalIndex([a, b, wcDef("x-icon", "C.ts", "XIcon")]);

    expect(index.byTag.get("x-btn")).toEqual([a, b]);
    expect(index.byTag.get("x-icon")).toHaveLength(1);
  });
});

describe("buildLocalIndex: byPath grouping", () => {
  it("groups multiple definitions in the same file under one byPath entry", () => {
    const index = buildLocalIndex([
      vueDef("Button", "src/components/Button.ts"),
      vueDef("ButtonGroup", "src/components/Button.ts"),
      vueDef("App", "src/App.ts"),
    ]);

    expect(index.byPath.get("src/components/Button.ts")).toHaveLength(2);
    expect(index.byPath.get("src/App.ts")).toHaveLength(1);
  });

  it("returns empty maps for an empty definition stream", () => {
    const index = buildLocalIndex([]);
    expect(index.byPath.size).toBe(0);
    expect(index.byTag.size).toBe(0);
  });
});
