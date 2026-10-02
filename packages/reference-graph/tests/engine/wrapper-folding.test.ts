import { describe, it, expect } from "vitest";
import {
  createGraphBuilder,
  MODULE_SCOPE,
  type InferredType,
  type Reference,
} from "../../src/index.js";
import { walkWithFolding } from "../../src/engine/wrapper-folding.js";
import { creditedTerminals } from "../../src/engine/denotation.js";
import { createArgumentMap } from "../../src/engine/argument-map.js";
import { DYNAMIC_MEMBER_KEY } from "../../src/engine/resolve-type.js";

const dummyRef: Reference = {
  symbol: "X",
  scope: MODULE_SCOPE,
  memberChain: [],
  loc: { line: 1, column: 1 },
};

describe("walkWithFolding: pass-through cases", () => {
  it("JSX terminal passes through with empty viaTrail and null identity", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const result = walkWithFolding(graph, fileGraph, { kind: "JSX" }, argMap);
    expect(result).toEqual([{ denotation: { kind: "element" }, viaTrail: [], identity: null }]);
  });

  it("TypeOf to a local JSX binding derives local identity", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const result = walkWithFolding(
      graph,
      fileGraph,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } },
      argMap,
    );
    expect(result).toEqual([
      {
        denotation: { kind: "element" },
        viaTrail: [],
        identity: { kind: "local", filePath: "a.tsx", export: "Foo", declaration: expect.objectContaining({ symbol: "Foo" }) },
      },
    ]);
  });

  it("TypeOf to an imported binding derives imported identity", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "external-pkg",
      imported: "Button",
      local: "Button",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const result = walkWithFolding(
      graph,
      fileGraph,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "Button" } },
      argMap,
    );
    // Target file isn't in the graph, so the algebra can't reduce further:
    // resolveType preserves the TypeOf as an identity-bearing terminal and
    // foldTerminals synthesizes a `foreign` terminal from it. Identity
    // still derives from the import record.
    expect(result[0].denotation).toEqual({ kind: "foreign" });
    expect(result[0].identity).toEqual({
      kind: "imported",
      specifier: "external-pkg",
      imported: "Button",
    });
  });

  it("Static MemberOf (named member) passes through with empty viaTrail", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const t: InferredType = {
      kind: "MemberOf",
      obj: { kind: "Object", props: { a: { kind: "JSX" }, b: { kind: "Str", value: "x" } } },
      member: "a",
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result).toEqual([
      { denotation: { kind: "element" }, viaTrail: [], identity: null },
    ]);
  });
});

