import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE } from "../../src/index.js";
import { resolve } from "../../src/engine/index.js";
import { exportOf } from "../helpers.js";

/**
 * Occurrence dedup is keyed on the full occurrence identity
 * (componentId + location + owner), not the call site alone. The collapse of
 * same-identity terminals at one tag, and of a module-scope element read
 * twice in one component, is pinned on real parser output in parser-react's
 * `engine-shapes-dedup.test.ts`.
 */
describe("occurrence dedup", () => {
  it("still emits one occurrence per distinct identity for a Union fanout", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({ symbol: "Alpha", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 1, column: 0 }, isExported: false });
    fb.addDeclaration({ symbol: "Beta", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 2, column: 0 }, isExported: false });
    // `Both` resolves to either Alpha or Beta: two distinct identities.
    fb.addDeclaration({
      symbol: "Both",
      value: {
        kind: "Union",
        types: [
          { kind: "TypeOf", ref: { symbol: "Alpha", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 0 } } },
          { kind: "TypeOf", ref: { symbol: "Beta", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 0 } } },
        ],
      },
      loc: { line: 3, column: 0 },
      isExported: false,
    });
    fb.addJsxUsage({
      ref: { symbol: "Both", memberChain: [], loc: { line: 6, column: 4 } },
      loc: { line: 6, column: 4 },
      props: [],
    });

    const { occurrences } = resolve(gb.build());

    const exports = occurrences.map((o) => exportOf(o.rawComponentId)).sort();
    expect(occurrences).toHaveLength(2);
    expect(exports).toEqual(["Alpha", "Beta"]);
  });
});
