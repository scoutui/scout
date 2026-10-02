import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type Graph, type InferredType } from "../../src/index.js";
import { classifyDeclaration, buildHelperCallers } from "../../src/engine/helper-callers.js";
import { buildComponentRegistry, excludeHostElementNames } from "../../src/engine/registry.js";

const JSX: InferredType = { kind: "JSX" };
const fn = (...returns: InferredType[]): InferredType => ({ kind: "Function", returns });
const at = (line: number) => ({ line, column: 1 });

/** The roster view owner classification consults: the registry after
 *  the host-element narrowing, exactly what `resolve()` hands `buildHelperCallers`. */
const rosterOf = (graph: Graph) => excludeHostElementNames(buildComponentRegistry(graph), graph);

/** Declare `symbol` with `value` in one file, consume it as asked, and classify it. */
function classifyOne(symbol: string, value: InferredType, opts: { exported?: boolean; held?: boolean; jsx?: boolean } = {}) {
  const gb = createGraphBuilder({ moduleResolver: () => null });
  const fb = gb.beginFile("src/F.tsx");
  fb.addDeclaration({ symbol, value, loc: at(1), isExported: opts.exported ?? false });
  if (opts.exported) fb.addExport({ kind: "named", exportedAs: symbol, local: symbol });
  if (opts.held) fb.addHeldRef({ symbol, memberChain: [], loc: at(2), originFile: "src/F.tsx" });
  if (opts.jsx) fb.addJsxUsage({ ref: { symbol, scope: MODULE_SCOPE, memberChain: [], loc: at(2), originFile: "src/F.tsx" }, loc: at(2), props: [] });
  const graph = gb.build();
  const decl = graph.files.get("src/F.tsx")?.declarations.get(`${MODULE_SCOPE}::${symbol}`);
  if (!decl) throw new Error(`no declaration ${symbol}`);
  return classifyDeclaration(decl, rosterOf(graph), graph.files.get("src/F.tsx")!);
}