describe("deriveIdentity: relative spellings of one target", () => {
  /** `a/page.tsx` declares `Page`, exported by name and as the default. */
  function declarePage(gb: ReturnType<typeof createGraphBuilder>): void {
    const page = gb.beginFile("a/page.tsx");
    page.addDeclaration({ symbol: "Page", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 1, column: 7 }, isExported: true });
    page.addExport({ kind: "named", exportedAs: "Page", local: "Page" });
    page.addExport({ kind: "default", local: "Page" });
  }
  const pageIdentity = { kind: "local", filePath: "a/page.tsx", export: "Page" };

  it("relative-specifier imports of one file name the same declaration", () => {
    // Two callers spell the target differently ('./page' from a/, '../page'
    // from a/sub/). The moduleResolver canonicalises both to the same target,
    // so both name its declaration.
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => {
        if (from === "a/index.tsx" && spec === "./page") return "a/page.tsx";
        if (from === "a/sub/inner.tsx" && spec === "../page") return "a/page.tsx";
        return null;
      },
    });
    for (const file of ["a/index.tsx", "a/sub/inner.tsx"]) gb.beginFile(file);
    declarePage(gb);
    const graph = gb.build();

    const a = graph.files.get("a/index.tsx")!;
    const aImp = {
      specifier: "./page",
      imported: "Page",
      local: "Page",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    };
    a.imports.push(aImp);
    a.importsByLocal.set(aImp.local, aImp);
    const sub = graph.files.get("a/sub/inner.tsx")!;
    const subImp = {
      specifier: "../page",
      imported: "Page",
      local: "Page",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    };
    sub.imports.push(subImp);
    sub.importsByLocal.set(subImp.local, subImp);

    const argMap = createArgumentMap();
    const aResult = walkWithFolding(
      graph,
      a,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "Page" } },
      argMap,
    );
    const subResult = walkWithFolding(
      graph,
      sub,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "Page" } },
      argMap,
    );

    expect(aResult[0].identity).toMatchObject(pageIdentity);
    expect(subResult[0].identity).toMatchObject(pageIdentity);
  });

  it("workspace-sibling bare-package import → local identity", () => {
    // `import { Page } from '@org/foo'` resolving to a workspace sibling file
    // in the parsed graph should emit a `kind: "local"` identity, not the
    // external phantom.
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => {
        if (spec === "@org/foo") return "packages/foo/src/index.tsx";
        return null;
      },
    });
    const consumerFb = gb.beginFile("apps/web/App.tsx");
    consumerFb.addImport({
      specifier: "@org/foo",
      imported: "Page",
      local: "Page",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    const siblingFb = gb.beginFile("packages/foo/src/index.tsx");
    siblingFb.addExport({ kind: "named", exportedAs: "Page", local: "Page" });
    siblingFb.addDeclaration({
      symbol: "Page",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 7 },
      isExported: true,
    });
    const graph = gb.build();
    const consumer = graph.files.get("apps/web/App.tsx")!;
    const argMap = createArgumentMap();
    const result = walkWithFolding(
      graph,
      consumer,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "Page" } },
      argMap,
    );
    expect(result[0].identity).toEqual({
      kind: "local",
      filePath: "packages/foo/src/index.tsx",
      export: "Page",
      declaration: expect.objectContaining({ symbol: "Page" }),
    });
  });

  it("external-package import (not in graph) stays external", () => {
    // `import { Button } from 'react-aria'` where react-aria isn't in
    // graph.files (node_modules excluded) should stay external: the
    // workspace-sibling check requires the resolved target in `graph.files`.
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => {
        if (spec === "react-aria") return "node_modules/react-aria/index.js";
        return null;
      },
    });
    const consumerFb = gb.beginFile("app.tsx");
    consumerFb.addImport({
      specifier: "react-aria",
      imported: "Button",
      local: "Button",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    const graph = gb.build();
    const consumer = graph.files.get("app.tsx")!;
    const argMap = createArgumentMap();
    const result = walkWithFolding(
      graph,
      consumer,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "Button" } },
      argMap,
    );
    expect(result[0].identity).toEqual({
      kind: "imported",
      specifier: "react-aria",
      imported: "Button",
    });
  });

  it("re-export barrel → canonical source: TypeOf-import resolves through chain", () => {
    // `import X from './barrel'` where ./barrel re-exports X from ./source:
    // identity should stamp as { kind: "local", filePath: "source.tsx" },
    // matching the local-index seed for the canonical definition.
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => {
        if (spec === "./barrel") return "barrel.tsx";
        if (from === "barrel.tsx" && spec === "./source") return "source.tsx";
        return null;
      },
    });
    const consumerFb = gb.beginFile("app.tsx");
    consumerFb.addImport({
      specifier: "./barrel",
      imported: "Foo",
      local: "Foo",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    const barrelFb = gb.beginFile("barrel.tsx");
    barrelFb.addExport({
      kind: "named",
      exportedAs: "Foo",
      from: "./source",
      fromImported: "FooInner",
    });
    const sourceFb = gb.beginFile("source.tsx");
    sourceFb.addExport({ kind: "named", exportedAs: "FooInner", local: "FooInner" });
    sourceFb.addDeclaration({
      symbol: "FooInner",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 7 },
      isExported: true,
    });
    const graph = gb.build();
    const consumer = graph.files.get("app.tsx")!;
    const argMap = createArgumentMap();
    const result = walkWithFolding(
      graph,
      consumer,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } },
      argMap,
    );
    expect(result[0].identity).toEqual({
      kind: "local",
      filePath: "source.tsx",
      export: "FooInner",
      declaration: expect.objectContaining({ symbol: "FooInner" }),
    });
  });

  it("re-export cycle is broken by the seen-set guard", () => {
    // Pathological: a.tsx re-exports X from b.tsx, b.tsx re-exports X from
    // a.tsx. The cycle guard should bail rather than looping forever.
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => {
        if (spec === "./a") return "a.tsx";
        if (from === "a.tsx" && spec === "./b") return "b.tsx";
        if (from === "b.tsx" && spec === "./a") return "a.tsx";
        return null;
      },
    });
    const consumerFb = gb.beginFile("app.tsx");
    consumerFb.addImport({
      specifier: "./a",
      imported: "X",
      local: "X",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    const aFb = gb.beginFile("a.tsx");
    aFb.addExport({ kind: "named", exportedAs: "X", from: "./b", fromImported: "X" });
    const bFb = gb.beginFile("b.tsx");
    bFb.addExport({ kind: "named", exportedAs: "X", from: "./a", fromImported: "X" });
    const graph = gb.build();
    const consumer = graph.files.get("app.tsx")!;
    const argMap = createArgumentMap();
    // Cycle: a→b→a (guard triggers). Walk should return without hanging.
    const result = walkWithFolding(
      graph,
      consumer,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "X" } },
      argMap,
    );
    // The guard bails to a single indeterminate terminal: the cycle names
    // no declaration, so no identity is attributed to either hop.
    expect(result).toEqual([{ denotation: { kind: "indeterminate" }, viaTrail: [], identity: null }]);
  });

  it("an unresolvable package specifier names the import as written", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "missing-pkg",
      imported: "X",
      local: "X",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const result = walkWithFolding(
      graph,
      fileGraph,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "X" } },
      argMap,
    );
    expect(result[0].identity).toEqual({
      kind: "imported",
      specifier: "missing-pkg",
      imported: "X",
    });
  });
});

