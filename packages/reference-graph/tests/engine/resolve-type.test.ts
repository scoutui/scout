import { describe, it, expect } from "vitest";
import {
  createGraphBuilder,
  MODULE_SCOPE,
  type InferredType,
  type Reference,
} from "../../src/index.js";
import { resolveType, DYNAMIC_MEMBER_KEY } from "../../src/engine/resolve-type.js";
import { createArgumentMap } from "../../src/engine/argument-map.js";

const dummyRef: Reference = {
  symbol: "X",
  scope: MODULE_SCOPE,
  memberChain: [],
  loc: { line: 1, column: 1 },
};

describe("resolveType: walks an InferredType to terminal identities", () => {
  it("returns terminal types (JSX, Str, Unknown) as singletons", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    expect(resolveType(graph, fileGraph, { kind: "JSX" }, argMap)).toEqual([{ type: { kind: "JSX" }, source: null }]);
    expect(resolveType(graph, fileGraph, { kind: "Unknown" }, argMap)).toEqual([{ type: { kind: "Unknown" }, source: null }]);
  });

  it("TypeOf forwards to the declaration's value (resolved recursively)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({ symbol: "X", value: { kind: "JSX" }, loc: { line: 1, column: 1 }, isExported: false });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const result = resolveType(graph, fileGraph, { kind: "TypeOf", ref: dummyRef }, argMap);
    expect(result).toEqual([{ type: { kind: "JSX" }, source: null }]);
  });

  it("Function returns its returns[]", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const result = resolveType(
      graph,
      fileGraph,
      { kind: "Function", returns: [{ kind: "JSX" }, { kind: "Str", value: "x" }] },
      argMap,
    );
    expect(result.map((r) => r.type.kind).sort()).toEqual(["JSX", "Str"]);
  });

  it("ReturnTypeOf resolves callee, returns its Function returns substituting args", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "id",
      value: { kind: "Function", returns: [{ kind: "ParameterOf", fn: { ...dummyRef, symbol: "id" }, index: 0 }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const t: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: { ...dummyRef, symbol: "id" } },
      args: [{ kind: "Str", value: "hello" }],
    };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result).toEqual([{ type: { kind: "Str", value: "hello" }, source: null }]);
  });

  it("MemberOf on Object literal selects the named key", () => {
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
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result).toEqual([{ type: { kind: "JSX" }, source: null }]);
  });

  it("MemberOf with unknown member on Object becomes fanout over all values", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const t: InferredType = {
      kind: "MemberOf",
      obj: { kind: "Object", props: { a: { kind: "JSX" }, b: { kind: "Str", value: "x" } } },
      member: DYNAMIC_MEMBER_KEY,
    };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result.map((r) => r.type.kind).sort()).toEqual(["JSX", "Str"]);
  });

  it("TypeOf to a Union fans out (no Union leak through TypeOf)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addDeclaration({
      symbol: "U",
      value: { kind: "Union", types: [{ kind: "JSX" }, { kind: "Str", value: "x" }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const result = resolveType(
      graph,
      fileGraph,
      { kind: "TypeOf", ref: { ...dummyRef, symbol: "U" } },
      argMap,
    );
    expect(result.map((r) => r.type.kind).sort()).toEqual(["JSX", "Str"]);
  });

  it("Union fans out", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const t: InferredType = {
      kind: "Union",
      types: [{ kind: "JSX" }, { kind: "Str", value: "x" }],
    };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result.map((r) => r.type.kind).sort()).toEqual(["JSX", "Str"]);
  });

  it("DynamicImport resolves to the target module's named export type", () => {
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => (spec === "./foo" ? "foo.tsx" : null),
    });

    // Source file with a DynamicImport.
    gb.beginFile("consumer.tsx");

    // Target module exporting `Button` as a JSX function.
    const targetFb = gb.beginFile("foo.tsx");
    targetFb.addDeclaration({
      symbol: "Button",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: true,
    });
    targetFb.addExport({ kind: "named", exportedAs: "Button", local: "Button" });

    const graph = gb.build();
    const fileGraph = graph.files.get("consumer.tsx")!;
    const argMap = createArgumentMap();

    const t: InferredType = {
      kind: "DynamicImport",
      specifier: "./foo",
      projection: ["Button"],
      originFile: "consumer.tsx",
    };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result).toEqual([{ type: { kind: "JSX" }, source: null }]);
  });

  it("DynamicImport with empty projection resolves to default export", () => {
    const gb = createGraphBuilder({
      moduleResolver: (from, spec) => (spec === "./foo" ? "foo.tsx" : null),
    });
    gb.beginFile("consumer.tsx");
    const targetFb = gb.beginFile("foo.tsx");
    targetFb.addDeclaration({
      symbol: "MyDefault",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: true,
    });
    targetFb.addExport({ kind: "default", local: "MyDefault" });

    const graph = gb.build();
    const fileGraph = graph.files.get("consumer.tsx")!;
    const argMap = createArgumentMap();

    const t: InferredType = {
      kind: "DynamicImport",
      specifier: "./foo",
      projection: [],
      originFile: "consumer.tsx",
    };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result).toEqual([{ type: { kind: "JSX" }, source: null }]);
  });

  it("DynamicImport with unresolvable specifier is preserved as a terminal", () => {
    // The specifier and projection are a valid identity source even though
    // the target isn't in the graph, so the leaf is preserved. The
    // "import-backed leaf preservation" block below covers the other cases.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("consumer.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("consumer.tsx")!;
    const argMap = createArgumentMap();

    const t: InferredType = {
      kind: "DynamicImport",
      specifier: "./missing",
      projection: ["Button"],
      originFile: "consumer.tsx",
    };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result).toEqual([{ type: t, source: t }]);
  });

  it("DynamicImport through a barrel that re-exports from outside the graph is preserved as a terminal", () => {
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "./barrel" ? "barrel.tsx" : null),
    });
    gb.beginFile("consumer.tsx");
    gb.beginFile("barrel.tsx").addExport({ kind: "named", exportedAs: "Button", from: "@acme/ui", fromImported: "Button" });
    const graph = gb.build();
    const fileGraph = graph.files.get("consumer.tsx")!;

    const t: InferredType = {
      kind: "DynamicImport",
      specifier: "./barrel",
      projection: ["Button"],
      originFile: "consumer.tsx",
    };
    expect(resolveType(graph, fileGraph, t, createArgumentMap())).toEqual([{ type: t, source: t }]);
  });

  it("MemberOf{DYNAMIC_MEMBER_KEY} over Object sets source to the produced propValue", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const fooLeaf: InferredType = { kind: "JSX" };
    const barLeaf: InferredType = { kind: "Str", value: "bar" };
    const t: InferredType = {
      kind: "MemberOf",
      obj: { kind: "Object", props: { foo: fooLeaf, bar: barLeaf } },
      member: DYNAMIC_MEMBER_KEY,
    };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result.length).toBe(2);
    const fooTerminal = result.find((r) => r.type.kind === "JSX");
    const barTerminal = result.find((r) => r.type.kind === "Str");
    expect(fooTerminal?.source).toBe(fooLeaf); // reference equality
    expect(barTerminal?.source).toBe(barLeaf);
  });

  it("MemberOf over Array sets source to the produced element", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const el0: InferredType = { kind: "JSX" };
    const el1: InferredType = { kind: "Str", value: "one" };
    const t: InferredType = {
      kind: "MemberOf",
      obj: { kind: "Array", elements: [el0, el1] },
      member: "0", // any non-DYNAMIC_MEMBER_KEY value: Array fanout iterates regardless
    };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result.length).toBe(2);
    expect(result.find((r) => r.type.kind === "JSX")?.source).toBe(el0);
    expect(result.find((r) => r.type.kind === "Str")?.source).toBe(el1);
  });

  it("Union sets source to the produced member type", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    const m0: InferredType = { kind: "JSX" };
    const m1: InferredType = { kind: "Str", value: "alt" };
    const t: InferredType = { kind: "Union", types: [m0, m1] };
    const result = resolveType(graph, fileGraph, t, argMap);
    expect(result.length).toBe(2);
    expect(result.find((r) => r.type.kind === "JSX")?.source).toBe(m0);
    expect(result.find((r) => r.type.kind === "Str")?.source).toBe(m1);
  });

  it("nested fanout: innermost source wins", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();
    // Outer Union of two Members: outer wraps inner; inner is itself an
    // Object/dynamic-key access. Innermost propValue should be the source.
    const innerFoo: InferredType = { kind: "JSX" };
    const innerBar: InferredType = { kind: "Str", value: "bar" };
    const innerMember: InferredType = {
      kind: "MemberOf",
      obj: { kind: "Object", props: { foo: innerFoo, bar: innerBar } },
      member: DYNAMIC_MEMBER_KEY,
    };
    const outerAlt: InferredType = { kind: "JSX" };
    const t: InferredType = { kind: "Union", types: [innerMember, outerAlt] };
    const result = resolveType(graph, fileGraph, t, argMap);
    // 3 terminals: innerFoo (JSX), innerBar (Str), outerAlt (JSX)
    expect(result.length).toBe(3);
    // The two from innerMember should carry their propValue sources, not the Union member.
    const fromInnerMember = result.filter((r) => r.source === innerFoo || r.source === innerBar);
    expect(fromInnerMember.length).toBe(2);
    // outerAlt has no inner fanout, so its source is outerAlt (the Union member itself).
    const fromOuter = result.find((r) => r.source === outerAlt);
    expect(fromOuter).toBeDefined();
  });
});