describe("classifyDeclaration: owners are registry members", () => {
  it("an exported component-shaped Function is a component", () => {
    expect(classifyOne("F", fn(JSX), { exported: true })).toBe("component");
  });

  it("a held component-shaped Function is a component, with no JSX consumer at all", () => {
    expect(classifyOne("F", fn(JSX), { held: true })).toBe("component");
  });

  it("a JSX-referenced component-shaped Function is a component", () => {
    expect(classifyOne("F", fn(JSX), { jsx: true })).toBe("component");
  });

  it("a component-shaped Function nothing consumes is a helper", () => {
    expect(classifyOne("F", fn(JSX))).toBe("helper");
  });

  it("an exported Function that is not component-shaped (returns Object containing JSX) is a helper", () => {
    expect(classifyOne("F", fn({ kind: "Object", props: { cta: JSX } }), { exported: true })).toBe("helper");
  });

  it("an exported Function returning Array of JSX is a helper", () => {
    expect(classifyOne("F", fn({ kind: "Array", elements: [JSX] }), { exported: true })).toBe("helper");
  });

  it("an exported Function with Union<JSX, null> return is a component", () => {
    expect(classifyOne("F", fn({ kind: "Union", types: [JSX, { kind: "Unknown" }] }), { exported: true })).toBe("component");
  });

  it("an exported factory (Function returning Function returning JSX) is a helper: no recursion into a nested Function return", () => {
    expect(classifyOne("F", fn(fn(JSX)), { exported: true })).toBe("helper");
  });

  it("a non-Function value is unknown, member or not", () => {
    expect(classifyOne("F", JSX, { exported: true })).toBe("unknown");
    expect(classifyOne("F", JSX)).toBe("unknown");
  });

  it("a lowercase-named member is a helper for ownership: the roster view excludes host-element names", () => {
    expect(classifyOne("renderRow", fn(JSX), { exported: true })).toBe("helper");
  });

  it("follows TypeOf refs across files: an exported Function returning a JSX-valued binding elsewhere is a component", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fbA = gb.beginFile("src/A.tsx");
    fbA.addDeclaration({ symbol: "Comp", value: JSX, loc: at(1), isExported: false });
    const fbB = gb.beginFile("src/B.tsx");
    fbB.addDeclaration({
      symbol: "Helper",
      value: fn({ kind: "TypeOf", ref: { symbol: "Comp", scope: MODULE_SCOPE, memberChain: [], loc: at(1), originFile: "src/A.tsx" } }),
      loc: at(1),
      isExported: true,
    });
    fbB.addExport({ kind: "named", exportedAs: "Helper", local: "Helper" });
    const graph = gb.build();
    const helperDecl = graph.files.get("src/B.tsx")!.declarations.get(`${MODULE_SCOPE}::Helper`)!;
    expect(classifyDeclaration(helperDecl, rosterOf(graph), graph.files.get("src/B.tsx")!)).toBe("component");
  });

  it("follows multi-hop cross-file TypeOf chains", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fbC = gb.beginFile("src/C.tsx");
    fbC.addDeclaration({ symbol: "Leaf", value: JSX, loc: at(1), isExported: false });
    const fbA = gb.beginFile("src/A.tsx");
    fbA.addDeclaration({
      symbol: "Bridge",
      value: { kind: "TypeOf", ref: { symbol: "Leaf", scope: MODULE_SCOPE, memberChain: [], loc: at(1), originFile: "src/C.tsx" } },
      loc: at(1),
      isExported: false,
    });
    const fbB = gb.beginFile("src/B.tsx");
    fbB.addDeclaration({
      symbol: "Helper",
      value: fn({ kind: "TypeOf", ref: { symbol: "Bridge", scope: MODULE_SCOPE, memberChain: [], loc: at(1), originFile: "src/A.tsx" } }),
      loc: at(1),
      isExported: true,
    });
    fbB.addExport({ kind: "named", exportedAs: "Helper", local: "Helper" });
    const graph = gb.build();
    const helperDecl = graph.files.get("src/B.tsx")!.declarations.get(`${MODULE_SCOPE}::Helper`)!;
    expect(classifyDeclaration(helperDecl, rosterOf(graph), graph.files.get("src/B.tsx")!)).toBe("component");
  });

  it("an exported factory product (ReturnTypeOf over a resolvable factory) is a component", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/A.tsx");
    fb.addDeclaration({ symbol: "withLoading", value: fn(fn(JSX)), loc: at(1), isExported: false });
    fb.addDeclaration({ symbol: "View", value: fn(JSX), loc: at(2), isExported: false });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: { symbol: "withLoading", scope: MODULE_SCOPE, memberChain: [], loc: at(3) } }, args: [{ kind: "TypeOf", ref: { symbol: "View", scope: MODULE_SCOPE, memberChain: [], loc: at(3) } }] },
      loc: at(3),
      isExported: true,
    });
    fb.addExport({ kind: "named", exportedAs: "Foo", local: "Foo" });
    const graph = gb.build();
    const foo = graph.files.get("src/A.tsx")!.declarations.get(`${MODULE_SCOPE}::Foo`)!;
    expect(classifyDeclaration(foo, rosterOf(graph), graph.files.get("src/A.tsx")!)).toBe("component");
  });

  it("a ReturnTypeOf that is not component-shaped (rows = getRows()) is a helper", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/A.tsx");
    fb.addDeclaration({ symbol: "getRows", value: fn({ kind: "Array", elements: [] }), loc: at(1), isExported: false });
    fb.addDeclaration({
      symbol: "rows",
      value: { kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: at(2) } }, args: [] },
      loc: at(2),
      isExported: true,
    });
    fb.addExport({ kind: "named", exportedAs: "rows", local: "rows" });
    const graph = gb.build();
    const rows = graph.files.get("src/A.tsx")!.declarations.get(`${MODULE_SCOPE}::rows`)!;
    expect(classifyDeclaration(rows, rosterOf(graph), graph.files.get("src/A.tsx")!)).toBe("helper");
  });
});