describe("walkWithFolding: HOC fallback rule", () => {
  it("external HOC over a relative-resolved-to-graph inner emits JSX terminal", () => {
    // When the re-export chain promotes the inner identity to kind:"local"
    // (the inner spec resolves into the parsed graph), the HOC fallback still
    // synthesises an element terminal: imported and local-promoted identities
    // both trigger synthesis.
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => {
        if (spec === "react-redux") return null; // external HOC, can't resolve
        if (spec === "./content") return "content.tsx";
        return null;
      },
    });
    const consumerFb = gb.beginFile("app.tsx");
    consumerFb.addImport({
      specifier: "react-redux",
      imported: "connect",
      local: "connect",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    consumerFb.addImport({
      specifier: "./content",
      imported: "Content",
      local: "Content",
      scope: MODULE_SCOPE,
      loc: { line: 2, column: 1 },
    });
    const contentFb = gb.beginFile("content.tsx");
    contentFb.addExport({ kind: "named", exportedAs: "Content", local: "Content" });
    contentFb.addDeclaration({
      symbol: "Content",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 7 },
      isExported: true,
    });
    const graph = gb.build();
    const consumer = graph.files.get("app.tsx")!;
    const argMap = createArgumentMap();
    // connect(Content): the algebra fails on the opaque external `connect`, so
    // the HOC fallback synthesises an element terminal with the local identity.
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "connect" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Content" } }],
    };
    const result = walkWithFolding(graph, consumer, t, argMap);
    expect(result.length).toBe(1);
    expect(result[0].denotation).toEqual({ kind: "element" });
    expect(result[0].identity).toEqual({
      kind: "local",
      filePath: "content.tsx",
      export: "Content",
      declaration: expect.objectContaining({ symbol: "Content" }),
    });
    expect(result[0].viaTrail).toHaveLength(1);
    expect(result[0].viaTrail[0].kind).toBe("hoc-wrapper");
  });

  it("external HOC (callee Unknown) folds to last arg with hoc-wrapper via and inner identity", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "react-redux",
      imported: "connect",
      local: "connect",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    // ReturnTypeOf(TypeOf(connect), [TypeOf(Foo)]), equivalent to connect(Foo).
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "connect" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result.length).toBe(1);
    expect(result[0].denotation).toEqual({ kind: "element" });
    expect(result[0].viaTrail.length).toBe(1);
    expect(result[0].viaTrail[0].kind).toBe("hoc-wrapper");
    if (result[0].viaTrail[0].kind === "hoc-wrapper") {
      expect(result[0].viaTrail[0].hocCallee).toBe("connect");
    }
    // Identity is inherited from the inner arg: the JSX terminal belongs to Foo.
    expect(result[0].identity).toEqual({
      kind: "local",
      filePath: "a.tsx",
      export: "Foo",
      declaration: expect.objectContaining({ symbol: "Foo" }),
    });
  });

  it("curried HOC connect()(Foo) emits one via entry, not two", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "react-redux",
      imported: "connect",
      local: "connect",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    // ReturnTypeOf(ReturnTypeOf(TypeOf(connect), []), [TypeOf(Foo)]): curried connect()(Foo)
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: {
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "connect" } },
        args: [],
      },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result.length).toBe(1);
    expect(result[0].viaTrail.length).toBe(1);
    if (result[0].viaTrail[0].kind === "hoc-wrapper") {
      expect(result[0].viaTrail[0].hocCallee).toBe("connect");
    }
  });

  it("nested distinct HOCs build multi-element viaTrail (connect()(withRouter(Foo)))", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "react-redux",
      imported: "connect",
      local: "connect",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    fb.addImport({
      specifier: "react-router",
      imported: "withRouter",
      local: "withRouter",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    // connect()(withRouter(Foo))
    const innerCall: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "withRouter" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: {
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "connect" } },
        args: [],
      },
      args: [innerCall],
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result.length).toBe(1);
    expect(result[0].viaTrail.length).toBe(2);
    if (result[0].viaTrail[0].kind === "hoc-wrapper") {
      expect(result[0].viaTrail[0].hocCallee).toBe("connect");
    }
    if (result[0].viaTrail[1].kind === "hoc-wrapper") {
      expect(result[0].viaTrail[1].hocCallee).toBe("withRouter");
    }
  });

  it("local identity-preserving wrapper id(Foo) where id = x => x folds to Foo with a hoc-wrapper via", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "id",
      value: {
        kind: "Function",
        returns: [{ kind: "ParameterOf", fn: { ...dummyRef, symbol: "id" }, index: 0 }],
      },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "id" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result.length).toBe(1);
    expect(result[0].denotation).toEqual({ kind: "element" });
    expect(result[0].identity).toEqual({ kind: "local", filePath: "a.tsx", export: "Foo", declaration: expect.objectContaining({ symbol: "Foo" }) });
    expect(result[0].viaTrail).toEqual([
      { kind: "hoc-wrapper", hocCallee: "id" },
    ]);
  });

  it("HOC fallback for external import target synthesises a foreign terminal with imported identity", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "@example/react-ds",
      imported: "Button",
      local: "Button",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    fb.addDeclaration({
      symbol: "connect",
      value: { kind: "Function", returns: [{ kind: "Function", returns: [{ kind: "Unknown" }] }] },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    // ReturnTypeOf(ReturnTypeOf(TypeOf(connect), []), [TypeOf(Button)]): connect()(Button)
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: {
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "connect" } },
        args: [],
      },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Button" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result.length).toBe(1);
    expect(result[0].denotation).toEqual({ kind: "foreign" });
    expect(result[0].viaTrail.length).toBe(1);
    expect(result[0].viaTrail[0].kind).toBe("hoc-wrapper");
    expect(result[0].identity).toEqual({
      kind: "imported",
      specifier: "@example/react-ds",
      imported: "Button",
    });
  });

  it("ReturnTypeOf with no args + Unknown algebra → returns Unknown, no fold", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "external",
      imported: "unknown",
      local: "unknown",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "unknown" } },
      args: [],
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result[0].denotation.kind).toBe("indeterminate");
    expect(result[0].viaTrail).toEqual([]);
  });
});




