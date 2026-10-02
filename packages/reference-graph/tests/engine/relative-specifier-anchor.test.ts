import { describe, it, expect } from "vitest";
import { isAbsolute } from "node:path";
import { createGraphBuilder } from "../../src/index.js";
import { resolve as resolveGraph } from "../../src/engine/index.js";
import { createDiagnosticCollector } from "../../src/diagnostics.js";

/**
 * Graph keys are repoRoot-relative, but host module resolvers anchor
 * relative `from` paths against their own root (which can differ, e.g. the
 * workspace root when scanning a monorepo subdir). The builder must hand the
 * resolver an absolute `from` derived from the graph's repoRoot so relative
 * specifiers resolve regardless of the host resolver's anchor.
 */

/** Mimics a host resolver whose own anchor differs from the graph's repoRoot:
 *  a relative `from` resolves against the wrong directory and misses, so only
 *  absolute `from` paths produce a hit, as resolveImport does under an
 *  ancestor --repo-root. */
function anchorSensitiveResolver(from: string, spec: string): string | null {
  if (!isAbsolute(from)) return null;
  if (from === "/repo/src/page.tsx" && spec === "./button") {
    return "/repo/src/button.tsx";
  }
  return null;
}

function buildRelativeImportGraph(
  moduleResolver: (from: string, spec: string) => string | null,
) {
  const gb = createGraphBuilder({ moduleResolver, repoRoot: "/repo" });

  const target = gb.beginFile("src/button.tsx");
  target.addDeclaration({
    symbol: "Button",
    value: { kind: "Function", returns: [{ kind: "JSX" }] },
    loc: { line: 1, column: 0 },
    isExported: true,
  });
  target.addExport({ kind: "default", local: "Button" });

  const consumer = gb.beginFile("src/page.tsx");
  consumer.addImport({
    specifier: "./button",
    imported: "default",
    local: "Button",
    loc: { line: 1, column: 0 },
  });
  consumer.addJsxUsage({
    ref: { symbol: "Button", memberChain: [], loc: { line: 5, column: 2 } },
    loc: { line: 5, column: 2 },
    props: [],
  });

  return gb.build();
}

describe("relative-specifier resolution under a differently-anchored moduleResolver", () => {
  it("emits the occurrence: relative `from` graph keys reach the resolver absolutised against repoRoot", () => {
    const graph = buildRelativeImportGraph(anchorSensitiveResolver);
    const { occurrences } = resolveGraph(graph);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Button",
      source: { type: "local", filePath: "src/button.tsx" },
    });
    expect(occurrences[0]?.via).toMatchObject({
      kind: "direct-import",
      specifier: "./button",
    });
  });

  it("observes a module-not-found occurrence when a relative specifier genuinely fails to resolve", () => {
    const graph = buildRelativeImportGraph(() => null);
    const collector = createDiagnosticCollector();
    const { occurrences } = resolveGraph(graph, { collector });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      unresolved: { kind: "module-not-found" },
      filePath: "src/page.tsx",
      line: 5,
      column: 2,
      via: { kind: "direct-import", specifier: "./button" },
    });
    expect(collector.drain()).toEqual([]);
  });
});
