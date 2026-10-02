import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type Graph, type Reference } from "../../src/index.js";
import { buildHelperCallers } from "../../src/engine/helper-callers.js";
import { buildComponentRegistry, excludeHostElementNames } from "../../src/engine/registry.js";
import { resolveOwnerChain } from "../../src/engine/owner-resolution.js";
import { createCycleGuard } from "../../src/engine/cycle-detection.js";

/** The roster view owner classification consults. */
const rosterOf = (graph: Graph) => excludeHostElementNames(buildComponentRegistry(graph), graph);

function refOf(symbol: string, originFile: string): Reference {
  return { symbol, scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile };
}

describe("resolveOwnerChain", () => {
  it("returns the declaration as owner when it's a component", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/View.tsx");
    fb.addDeclaration({
      symbol: "View",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: true,
    });
    fb.addExport({ kind: "named", exportedAs: "View", local: "View" });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const results = resolveOwnerChain(refOf("View", "src/View.tsx"), graph, idx, createCycleGuard());
    expect(results).toHaveLength(1);
    expect(results[0]?.viaPrefix).toEqual([]);
    expect(results[0]?.ownerDecl?.symbol).toBe("View");
    expect(results[0]?.ownerDecl?.file).toBe("src/View.tsx");
  });

  it("returns null owner when symbol has no declaration", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("src/View.tsx");
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const results = resolveOwnerChain(refOf("Missing", "src/View.tsx"), graph, idx, createCycleGuard());
    expect(results).toHaveLength(1);
    expect(results[0]?.ownerDecl).toBeUndefined();
    expect(results[0]?.viaPrefix).toEqual([]);
  });

  it("fans out one result per component caller of a helper", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/app.tsx");
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
              callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/app.tsx" } },
              args: [],
            },
            { kind: "JSX" },
          ],
        },
        loc: { line: 5, column: 1 },
        isExported: true,
      });
      fb.addExport({ kind: "named", exportedAs: name, local: name });
    }
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const results = resolveOwnerChain(refOf("getRows", "src/app.tsx"), graph, idx, createCycleGuard());
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.ownerDecl?.symbol).sort()).toEqual(["ViewA", "ViewB"]);
    for (const r of results) {
      expect(r.viaPrefix).toEqual([{ kind: "helper-call", callee: "getRows", calleeFile: "src/app.tsx" }]);
    }
  });

  it("returns single null-owner result for orphan helper", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/orphan.tsx");
    fb.addDeclaration({
      symbol: "buildRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const results = resolveOwnerChain(refOf("buildRows", "src/orphan.tsx"), graph, idx, createCycleGuard());
    expect(results).toHaveLength(1);
    expect(results[0]?.ownerDecl).toBeUndefined();
    expect(results[0]?.viaPrefix).toEqual([{ kind: "helper-call", callee: "buildRows", calleeFile: "src/orphan.tsx" }]);
  });

  it("chains helper hops when component sits above multiple helper layers", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/chain.tsx");
    // helperC is a helper returning Array<JSX>
    fb.addDeclaration({
      symbol: "helperC",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    // helperB returns helperC()
    fb.addDeclaration({
      symbol: "helperB",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "ReturnTypeOf",
            callee: { kind: "TypeOf", ref: { symbol: "helperC", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/chain.tsx" } },
            args: [],
          },
        ],
      },
      loc: { line: 5, column: 1 },
      isExported: false,
    });
    // helperA returns helperB()
    fb.addDeclaration({
      symbol: "helperA",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "ReturnTypeOf",
            callee: { kind: "TypeOf", ref: { symbol: "helperB", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/chain.tsx" } },
            args: [],
          },
        ],
      },
      loc: { line: 9, column: 1 },
      isExported: false,
    });
    // View returns JSX + calls helperA
    fb.addDeclaration({
      symbol: "View",
      value: {
        kind: "Function",
        returns: [
          {
            kind: "ReturnTypeOf",
            callee: { kind: "TypeOf", ref: { symbol: "helperA", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/chain.tsx" } },
            args: [],
          },
          { kind: "JSX" },
        ],
      },
      loc: { line: 13, column: 1 },
      isExported: true,
    });
    fb.addExport({ kind: "named", exportedAs: "View", local: "View" });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const results = resolveOwnerChain(refOf("helperC", "src/chain.tsx"), graph, idx, createCycleGuard());
    expect(results).toHaveLength(1);
    expect(results[0]?.ownerDecl?.symbol).toBe("View");
    expect(results[0]?.viaPrefix.map((v) => v.kind === "helper-call" ? v.callee : v.kind)).toEqual(["helperC", "helperB", "helperA"]);
  });

  it("returns empty-prefix no-owner when ownerRef is null", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("src/empty.tsx");
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const results = resolveOwnerChain(null, graph, idx, createCycleGuard());
    expect(results).toEqual([{ viaPrefix: [] }]);
  });

  it("returns empty-prefix no-owner when ref has no originFile", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("src/View.tsx");
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const refNoOrigin: Reference = { symbol: "View", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 } };
    const results = resolveOwnerChain(refNoOrigin, graph, idx, createCycleGuard());
    expect(results).toEqual([{ viaPrefix: [] }]);
  });
});

describe("resolveOwnerChain: owners are registry members", () => {
  const JSX = { kind: "JSX" } as const;
  const wrapperOf = (inner: string, file: string) => ({
    kind: "Function" as const,
    returns: [
      {
        kind: "ReturnTypeOf" as const,
        callee: { kind: "TypeOf" as const, ref: { symbol: "withHoc", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: file } },
        args: [{ kind: "TypeOf" as const, ref: { symbol: inner, scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: file } }],
      },
    ],
  });

  it("a component held by a wrapper owns its own JSX; the wrapper is a route, not the owner", () => {
    // const DeviceView = () => <div/>; const Device = () => withHoc(DeviceView); <Device/>
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Device.tsx");
    fb.addDeclaration({ symbol: "withHoc", value: { kind: "Function", returns: [JSX] }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "DeviceView", value: { kind: "Function", returns: [JSX] }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "Device", value: wrapperOf("DeviceView", "src/Device.tsx"), loc: { line: 1, column: 1 }, isExported: false });
    fb.addHeldRef({ symbol: "DeviceView", memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/Device.tsx" });
    fb.addJsxUsage({ ref: { symbol: "Device", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 } }, loc: { line: 1, column: 1 }, props: [] });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const results = resolveOwnerChain(refOf("DeviceView", "src/Device.tsx"), graph, idx, createCycleGuard());
    expect(results).toEqual([{ ownerDecl: { file: "src/Device.tsx", symbol: "DeviceView" }, viaPrefix: [] }]);
  });

  it("a JSX-returning declaration nothing consumes is a helper with no callers: no owner, one helper-call hop", () => {
    // const Inner = () => <div/>; const X = () => withHoc(Inner); (neither held, referenced nor exported)
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/X.tsx");
    fb.addDeclaration({ symbol: "withHoc", value: { kind: "Function", returns: [JSX] }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "Inner", value: { kind: "Function", returns: [JSX] }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "X", value: wrapperOf("Inner", "src/X.tsx"), loc: { line: 1, column: 1 }, isExported: false });
    const graph = gb.build();
    const idx = buildHelperCallers(graph, rosterOf(graph));
    const results = resolveOwnerChain(refOf("Inner", "src/X.tsx"), graph, idx, createCycleGuard());
    expect(results.every((r) => r.ownerDecl === undefined)).toBe(true);
    expect(results[0]?.viaPrefix[0]).toEqual({ kind: "helper-call", callee: "Inner", calleeFile: "src/X.tsx" });
  });
});