describe("walkWithFolding: algebra-success per-leaf identity", () => {
  it("getMapped(k) → MAP[k] yields per-leaf identity, not collapsed to getMapped", () => {
    // const MAP = { foo: Foo, bar: Bar };
    // function getMapped(k) { return MAP[k]; }
    // walkWithFolding(ReturnTypeOf(TypeOf(getMapped), [k])) should yield two
    // terminals, one with identity = Foo (local), one with identity = Bar (local).
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "Bar",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "MAP",
      value: {
        kind: "Object",
        props: {
          foo: { kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } },
          bar: { kind: "TypeOf", ref: { ...dummyRef, symbol: "Bar" } },
        },
      },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "getMapped",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "MemberOf",
            obj: { kind: "TypeOf", ref: { ...dummyRef, symbol: "MAP" } },
            member: DYNAMIC_MEMBER_KEY,
          },
        ],
      },
      loc: { line: 4, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "getMapped" } },
      args: [{ kind: "Str", value: "foo" }],
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result.length).toBe(2);
    const fooTerminal = result.find(
      (r) => r.identity?.kind === "local" && r.identity.export === "Foo",
    );
    const barTerminal = result.find(
      (r) => r.identity?.kind === "local" && r.identity.export === "Bar",
    );
    expect(fooTerminal).toBeDefined();
    expect(barTerminal).toBeDefined();
    // Neither terminal should collapse to getMapped's identity.
    expect(
      result.every((r) => !(r.identity?.kind === "local" && r.identity.export === "getMapped")),
    ).toBe(true);
  });
});

describe("walkWithFolding: unreducible-leaf identity synthesis", () => {
  it("alias to unresolvable external import synthesises a foreign terminal with imported identity", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "external-pkg",
      imported: "Button",
      local: "Button",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    fb.addDeclaration({
      symbol: "AliasedButton",
      value: { kind: "TypeOf", ref: { ...dummyRef, symbol: "Button" } },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const result = walkWithFolding(
      graph,
      fileGraph,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "AliasedButton" } },
      createArgumentMap(),
    );
    expect(result).toEqual([
      {
        denotation: { kind: "foreign" },
        viaTrail: [],
        identity: {
          kind: "imported",
          specifier: "external-pkg",
          imported: "Button",
        },
      },
    ]);
  });
});