describe("buildHelperCallers", () => {
  it("indexes a same-file helper called by one component", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "View",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "ReturnTypeOf",
            callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/App.tsx" } },
            args: [],
          },
          { kind: "JSX" },
        ],
      },
      loc: { line: 5, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/App.tsx", symbol: "getRows" });
    expect(callers).toBeDefined();
    expect([...callers!]).toEqual([{ file: "src/App.tsx", symbol: "View" }]);
  });

  it("returns undefined for a helper with no callers", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({
      symbol: "buildRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    expect(idx.get({ file: "src/App.tsx", symbol: "buildRows" })).toBeUndefined();
  });

  it("indexes a cross-file helper", () => {
    const moduleResolver = (from: string, spec: string) => {
      if (spec === "./helper") return "src/helper.tsx";
      return null;
    };
    const gb = createGraphBuilder({ moduleResolver });
    const fbHelper = gb.beginFile("src/helper.tsx");
    fbHelper.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: true,
    });
    fbHelper.addExport({ kind: "named", exportedAs: "getRows", local: "getRows" });

    const fbView = gb.beginFile("src/view.tsx");
    fbView.addImport({ specifier: "./helper", imported: "getRows", local: "getRows", loc: { line: 1, column: 1 } });
    fbView.addDeclaration({
      symbol: "View",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "ReturnTypeOf",
            callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/view.tsx" } },
            args: [],
          },
          { kind: "JSX" },
        ],
      },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/helper.tsx", symbol: "getRows" });
    expect(callers).toBeDefined();
    expect([...callers!]).toEqual([{ file: "src/view.tsx", symbol: "View" }]);
  });

  it("indexes a helper exported through a re-export barrel", () => {
    const moduleResolver = (from: string, spec: string) => {
      if (spec === "./helpers") return "src/helpers/index.tsx";
      if (spec === "./getRows") return "src/helpers/getRows.tsx";
      return null;
    };
    const gb = createGraphBuilder({ moduleResolver });
    // Canonical source: helpers/getRows.tsx defines + exports getRows.
    const fbSource = gb.beginFile("src/helpers/getRows.tsx");
    fbSource.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: true,
    });
    fbSource.addExport({ kind: "named", exportedAs: "getRows", local: "getRows" });

    // Barrel: helpers/index.tsx re-exports getRows from ./getRows.
    const fbBarrel = gb.beginFile("src/helpers/index.tsx");
    fbBarrel.addExport({ kind: "named", exportedAs: "getRows", from: "./getRows", fromImported: "getRows" });

    // Consumer imports through the barrel.
    const fbView = gb.beginFile("src/view.tsx");
    fbView.addImport({ specifier: "./helpers", imported: "getRows", local: "getRows", loc: { line: 1, column: 1 } });
    fbView.addDeclaration({
      symbol: "View",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "ReturnTypeOf",
            callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/view.tsx" } },
            args: [],
          },
          { kind: "JSX" },
        ],
      },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/helpers/getRows.tsx", symbol: "getRows" });
    expect(callers).toBeDefined();
    expect([...callers!]).toEqual([{ file: "src/view.tsx", symbol: "View" }]);
  });

  it("indexes the same helper called by two different components in the same file", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    for (const name of ["ViewA", "ViewB"]) {
      fb.addDeclaration({
        symbol: name,
        value: {
          kind: "Function",
          returns: [
            {
              kind: "ReturnTypeOf",
              callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/App.tsx" } },
              args: [],
            },
            { kind: "JSX" },
          ],
        },
        loc: { line: 5, column: 1 },
        isExported: false,
      });
    }
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/App.tsx", symbol: "getRows" });
    expect(callers).toBeDefined();
    const callerSymbols = [...callers!].map((c) => c.symbol).sort();
    expect(callerSymbols).toEqual(["ViewA", "ViewB"]);
  });

  it("indexes the same helper called by callers in two different files", () => {
    const moduleResolver = (from: string, spec: string) => {
      if (spec === "./helper") return "src/helper.tsx";
      return null;
    };
    const gb = createGraphBuilder({ moduleResolver });
    const fbHelper = gb.beginFile("src/helper.tsx");
    fbHelper.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: true,
    });
    fbHelper.addExport({ kind: "named", exportedAs: "getRows", local: "getRows" });
    for (const consumerFile of ["src/viewA.tsx", "src/viewB.tsx"]) {
      const fb = gb.beginFile(consumerFile);
      fb.addImport({ specifier: "./helper", imported: "getRows", local: "getRows", loc: { line: 1, column: 1 } });
      const componentName = consumerFile.includes("viewA") ? "ViewA" : "ViewB";
      fb.addDeclaration({
        symbol: componentName,
        value: {
          kind: "Function",
          returns: [
            {
              kind: "ReturnTypeOf",
              callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: consumerFile } },
              args: [],
            },
            { kind: "JSX" },
          ],
        },
        loc: { line: 3, column: 1 },
        isExported: false,
      });
    }
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/helper.tsx", symbol: "getRows" });
    expect(callers).toBeDefined();
    const callerKeys = [...callers!].map((c) => `${c.file}::${c.symbol}`).sort();
    expect(callerKeys).toEqual(["src/viewA.tsx::ViewA", "src/viewB.tsx::ViewB"]);
  });

  it("indexes a helper consumed via JSX (`<Helper/>` call site)", () => {
    // Page renders <List/> via JSX. List returns Array<JSX>, so it is a
    // helper, and a JSX render counts as a call alongside return-type refs
    // and bodyCalls.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({
      symbol: "List",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "Page",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 5, column: 1 },
      isExported: false,
    });
    // <List/> rendered inside Page's body.
    fb.addJsxUsage({
      ref: { symbol: "List", scope: MODULE_SCOPE, memberChain: [], loc: { line: 6, column: 10 }, originFile: "src/App.tsx" },
      loc: { line: 6, column: 10 },
      props: [],
    });
    fb.setOwner({ symbol: "Page", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 1 }, originFile: "src/App.tsx" });

    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/App.tsx", symbol: "List" });
    expect(callers).toBeDefined();
    expect([...callers!]).toEqual([{ file: "src/App.tsx", symbol: "Page" }]);
  });

  it("indexes a cross-file helper consumed via JSX", () => {
    const moduleResolver = (_from: string, spec: string) => {
      if (spec === "./List") return "src/List.tsx";
      return null;
    };
    const gb = createGraphBuilder({ moduleResolver });
    const fbList = gb.beginFile("src/List.tsx");
    fbList.addDeclaration({
      symbol: "List",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: true,
    });
    fbList.addExport({ kind: "named", exportedAs: "List", local: "List" });

    const fbPage = gb.beginFile("src/Page.tsx");
    fbPage.addImport({ specifier: "./List", imported: "List", local: "List", loc: { line: 1, column: 1 } });
    fbPage.addDeclaration({
      symbol: "Page",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    fbPage.addJsxUsage({
      ref: { symbol: "List", scope: MODULE_SCOPE, memberChain: [], loc: { line: 4, column: 10 }, originFile: "src/Page.tsx" },
      loc: { line: 4, column: 10 },
      props: [],
    });
    fbPage.setOwner({ symbol: "Page", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 }, originFile: "src/Page.tsx" });

    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/List.tsx", symbol: "List" });
    expect(callers).toBeDefined();
    expect([...callers!]).toEqual([{ file: "src/Page.tsx", symbol: "Page" }]);
  });

  it("dedupes when a helper is consumed via both `helper()` body call and `<Helper/>` JSX", () => {
    // A caller that invokes the helper via both paths appears once.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({
      symbol: "List",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "Page",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 5, column: 1 },
      isExported: false,
    });
    fb.addBodyCall({
      ownerSymbol: "Page",
      callee: { symbol: "List", memberChain: [], loc: { line: 6, column: 14 }, originFile: "src/App.tsx" },
    });
    fb.addJsxUsage({
      ref: { symbol: "List", scope: MODULE_SCOPE, memberChain: [], loc: { line: 7, column: 10 }, originFile: "src/App.tsx" },
      loc: { line: 7, column: 10 },
      props: [],
    });
    fb.setOwner({ symbol: "Page", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 1 }, originFile: "src/App.tsx" });

    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/App.tsx", symbol: "List" });
    expect(callers).toBeDefined();
    expect([...callers!]).toHaveLength(1);
    expect([...callers!][0]).toEqual({ file: "src/App.tsx", symbol: "Page" });
  });

  it("does not double-record when the same callee appears in both return-type and bodyCalls", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "View",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "ReturnTypeOf",
            callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/App.tsx" } },
            args: [],
          },
          { kind: "JSX" },
        ],
      },
      loc: { line: 5, column: 1 },
      isExported: false,
    });
    // Also add bodyCalls entry for the same callee.
    fb.addBodyCall({
      ownerSymbol: "View",
      callee: { symbol: "getRows", memberChain: [], loc: { line: 6, column: 14 }, originFile: "src/App.tsx" },
    });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const callers = idx.get({ file: "src/App.tsx", symbol: "getRows" });
    expect(callers).toBeDefined();
    // Deduplication: View should appear exactly once.
    expect([...callers!]).toHaveLength(1);
    expect([...callers!][0]).toEqual({ file: "src/App.tsx", symbol: "View" });
  });

  it("indexes a factory's product declaration as a caller of the factory", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/A.tsx");
    fb.addDeclaration({ symbol: "withLoading", value: { kind: "Function", returns: [{ kind: "Function", returns: [{ kind: "JSX" }] }] }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "FooView", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 2, column: 1 }, isExported: false });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: { symbol: "withLoading", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 } } }, args: [{ kind: "TypeOf", ref: { symbol: "FooView", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 } } }] },
      loc: { line: 3, column: 1 },
      isExported: true,
    });
    // The parser records the argument as a held reference.
    fb.addHeldRef({ symbol: "FooView", memberChain: [], loc: { line: 3, column: 1 }, originFile: "src/A.tsx" });
    const graph = gb.build();
    const index = buildHelperCallers(graph, rosterOf(graph));
    const callers = index.get({ file: "src/A.tsx", symbol: "withLoading" });
    expect(callers).toBeDefined();
    expect([...callers!].map((c) => c.symbol)).toEqual(["Foo"]);
    // The held argument is a member, so FooView stays a component.
    expect(index.classification("src/A.tsx", "FooView")).toBe("component");
  });
});