describe("resolveType: cycle safety on self-referential value graphs", () => {
  it("terminates on a destructured IIFE whose return object references the destructure target", () => {
    // Real-world shape (a migration setup component):
    //   const { flatSteps } = (() => {
    //     const flatSteps = ...;
    //     return { flatSteps };
    //   })();
    // The outer declaration's value is MemberOf(ReturnTypeOf(iife), "flatSteps"),
    // and the returned object's `flatSteps` prop resolves back to the outer
    // declaration: a closed loop in the value graph.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    const flatRef: Reference = {
      symbol: "flatSteps",
      scope: MODULE_SCOPE,
      memberChain: [],
      loc: { line: 1, column: 1 },
    };
    fb.addDeclaration({
      symbol: "flatSteps",
      value: {
        kind: "MemberOf",
        obj: {
          kind: "ReturnTypeOf",
          callee: {
            kind: "Function",
            returns: [{ kind: "Object", props: { flatSteps: { kind: "TypeOf", ref: flatRef } } }],
          },
          args: [],
        },
        member: "flatSteps",
      },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    const result = resolveType(graph, fileGraph, { kind: "TypeOf", ref: flatRef }, argMap);
    expect(result).toEqual([{ type: { kind: "Unknown" }, source: null }]);
  });

  it("terminates on a directly self-recursive function (return f())", () => {
    // function f() { return f(); } is legal JS, and its static value graph is cyclic.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    const fRef: Reference = {
      symbol: "f",
      scope: MODULE_SCOPE,
      memberChain: [],
      loc: { line: 1, column: 1 },
    };
    fb.addDeclaration({
      symbol: "f",
      value: {
        kind: "Function",
        returns: [{ kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: fRef }, args: [] }],
      },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    const result = resolveType(
      graph,
      fileGraph,
      { kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: fRef }, args: [] },
      argMap,
    );
    expect(result).toEqual([{ type: { kind: "Unknown" }, source: null }]);
  });

  it("does not false-cut nested application of the same function (id(id(x)))", () => {
    // The same ParameterOf node repeats on one path under different argument
    // bindings: that's structural recursion on the args, not a cycle.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    const idRef: Reference = {
      symbol: "id",
      scope: MODULE_SCOPE,
      memberChain: [],
      loc: { line: 1, column: 1 },
    };
    fb.addDeclaration({
      symbol: "id",
      value: { kind: "Function", returns: [{ kind: "ParameterOf", fn: idRef, index: 0 }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const argMap = createArgumentMap();

    const inner: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: idRef },
      args: [{ kind: "Str", value: "hello" }],
    };
    const outer: InferredType = {
      kind: "ReturnTypeOf",
      callee: { kind: "TypeOf", ref: idRef },
      args: [inner],
    };
    const result = resolveType(graph, fileGraph, outer, argMap);
    expect(result).toEqual([{ type: { kind: "Str", value: "hello" }, source: null }]);
  });
});

describe("resolveType: import-backed leaf preservation", () => {
  const leafRef = (symbol: string): Reference => ({
    symbol,
    scope: MODULE_SCOPE,
    memberChain: [],
    loc: { line: 1, column: 1 },
  });

  it("unresolvable external import: TypeOf is preserved as an identity-bearing terminal", () => {
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
    const t: InferredType = { kind: "TypeOf", ref: leafRef("Button") };
    const result = resolveType(graph, fileGraph, t, createArgumentMap());
    expect(result).toEqual([{ type: t, source: t }]);
  });

  it("in-graph import target with no matching export (unparseable/CJS): TypeOf is preserved", () => {
    const gb = createGraphBuilder({ moduleResolver: (_from, spec) => (spec === "cjs-pkg" ? "cjs-pkg/index.js" : null) });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "cjs-pkg",
      imported: "Button",
      local: "Button",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    gb.beginFile("cjs-pkg/index.js"); // in graph, zero exports
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = { kind: "TypeOf", ref: leafRef("Button") };
    const result = resolveType(graph, fileGraph, t, createArgumentMap());
    expect(result).toEqual([{ type: t, source: t }]);
  });

  it("unresolvable ref with no import record still collapses to Unknown", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const result = resolveType(
      graph,
      fileGraph,
      { kind: "TypeOf", ref: leafRef("Nope") },
      createArgumentMap(),
    );
    expect(result).toEqual([{ type: { kind: "Unknown" }, source: null }]);
  });

  it("unresolvable DynamicImport specifier is preserved as a terminal", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const graph = gb.build();
    const fileGraph = graph.files.get("a.tsx")!;
    const t: InferredType = {
      kind: "DynamicImport",
      specifier: "external-pkg",
      projection: ["Button"],
      originFile: "a.tsx",
    };
    const result = resolveType(graph, fileGraph, t, createArgumentMap());
    expect(result).toEqual([{ type: t, source: t }]);
  });
});