describe("walkWithFolding: structural pass-through", () => {
  it("a wrapper whose returns are not all ParameterOf does not take the structural path", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    // withFallback = (C) => cond ? C : <div/> (a Union return, not a bare ParameterOf).
    fb.addDeclaration({
      symbol: "withFallback",
      value: {
        kind: "Function",
        returns: [{ kind: "Union", types: [{ kind: "ParameterOf", fn: { ...dummyRef, symbol: "withFallback" }, index: 0 }, { kind: "JSX" }] }],
      },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({ symbol: "Foo", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 2, column: 1 }, isExported: false });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "withFallback" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    // Whatever the algebra path returns, it must not have been produced by the
    // structural step: no single hoc-wrapper(withFallback) hop with identity Foo.
    const structural = result.filter(
      (r) => r.identity?.kind === "local" && r.identity.export === "Foo" && r.viaTrail.some((v) => v.kind === "hoc-wrapper" && v.hocCallee === "withFallback"),
    );
    expect(structural).toHaveLength(0);
  });

  it("structural pass-through synthesises a foreign terminal when the wrapped arg bottoms out at Unknown but carries an identity (as the HOC fallback does)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "id",
      value: { kind: "Function", returns: [{ kind: "ParameterOf", fn: { ...dummyRef, symbol: "id" }, index: 0 }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    // Foo's body returns something the algebra cannot reduce (e.g. an unresolvable helper call).
    fb.addDeclaration({ symbol: "Foo", value: { kind: "Function", returns: [{ kind: "Unknown" }] }, loc: { line: 2, column: 1 }, isExported: false });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "id" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(result).toEqual([
      {
        denotation: { kind: "foreign" },
        viaTrail: [{ kind: "hoc-wrapper", hocCallee: "id" }],
        identity: { kind: "local", filePath: "a.tsx", export: "Foo", declaration: expect.objectContaining({ symbol: "Foo" }) },
      },
    ]);
  });
});

describe("walkWithFolding: resolvable factory calls take the holding declaration", () => {
  it("makeControl(DropdownBase, fn) yields a JSX terminal with identity null, never the callee", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({ specifier: "@example/design-system", imported: "Dropdown", local: "DropdownBase", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    // makeControl = (Component, mapProps) => (props) => <Component/>
    fb.addDeclaration({ symbol: "makeControl", value: { kind: "Function", returns: [{ kind: "Function", returns: [{ kind: "JSX" }] }] }, loc: { line: 2, column: 1 }, isExported: false });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "makeControl" } },
      args: [
        { kind: "TypeOf", ref: { ...dummyRef, symbol: "DropdownBase" } },
        { kind: "Function", returns: [{ kind: "Object", props: {} }] },
      ],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    const jsx = creditedTerminals(result);
    expect(jsx).toHaveLength(1);
    expect(jsx[0].identity).toBeNull();
    expect(jsx[0].viaTrail).toEqual([]);
  });

  it("withHoc(useHook, View) with a local View yields identity null (engine falls back to the product), not withHoc", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({ symbol: "withHoc", value: { kind: "Function", returns: [{ kind: "Function", returns: [{ kind: "JSX" }] }] }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "useHook", value: { kind: "Function", returns: [{ kind: "Object", props: {} }] }, loc: { line: 2, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "View", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 3, column: 1 }, isExported: false });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "withHoc" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "useHook" } }, { kind: "TypeOf", ref: { ...dummyRef, symbol: "View" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    const jsx = creditedTerminals(result);
    expect(jsx).toHaveLength(1);
    expect(jsx[0].identity).toBeNull();
    expect(jsx[0].viaTrail).toEqual([]);
  });
});