describe("buildHelperCallers: classification is membership", () => {
  it("a JSX-returning function held by a wrapper is a component, not a helper of the wrapper", () => {
    // const DeviceView = () => <div/>; const Device = () => withHoc(DeviceView); <Device/>
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Device.tsx");
    fb.addDeclaration({ symbol: "withHoc", value: fn(JSX), loc: at(1), isExported: false });
    fb.addDeclaration({ symbol: "DeviceView", value: fn(JSX), loc: at(2), isExported: false });
    fb.addDeclaration({
      symbol: "Device",
      value: fn({
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { symbol: "withHoc", scope: MODULE_SCOPE, memberChain: [], loc: at(3), originFile: "src/Device.tsx" } },
        args: [{ kind: "TypeOf", ref: { symbol: "DeviceView", scope: MODULE_SCOPE, memberChain: [], loc: at(3), originFile: "src/Device.tsx" } }],
      }),
      loc: at(3),
      isExported: false,
    });
    fb.addHeldRef({ symbol: "DeviceView", memberChain: [], loc: at(3), originFile: "src/Device.tsx" });
    fb.addJsxUsage({ ref: { symbol: "Device", scope: MODULE_SCOPE, memberChain: [], loc: at(4) }, loc: at(4), props: [] });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    expect(idx.classification("src/Device.tsx", "DeviceView")).toBe("component");
    expect(idx.classification("src/Device.tsx", "Device")).toBe("component");
    expect(idx.get({ file: "src/Device.tsx", symbol: "DeviceView" })).toBeUndefined();
  });

  it("a JSX-referenced function is a component", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/View.tsx");
    fb.addDeclaration({ symbol: "DeviceView", value: fn(JSX), loc: at(1), isExported: false });
    fb.addJsxUsage({ ref: { symbol: "DeviceView", scope: MODULE_SCOPE, memberChain: [], loc: at(2) }, loc: at(2), props: [] });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    expect(idx.classification("src/View.tsx", "DeviceView")).toBe("component");
  });

  it("a JSX-returning function nothing consumes is a helper", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Lonely.tsx");
    fb.addDeclaration({ symbol: "Lonely", value: fn(JSX), loc: at(1), isExported: false });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    expect(idx.classification("src/Lonely.tsx", "Lonely")).toBe("helper");
  });

  it("a lowercase JSX-returning function called as a value is a helper of its caller", () => {
    // const renderRow = () => <Row/>;
    // export function Panel() { return <div>{renderRow()}</div>; }
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Panel.tsx");
    fb.addDeclaration({ symbol: "renderRow", value: fn(JSX), loc: at(1), isExported: false });
    fb.addDeclaration({
      symbol: "Panel",
      value: fn({
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { symbol: "renderRow", scope: MODULE_SCOPE, memberChain: [], loc: at(2), originFile: "src/Panel.tsx" } },
        args: [],
      }),
      loc: at(2),
      isExported: true,
    });
    fb.addExport({ kind: "named", exportedAs: "Panel", local: "Panel" });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    expect(idx.classification("src/Panel.tsx", "renderRow")).toBe("helper");
    expect(idx.classification("src/Panel.tsx", "Panel")).toBe("component");
    const callers = idx.get({ file: "src/Panel.tsx", symbol: "renderRow" });
    expect([...(callers ?? [])]).toEqual([{ file: "src/Panel.tsx", symbol: "Panel" }]);
  });
});
