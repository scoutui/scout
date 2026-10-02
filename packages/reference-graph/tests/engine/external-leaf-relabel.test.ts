import { describe, it, expect, vi } from "vitest";
import { createGraphBuilder, MODULE_SCOPE } from "../../src/index.js";
import { resolve } from "../../src/engine/index.js";

/**
 * The consuming file imports `Wrapped` from a local barrel by relative
 * specifier; the barrel HOC-wraps an import of the aggregator package. On the
 * relative-import, not-in-graph branch, the folded terminal's own identity
 * (`ft.identity.specifier`, the aggregator specifier from the barrel's import
 * table) differs from `matchedImport.specifier` (the consuming file's own
 * `'./barrel'` specifier).
 */
function buildDivergentSpecifierGraph(opts: {
  appFilePath: string;
  barrelFilePath: string;
  aggregatorSpecifier: string;
  exportName: string;
}) {
  const gb = createGraphBuilder({
    moduleResolver: (from, spec) => (from === opts.appFilePath && spec === "./barrel" ? opts.barrelFilePath : null),
  });

  // barrel: imports ExternalThing from the aggregator package, wraps it in a
  // HOC, exports the wrapped local binding as `Wrapped`.
  const barrel = gb.beginFile(opts.barrelFilePath);
  barrel.addImport({
    specifier: opts.aggregatorSpecifier,
    imported: opts.exportName,
    local: opts.exportName,
    loc: { line: 1, column: 0 },
  });
  barrel.addDeclaration({
    symbol: "Wrapped",
    value: {
      kind: "ReturnTypeOf",
      callee: {
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { symbol: "connect", memberChain: [], scope: MODULE_SCOPE, loc: { line: 2, column: 0 } } },
        args: [],
      },
      args: [
        {
          kind: "TypeOf",
          ref: {
            symbol: opts.exportName,
            memberChain: [],
            scope: MODULE_SCOPE,
            loc: { line: 2, column: 20 },
            // Ref travels cross-file once resolveReference walks the export back up
            // to the consuming file: origin stays pinned to the barrel so identity
            // derivation looks up the barrel's import table.
            originFile: opts.barrelFilePath,
          },
        },
      ],
    },
    loc: { line: 2, column: 0 },
    isExported: true,
  });
  barrel.addExport({ kind: "named", exportedAs: "Wrapped", local: "Wrapped" });

  // App: `import { Wrapped } from './barrel'; <Wrapped/>`
  const app = gb.beginFile(opts.appFilePath);
  app.addImport({ specifier: "./barrel", imported: "Wrapped", local: "Wrapped", loc: { line: 1, column: 0 } });
  app.addJsxUsage({
    ref: { symbol: "Wrapped", memberChain: [], loc: { line: 3, column: 2 } },
    loc: { line: 3, column: 2 },
    props: [],
  });

  return gb.build();
}

describe("resolve resolveExternalLeaf relabel: every emission path", () => {
  it("relative-import branch: relabels using the folded terminal's own specifier, not the consuming file's import specifier", () => {
    const graph = buildDivergentSpecifierGraph({
      appFilePath: "src/App.tsx",
      barrelFilePath: "src/barrel.ts",
      aggregatorSpecifier: "@example/aggregator/react/button",
      exportName: "ExternalThing",
    });
    const hook = vi.fn(() => ({
      leafPackage: "@example/x-button",
      publicEntry: "dist/react",
      exportName: "ExternalThing",
    }));
    const { occurrences } = resolve(graph, { resolveExternalLeaf: hook });
    // The hook sees the barrel's own aggregator specifier, never the
    // consuming file's './barrel' specifier.
    expect(hook).toHaveBeenCalledWith("src/App.tsx", "@example/aggregator/react/button", "ExternalThing");
    const occ = occurrences.find((o) => o.rawComponentId?.kind === "react-component");
    expect(occ?.rawComponentId?.source).toEqual({
      type: "external",
      package: "@example/x-button",
      publicEntry: "dist/react",
    });
  });
});