describe("walkWithFolding: structural pass-through over library stubs", () => {
  function reactGraph() {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({ specifier: "react", imported: "memo", local: "memo", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    fb.addImport({ specifier: "react", imported: "forwardRef", local: "forwardRef", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    fb.addImport({ specifier: "ds-lib", imported: "Button", local: "Button", scope: MODULE_SCOPE, loc: { line: 2, column: 1 } });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    return { gb, fb };
  }

  it("memo(Foo) over a local component folds to Foo with hoc-wrapper(memo)", () => {
    const { gb } = reactGraph();
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "memo" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(result).toHaveLength(1);
    expect(result[0].identity).toEqual({ kind: "local", filePath: "a.tsx", export: "Foo", declaration: expect.objectContaining({ symbol: "Foo" }) });
    expect(result[0].viaTrail[0]).toEqual({ kind: "hoc-wrapper", hocCallee: "memo" });
  });

  it("memo(Button) over an external import folds to Button with hoc-wrapper(memo)", () => {
    const { gb } = reactGraph();
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "memo" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Button" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(result).toHaveLength(1);
    expect(result[0].denotation).toEqual({ kind: "foreign" });
    expect(result[0].identity).toMatchObject({ kind: "imported", specifier: "ds-lib", imported: "Button" });
    expect(result[0].viaTrail).toEqual([
      { kind: "hoc-wrapper", hocCallee: "memo", specifier: "ds-lib", import: "Button" },
    ]);
  });

  it("forwardRef(anonymous arrow) yields identity null (engine falls back to the holding declaration) with hoc-wrapper(forwardRef)", () => {
    const { gb } = reactGraph();
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const arrow: InferredType = {
      kind: "Function",
      returns: [{ kind: "JSX" }],
      enclosingBinding: { file: "a.tsx" },
    };
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "forwardRef" } },
      args: [arrow],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(result).toHaveLength(1);
    expect(result[0].denotation).toEqual({ kind: "element" });
    expect(result[0].identity).toBeNull();
    expect(result[0].viaTrail).toEqual([
      { kind: "hoc-wrapper", hocCallee: "forwardRef" },
    ]);
  });

  it("memo(forwardRef(arrow)) nests two hoc-wrapper hops, outermost first", () => {
    const { gb } = reactGraph();
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const arrow: InferredType = { kind: "Function", returns: [{ kind: "JSX" }], enclosingBinding: { file: "a.tsx" } };
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "memo" } },
      args: [{
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "forwardRef" } },
        args: [arrow],
      }],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(result).toHaveLength(1);
    expect(result[0].viaTrail.map((v) => (v.kind === "hoc-wrapper" ? v.hocCallee : v.kind))).toEqual(["memo", "forwardRef"]);
  });

  it("`(C) => C` lowered as a TypeOf return over a child-scope ParameterOf binding still folds", () => {
    // Real parser output for `const id = (C) => C` is not a bare ParameterOf
    // return: the return is a TypeOf naming the parameter binding, and the
    // ParameterOf lives on that binding's declaration in the body scope.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    const idRef: Reference = { ...dummyRef, symbol: "id" };
    const bodyScope = fb.pushScope();
    fb.addDeclaration({
      symbol: "C",
      value: { kind: "ParameterOf", fn: idRef, index: 0 },
      loc: { line: 1, column: 12 },
      isExported: false,
    });
    fb.popScope();
    fb.addDeclaration({
      symbol: "id",
      value: {
        kind: "Function",
        returns: [{ kind: "TypeOf", ref: { symbol: "C", scope: bodyScope, memberChain: [], loc: { line: 1, column: 18 } } }],
      },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({ symbol: "Foo", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 2, column: 1 }, isExported: false });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: idRef },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(result).toHaveLength(1);
    expect(result[0].denotation).toEqual({ kind: "element" });
    expect(result[0].identity).toEqual({ kind: "local", filePath: "a.tsx", export: "Foo", declaration: expect.objectContaining({ symbol: "Foo" }) });
    expect(result[0].viaTrail).toEqual([
      { kind: "hoc-wrapper", hocCallee: "id" },
    ]);
  });
});

