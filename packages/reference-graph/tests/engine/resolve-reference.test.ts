import { describe, it, expect } from "vitest";
import {
  createGraphBuilder,
  MODULE_SCOPE,
  type Reference,
} from "../../src/index.js";
import { resolveReference } from "../../src/engine/resolve-reference.js";
import { libraryExportFor } from "../../src/engine/library-stubs.js";

describe("resolveReference: Reference → InferredType across files", () => {
  it("resolves a local declaration to its declared InferredType", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({ symbol: "Foo", value: { kind: "JSX" }, loc: { line: 1, column: 1 }, isExported: false });
    const graph = gb.build();
    const ref: Reference = { symbol: "Foo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("src/App.tsx");
    expect(fileGraph).toBeDefined();
    if (!fileGraph) return;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("JSX");
  });

  it("walks up the scope chain when symbol isn't in the local scope", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({ symbol: "Foo", value: { kind: "Str", value: "module" }, loc: { line: 1, column: 1 }, isExported: false });
    const inner = fb.pushScope();
    const graph = gb.build();
    const ref: Reference = { symbol: "Foo", scope: inner, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("src/App.tsx")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("Str");
  });

  it("returns Unknown for unresolved symbol", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("src/App.tsx");
    const graph = gb.build();
    const ref: Reference = { symbol: "Missing", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 } };
    const fileGraph = graph.files.get("src/App.tsx")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("Unknown");
  });

  it("follows an import across files (named export)", () => {
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => (spec === "./foo" ? "src/foo.tsx" : null),
    });
    const fbApp = gb.beginFile("src/App.tsx");
    fbApp.addImport({ specifier: "./foo", imported: "Foo", local: "Foo", loc: { line: 1, column: 1 } });
    const fbFoo = gb.beginFile("src/foo.tsx");
    fbFoo.addDeclaration({ symbol: "Foo", value: { kind: "JSX" }, loc: { line: 1, column: 1 }, isExported: true });
    fbFoo.addExport({ kind: "named", exportedAs: "Foo", local: "Foo" });
    const graph = gb.build();
    const ref: Reference = { symbol: "Foo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("src/App.tsx")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("JSX");
  });

  it("follows a barrel rename (export { local as exported } from)", () => {
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => {
        if (spec === "./foo") return "src/foo/index.js";
        if (spec === "./foo-impl") return "src/foo/foo-impl.tsx";
        return null;
      },
    });
    const fbApp = gb.beginFile("src/App.tsx");
    fbApp.addImport({ specifier: "./foo", imported: "Foo", local: "Foo", loc: { line: 1, column: 1 } });
    const fbBarrel = gb.beginFile("src/foo/index.js");
    fbBarrel.addExport({ kind: "named", exportedAs: "Foo", from: "./foo-impl", fromImported: "FooEnhanced" });
    const fbImpl = gb.beginFile("src/foo/foo-impl.tsx");
    fbImpl.addDeclaration({
      symbol: "FooEnhanced",
      value: { kind: "Str", value: "the-real-foo" },
      loc: { line: 1, column: 1 },
      isExported: true,
    });
    fbImpl.addExport({ kind: "named", exportedAs: "FooEnhanced", local: "FooEnhanced" });
    const graph = gb.build();
    const ref: Reference = { symbol: "Foo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("src/App.tsx")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("Str");
    if (t.kind === "Str") expect(t.value).toBe("the-real-foo");
  });

  it("cycle detection works through default exports too", () => {
    // a.js: default-exports X; X imports from b.js
    // b.js: default-exports X; X imports from a.js
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "./b" ? "b.js" : spec === "./a" ? "a.js" : null),
    });
    const fbA = gb.beginFile("a.js");
    fbA.addImport({ specifier: "./b", imported: "default", local: "X", loc: { line: 1, column: 1 } });
    fbA.addExport({ kind: "default", local: "X" });
    const fbB = gb.beginFile("b.js");
    fbB.addImport({ specifier: "./a", imported: "default", local: "X", loc: { line: 1, column: 1 } });
    fbB.addExport({ kind: "default", local: "X" });
    const graph = gb.build();
    const ref: Reference = { symbol: "X", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("a.js")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("Unknown");
  });

  it("cycle detection returns Unknown without infinite loop", () => {
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => (spec === "./b" ? "b.js" : spec === "./a" ? "a.js" : null),
    });
    const fbA = gb.beginFile("a.js");
    fbA.addImport({ specifier: "./b", imported: "X", local: "X", loc: { line: 1, column: 1 } });
    fbA.addExport({ kind: "named", exportedAs: "X", local: "X" });
    const fbB = gb.beginFile("b.js");
    fbB.addImport({ specifier: "./a", imported: "X", local: "X", loc: { line: 1, column: 1 } });
    fbB.addExport({ kind: "named", exportedAs: "X", local: "X" });
    const graph = gb.build();
    const ref: Reference = { symbol: "X", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("a.js")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("Unknown");
  });

  it("resolves a JSX type through a single-level star re-export", () => {
    // consumer → import { Widget } from './barrel'
    // barrel   → export * from './leaf'
    // leaf     → export const Widget = JSX
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => {
        if (spec === "./barrel") return "src/barrel.ts";
        if (spec === "./leaf") return "src/leaf.tsx";
        return null;
      },
    });
    const fbConsumer = gb.beginFile("src/consumer.tsx");
    fbConsumer.addImport({ specifier: "./barrel", imported: "Widget", local: "Widget", loc: { line: 1, column: 1 } });
    const fbBarrel = gb.beginFile("src/barrel.ts");
    fbBarrel.addExport({ kind: "star", from: "./leaf" });
    const fbLeaf = gb.beginFile("src/leaf.tsx");
    fbLeaf.addDeclaration({ symbol: "Widget", value: { kind: "JSX" }, loc: { line: 1, column: 1 }, isExported: true });
    fbLeaf.addExport({ kind: "named", exportedAs: "Widget", local: "Widget" });
    const graph = gb.build();
    const ref: Reference = { symbol: "Widget", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("src/consumer.tsx")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("JSX");
  });

  it("returns Unknown when star chain doesn't reach the symbol", () => {
    // consumer → import { Missing } from './barrel'
    // barrel   → export * from './leaf'
    // leaf     → only exports Widget, not Missing
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => {
        if (spec === "./barrel") return "src/barrel.ts";
        if (spec === "./leaf") return "src/leaf.tsx";
        return null;
      },
    });
    const fbConsumer = gb.beginFile("src/consumer.tsx");
    fbConsumer.addImport({ specifier: "./barrel", imported: "Missing", local: "Missing", loc: { line: 1, column: 1 } });
    const fbBarrel = gb.beginFile("src/barrel.ts");
    fbBarrel.addExport({ kind: "star", from: "./leaf" });
    const fbLeaf = gb.beginFile("src/leaf.tsx");
    fbLeaf.addDeclaration({ symbol: "Widget", value: { kind: "JSX" }, loc: { line: 1, column: 1 }, isExported: true });
    fbLeaf.addExport({ kind: "named", exportedAs: "Widget", local: "Widget" });
    const graph = gb.build();
    const ref: Reference = { symbol: "Missing", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("src/consumer.tsx")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("Unknown");
  });

  it("resolves a JSX type through a multi-level star chain", () => {
    // consumer → import { Widget } from './barrel'
    // barrel.ts → export * from './intermediate'
    // intermediate.ts → export * from './leaf'
    // leaf.tsx → export const Widget = JSX
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => {
        if (spec === "./barrel") return "src/barrel.ts";
        if (spec === "./intermediate") return "src/intermediate.ts";
        if (spec === "./leaf") return "src/leaf.tsx";
        return null;
      },
    });
    const fbConsumer = gb.beginFile("src/consumer.tsx");
    fbConsumer.addImport({ specifier: "./barrel", imported: "Widget", local: "Widget", loc: { line: 1, column: 1 } });
    const fbBarrel = gb.beginFile("src/barrel.ts");
    fbBarrel.addExport({ kind: "star", from: "./intermediate" });
    const fbIntermediate = gb.beginFile("src/intermediate.ts");
    fbIntermediate.addExport({ kind: "star", from: "./leaf" });
    const fbLeaf = gb.beginFile("src/leaf.tsx");
    fbLeaf.addDeclaration({ symbol: "Widget", value: { kind: "JSX" }, loc: { line: 1, column: 1 }, isExported: true });
    fbLeaf.addExport({ kind: "named", exportedAs: "Widget", local: "Widget" });
    const graph = gb.build();
    const ref: Reference = { symbol: "Widget", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("src/consumer.tsx")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("JSX");
  });

  it("handles a mutual star cycle without infinite recursion", () => {
    // a.ts → export * from './b'
    // b.ts → export * from './a'
    // consumer imports Nonexistent from a.ts, which resolves to Unknown without hanging
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => {
        if (spec === "./a") return "a.ts";
        if (spec === "./b") return "b.ts";
        return null;
      },
    });
    const fbConsumer = gb.beginFile("consumer.tsx");
    fbConsumer.addImport({ specifier: "./a", imported: "Nonexistent", local: "Nonexistent", loc: { line: 1, column: 1 } });
    const fbA = gb.beginFile("a.ts");
    fbA.addExport({ kind: "star", from: "./b" });
    const fbB = gb.beginFile("b.ts");
    fbB.addExport({ kind: "star", from: "./a" });
    const graph = gb.build();
    const ref: Reference = { symbol: "Nonexistent", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 5 } };
    const fileGraph = graph.files.get("consumer.tsx")!;
    const t = resolveReference(graph, fileGraph, ref);
    expect(t.kind).toBe("Unknown");
  });

  describe("library stubs", () => {
    function graphWithImport(imp: { specifier: string; imported: string; local: string }) {
      const gb = createGraphBuilder({ moduleResolver: () => null });
      const fb = gb.beginFile("src/App.tsx");
      fb.addImport({ ...imp, scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
      const graph = gb.build();
      return { graph, fileGraph: graph.files.get("src/App.tsx")! };
    }

    it("`import { memo } from 'react'` resolves to Function([ParameterOf(ref, 0)])", () => {
      const { graph, fileGraph } = graphWithImport({ specifier: "react", imported: "memo", local: "memo" });
      const ref: Reference = { symbol: "memo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 1 } };
      const t = resolveReference(graph, fileGraph, ref);
      expect(t).toEqual({ kind: "Function", returns: [{ kind: "ParameterOf", fn: ref, index: 0 }] });
    });

    it("`import { forwardRef } from 'preact/compat'` resolves to the same shape", () => {
      const { graph, fileGraph } = graphWithImport({ specifier: "preact/compat", imported: "forwardRef", local: "forwardRef" });
      const ref: Reference = { symbol: "forwardRef", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 1 } };
      const t = resolveReference(graph, fileGraph, ref);
      expect(t).toEqual({ kind: "Function", returns: [{ kind: "ParameterOf", fn: ref, index: 0 }] });
    });

    it("`import React from 'react'` + `React.memo` (memberChain) resolves via the default import", () => {
      const { graph, fileGraph } = graphWithImport({ specifier: "react", imported: "default", local: "React" });
      const ref: Reference = { symbol: "React", scope: MODULE_SCOPE, memberChain: ["memo"], loc: { line: 2, column: 1 } };
      const t = resolveReference(graph, fileGraph, ref);
      expect(t).toEqual({ kind: "Function", returns: [{ kind: "ParameterOf", fn: ref, index: 0 }] });
    });

    it("`import * as React from 'react'` + `React.forwardRef` resolves via the namespace import", () => {
      const { graph, fileGraph } = graphWithImport({ specifier: "react", imported: "*", local: "React" });
      const ref: Reference = { symbol: "React", scope: MODULE_SCOPE, memberChain: ["forwardRef"], loc: { line: 2, column: 1 } };
      const t = resolveReference(graph, fileGraph, ref);
      expect(t).toEqual({ kind: "Function", returns: [{ kind: "ParameterOf", fn: ref, index: 0 }] });
    });

    it("a non-stubbed react export (`useState`) still resolves to Unknown", () => {
      const { graph, fileGraph } = graphWithImport({ specifier: "react", imported: "useState", local: "useState" });
      const ref: Reference = { symbol: "useState", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 1 } };
      expect(resolveReference(graph, fileGraph, ref).kind).toBe("Unknown");
    });

    it("`memo` from a non-stubbed package resolves to Unknown", () => {
      const { graph, fileGraph } = graphWithImport({ specifier: "some-lib", imported: "memo", local: "memo" });
      const ref: Reference = { symbol: "memo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 1 } };
      expect(resolveReference(graph, fileGraph, ref).kind).toBe("Unknown");
    });

    it("a member chain on a named stub import (`memo.something`) is not a stub", () => {
      const { graph, fileGraph } = graphWithImport({ specifier: "react", imported: "memo", local: "memo" });
      const ref: Reference = { symbol: "memo", scope: MODULE_SCOPE, memberChain: ["displayName"], loc: { line: 2, column: 1 } };
      expect(resolveReference(graph, fileGraph, ref).kind).toBe("Unknown");
    });

    describe("libraryExportFor: the table both entry points read", () => {
      function exportFor(imp: { specifier: string; imported: string; local: string }, memberChain: string[] = []) {
        const { fileGraph } = graphWithImport(imp);
        const record = fileGraph.importsByLocal.get(imp.local);
        expect(record).toBeDefined();
        if (!record) return null;
        const ref: Reference = { symbol: imp.local, scope: MODULE_SCOPE, memberChain, loc: { line: 2, column: 1 } };
        return libraryExportFor(record, ref);
      }

      it("`import { memo } from 'react'` is identity-preserving", () => {
        expect(exportFor({ specifier: "react", imported: "memo", local: "memo" })).toEqual({ kind: "identity-preserving" });
      });

      it("`import { createContext } from 'react'` is a non-component product with context semantics", () => {
        expect(exportFor({ specifier: "react", imported: "createContext", local: "createContext" })).toEqual({
          kind: "non-component-product",
          semantics: "context",
        });
      });

      it("`import React from 'react'` + `React.createContext` resolves via the default import", () => {
        expect(exportFor({ specifier: "react", imported: "default", local: "React" }, ["createContext"])).toEqual({
          kind: "non-component-product",
          semantics: "context",
        });
      });

      it("`import * as R from 'react'` + `R.createContext` resolves via the namespace import", () => {
        expect(exportFor({ specifier: "react", imported: "*", local: "R" }, ["createContext"])).toEqual({
          kind: "non-component-product",
          semantics: "context",
        });
      });

      it("`createContext` from a non-stubbed package is not in the table", () => {
        expect(exportFor({ specifier: "state-kit", imported: "createContext", local: "createContext" })).toBeNull();
      });

      it("a createContext entry gives `libraryStubFor` nothing to resolve to", () => {
        const { graph, fileGraph } = graphWithImport({ specifier: "react", imported: "createContext", local: "createContext" });
        const ref: Reference = { symbol: "createContext", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 1 } };
        expect(resolveReference(graph, fileGraph, ref).kind).toBe("Unknown");
      });
    });
  });
});
