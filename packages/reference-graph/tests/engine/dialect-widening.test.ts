import { describe, it, expect } from "vitest";
import { createGraphBuilder, resolve, MODULE_SCOPE } from "../../src/index.js";

describe("engine dialect-aware identity widening", () => {
  it("emits vue-component for unresolved external imports in a vue-dialect file", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("page.vue", "vue");
    fb.addImport({ specifier: "vue-btn-lib", imported: "VBtn", local: "VBtn", loc: { line: 1, column: 1 } });
    fb.addJsxUsage({
      ref: { symbol: "VBtn", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 5 } },
      loc: { line: 3, column: 5 },
      props: [],
    });

    const { occurrences } = resolve(gb.build());
    expect(occurrences[0]?.rawComponentId?.kind).toBe("vue-component");
  });

  it("keeps react-component as default for react-dialect files", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("page.tsx", "react");
    fb.addImport({ specifier: "react-lib", imported: "Btn", local: "Btn", loc: { line: 1, column: 1 } });
    fb.addJsxUsage({
      ref: { symbol: "Btn", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 5 } },
      loc: { line: 3, column: 5 },
      props: [],
    });

    const { occurrences } = resolve(gb.build());
    expect(occurrences[0]?.rawComponentId?.kind).toBe("react-component");
  });

  it("emits vue-component for a local-symbol JSX usage in a vue-dialect file", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("widgets/card.vue", "vue");
    fb.addDeclaration({
      symbol: "LocalCard",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addJsxUsage({
      ref: { symbol: "LocalCard", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 5 } },
      loc: { line: 3, column: 5 },
      props: [],
    });

    const { occurrences } = resolve(gb.build());
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toMatchObject({
      kind: "vue-component",
      export: "LocalCard",
      source: { type: "local", filePath: "widgets/card.vue" },
    });
  });

  it("owner identity uses the declaring file's dialect, not the consumer's (vue usage, react owner)", () => {
    const gb = createGraphBuilder({
      // The graph absolutises relative `from` keys against repoRoot before
      // delegating, so the host resolver sees absolute paths.
      moduleResolver: (from, spec) =>
        from === "/repo/src/Page.tsx" && spec === "../widgets/icon-row.vue" ? "/repo/widgets/icon-row.vue" : null,
      repoRoot: "/repo",
    });

    // Vue SFC: helper renderIcon owns a JSX usage of an external import.
    const fbVue = gb.beginFile("widgets/icon-row.vue", "vue");
    fbVue.addImport({ specifier: "icon-lib", imported: "Icon", local: "Icon", loc: { line: 1, column: 1 } });
    fbVue.addDeclaration({
      symbol: "renderIcon",
      // Array<JSX> return shape → classified as a helper (not a component),
      // so the owner chain walks through it to the cross-file caller.
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 2, column: 1 },
      isExported: true,
    });
    fbVue.addExport({ kind: "named", exportedAs: "renderIcon", local: "renderIcon" });
    fbVue.addJsxUsage({
      ref: { symbol: "Icon", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 5 } },
      loc: { line: 3, column: 5 },
      props: [],
    });
    fbVue.setOwner({
      symbol: "renderIcon",
      scope: MODULE_SCOPE,
      memberChain: [],
      loc: { line: 2, column: 1 },
      originFile: "widgets/icon-row.vue",
    });

    // React file: component Page imports and calls the vue-declared helper.
    const fbReact = gb.beginFile("src/Page.tsx", "react");
    fbReact.addImport({
      specifier: "../widgets/icon-row.vue",
      imported: "renderIcon",
      local: "renderIcon",
      loc: { line: 1, column: 1 },
    });
    fbReact.addDeclaration({
      symbol: "Page",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "ReturnTypeOf",
            callee: {
              kind: "TypeOf",
              ref: { symbol: "renderIcon", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/Page.tsx" },
            },
            args: [],
          },
          { kind: "JSX" },
        ],
      },
      loc: { line: 2, column: 1 },
      isExported: true,
    });

    const { occurrences } = resolve(gb.build());
    expect(occurrences).toHaveLength(1);
    // The occurrence itself sits in the vue file → consumer dialect.
    expect(occurrences[0]?.rawComponentId?.kind).toBe("vue-component");
    // The owner is declared in the react file → declaring-file dialect.
    expect(occurrences[0]?.rawOwnerComponentId).toMatchObject({
      kind: "react-component",
      export: "Page",
      source: { type: "local", filePath: "src/Page.tsx" },
    });
  });
});