describe("walkWithFolding: a fan-out branch with no identity of its own falls back to the resolved binding", () => {
  it("View = Function([Union([JSX, JSX])]); every JSX terminal from TypeOf(View) carries View's identity, not null", () => {
    // A bare JSX branch (no TypeOf/DynamicImport leaf inside it, the shape
    // parser-react's Union lowering produces for a ternary render body) has
    // no identity of its own. foldTerminals must fall back to the resolved
    // binding (View) rather than stopping at the branch's empty source.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "View",
      value: { kind: "Function", returns: [{ kind: "Union", types: [{ kind: "JSX" }, { kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = { kind: "TypeOf", ref: { ...dummyRef, symbol: "View" } };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(r.denotation).toEqual({ kind: "element" });
      expect(r.identity).toEqual({ kind: "local", filePath: "a.tsx", export: "View", declaration: expect.objectContaining({ symbol: "View" }) });
    }
  });

  it("a branch that has its own binding still wins over the fallback", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({ symbol: "A", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "B", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 2, column: 1 }, isExported: false });
    fb.addDeclaration({
      symbol: "View",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "Union",
            types: [
              { kind: "TypeOf", ref: { ...dummyRef, symbol: "A" } },
              { kind: "TypeOf", ref: { ...dummyRef, symbol: "B" } },
            ],
          },
        ],
      },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = { kind: "TypeOf", ref: { ...dummyRef, symbol: "View" } };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(result).toHaveLength(2);
    const aTerminal = result.find((r) => r.identity?.kind === "local" && r.identity.export === "A");
    const bTerminal = result.find((r) => r.identity?.kind === "local" && r.identity.export === "B");
    expect(aTerminal).toBeDefined();
    expect(bTerminal).toBeDefined();
    expect(result.every((r) => !(r.identity?.kind === "local" && r.identity.export === "View"))).toBe(true);
  });
});

describe("walkWithFolding: a data-method render call is not a wrapper", () => {
  it("Function{returns:[ReturnTypeOf(MemberOf(TypeOf(items /* param */), 'map'), [Function[JSX]])]}: List's own returns fold to the callback's JSX terminal, no hoc-wrapper hop, identity null", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    // `List = ({ items }) => items.map((it) => <Item key={it.id} />)`. `items`
    // is an unresolved (never imported, never declared) TypeOf, the shape a
    // function parameter reaches this walk as. Not being import-backed is what
    // makes the MemberOf callee a data-method call rather than a wrapper.
    const listValue: InferredType = {
      kind: "Function",
      returns: [
        {
          kind: "ReturnTypeOf",
          callee: { kind: "MemberOf", obj: { kind: "TypeOf", ref: { ...dummyRef, symbol: "items" } }, member: "map" },
          args: [{ kind: "Function", returns: [{ kind: "JSX" }] }],
        },
      ],
    };
    // Walking `TypeOf(List)` (List's declared value, once resolved) exercises
    // walkWithFolding's "Function" case, which lets a nested ReturnTypeOf or
    // MemberOf inside a component's own returns reach this walk's
    // opaque-callee handling.
    const result = walkWithFolding(graph, fileGraph, listValue, argMap);
    expect(result).toEqual([{ denotation: { kind: "element" }, viaTrail: [], identity: null }]);
  });

  it("Sentry.withProfiler(Foo): an import-backed MemberOf callee still folds with a hoc-wrapper hop (the opaque-wrapper fold still applies)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({ specifier: "@sentry/react", imported: "*", local: "Sentry", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "MemberOf", obj: { kind: "TypeOf", ref: { ...dummyRef, symbol: "Sentry" } }, member: "withProfiler" },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "Foo" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, argMap);
    expect(result).toHaveLength(1);
    expect(result[0]?.denotation).toEqual({ kind: "element" });
    expect(result[0]?.identity).toEqual({ kind: "local", filePath: "a.tsx", export: "Foo", declaration: expect.objectContaining({ symbol: "Foo" }) });
    expect(result[0]?.viaTrail).toHaveLength(1);
    expect(result[0]?.viaTrail[0]?.kind).toBe("hoc-wrapper");
    if (result[0]?.viaTrail[0]?.kind === "hoc-wrapper") {
      expect(result[0].viaTrail[0].hocCallee).toBe("withProfiler");
    }
  });
});

describe("walkWithFolding: a component's return keeps the component as identity fallback", () => {
  it("a JSX-value alias returned directly (`const priceElement = <.../>; return priceElement;`) folds to a JSX terminal with identity null, not the alias", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "priceElement",
      value: { kind: "JSX" },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    // OfferPrice = () => { const priceElement = <.../>; return priceElement; }
    const offerPriceValue: InferredType = {
      kind: "Function",
      returns: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "priceElement" } }],
    };
    const result = walkWithFolding(graph, fileGraph, offerPriceValue, argMap);
    expect(result).toEqual([{ denotation: { kind: "element" }, viaTrail: [], identity: null }]);
  });

  it("a hook-return leaf returned directly (`const { modals } = useX(); return modals;`) folds to a JSX terminal with identity null, not a same-file binding", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "useX",
      value: { kind: "Function", returns: [{ kind: "Object", props: { modals: { kind: "JSX" } } }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    // `const { modals } = useX();` lowers to a `modals` BindingDecl valued
    // MemberOf(ReturnTypeOf(useX), "modals"), and `return modals;` is a plain
    // TypeOf reference to that decl. That extra hop would mint a spurious
    // `modals` local identity if `foldTerminals` fell back to the return
    // expression rather than the enclosing component. A bare inline MemberOf
    // return never reaches `deriveIdentity`'s TypeOf/DynamicImport cases, so
    // this test needs the local variable.
    fb.addDeclaration({
      symbol: "modals",
      value: {
        kind: "MemberOf",
        obj: { kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "useX" } }, args: [] },
        member: "modals",
      },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    // Comp = () => { const { modals } = useX(); return modals; }
    const compValue: InferredType = {
      kind: "Function",
      returns: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "modals" } }],
    };
    const result = walkWithFolding(graph, fileGraph, compValue, argMap);
    expect(result).toEqual([{ denotation: { kind: "element" }, viaTrail: [], identity: null }]);
  });

  it("a Union return attributes each branch to its own binding, not the enclosing component", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({ symbol: "A", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "B", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 2, column: 1 }, isExported: false });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    // Comp = () => (cond ? <A/> : <B/>), lowered to a Union of the two refs.
    const compValue: InferredType = {
      kind: "Function",
      returns: [
        {
          kind: "Union",
          types: [
            { kind: "TypeOf", ref: { ...dummyRef, symbol: "A" } },
            { kind: "TypeOf", ref: { ...dummyRef, symbol: "B" } },
          ],
        },
      ],
    };
    const result = walkWithFolding(graph, fileGraph, compValue, argMap);
    expect(result).toHaveLength(2);
    const aTerminal = result.find((r) => r.identity?.kind === "local" && r.identity.export === "A");
    const bTerminal = result.find((r) => r.identity?.kind === "local" && r.identity.export === "B");
    expect(aTerminal).toBeDefined();
    expect(bTerminal).toBeDefined();
  });
});

describe("walkWithFolding: an empty inner walk credits nothing", () => {
  // An inner walk that produces no branch at all must stay empty inside the
  // walk. `walkTypeOf`'s `inner.every(...)` is vacuously true on an empty
  // list, so no identity is stamped on it and `foldToWrappedArg`'s rescue
  // finds nothing to synthesise from. Substituting a placeholder terminal
  // for `[]` makes `every` false, stamps the reference's own identity, and
  // the rescue turns it into a credit for a value the walk learned nothing
  // about. One pin per shape whose walk bottoms out empty.
  const emptyWalkPin = (value: InferredType, mapDecls?: (fb: ReturnType<ReturnType<typeof createGraphBuilder>["beginFile"]>) => void) => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    // Opaque, import-backed HOC: the algebra cannot see through it, so the
    // walk takes the HOC fallback over its last argument.
    fb.addImport({
      specifier: "external-pkg",
      imported: "hoc",
      local: "hoc",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    mapDecls?.(fb);
    fb.addDeclaration({ symbol: "X", value, loc: { line: 5, column: 7 }, isExported: false });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "hoc" } },
      args: [{ kind: "TypeOf", ref: { ...dummyRef, symbol: "X" } }],
    };
    const result = walkWithFolding(graph, fileGraph, t, createArgumentMap());
    expect(creditedTerminals(result)).toEqual([]);
    expect(result.map((r) => r.identity)).toEqual(result.map(() => null));
    expect(result.flatMap((r) => r.viaTrail).filter((v) => v.kind === "hoc-wrapper")).toEqual([]);
  };

  it("a function with no return statement", () => {
    emptyWalkPin({ kind: "Function", returns: [] });
  });

  it("a union of no branches", () => {
    emptyWalkPin({ kind: "Union", types: [] });
  });

  it("a dynamic member over an array of no elements", () => {
    emptyWalkPin({ kind: "MemberOf", obj: { kind: "TypeOf", ref: { ...dummyRef, symbol: "ARR" } }, member: DYNAMIC_MEMBER_KEY }, (fb) => {
      fb.addDeclaration({ symbol: "ARR", value: { kind: "Array", elements: [] }, loc: { line: 2, column: 7 }, isExported: false });
    });
  });

  it("a dynamic member over an object of no props", () => {
    emptyWalkPin({ kind: "MemberOf", obj: { kind: "TypeOf", ref: { ...dummyRef, symbol: "MAP" } }, member: DYNAMIC_MEMBER_KEY }, (fb) => {
      fb.addDeclaration({ symbol: "MAP", value: { kind: "Object", props: {} }, loc: { line: 2, column: 7 }, isExported: false });
    });
  });

  it("a dynamic member over an object whose props all walk to nothing", () => {
    emptyWalkPin({ kind: "MemberOf", obj: { kind: "TypeOf", ref: { ...dummyRef, symbol: "MAP" } }, member: DYNAMIC_MEMBER_KEY }, (fb) => {
      fb.addDeclaration({
        symbol: "MAP",
        value: { kind: "Object", props: { a: { kind: "Unknown" }, b: { kind: "Unknown" } } },
        loc: { line: 2, column: 7 },
        isExported: false,
      });
    });
  });
});
