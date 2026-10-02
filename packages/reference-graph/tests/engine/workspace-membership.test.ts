import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type InferredType } from "../../src/index.js";
import { resolve as resolveGraph } from "../../src/engine/index.js";
import { exportOf } from "../helpers.js";
import { deriveIdentity, walkWithFolding } from "../../src/engine/wrapper-folding.js";
import { createArgumentMap } from "../../src/engine/argument-map.js";

/**
 * Build a graph with one consumer file importing `{ Button } from "@f/ui"`,
 * where the module resolves to a workspace-member file that is not in the
 * graph (an out-of-graph member, as in a single-app scan). The membership
 * branch fires only here.
 */
function buildOutOfGraphMemberGraph(resolvedTarget: string) {
  const gb = createGraphBuilder({
    moduleResolver: (_from, spec) => (spec === "@f/ui" ? resolvedTarget : null),
  });
  const fb = gb.beginFile("src/App.tsx");
  fb.addImport({
    specifier: "@f/ui",
    imported: "Button",
    local: "Button",
    scope: MODULE_SCOPE,
    loc: { line: 1, column: 0 },
  });
  fb.addJsxUsage({
    ref: { symbol: "Button", memberChain: [], loc: { line: 2, column: 2 } },
    loc: { line: 2, column: 2 },
    props: [],
  });
  return gb;
}

describe("resolve workspace membership branch", () => {
  const ENTRY = "/ws/packages/ui/src/index.ts";
  const DEF = "/ws/packages/ui/src/button.tsx";

  it("emits a local occurrence pinned to the definition file when membership + resolver callbacks are supplied", () => {
    const graph = buildOutOfGraphMemberGraph(ENTRY).build({
      firstParty: (p) => p.startsWith("/ws/packages/ui/"),
      resolveLocalDefinition: (p, imported) =>
        p === ENTRY && imported === "Button"
          ? { absFile: DEF, exportName: "Button" }
          : null,
    });
    const resolved = resolveGraph(graph);
    const occ = resolved.occurrences.find((o) => exportOf(o.rawComponentId) === "Button");
    expect(occ?.rawComponentId?.source).toEqual({ type: "local", filePath: DEF });
  });

  it("falls back to the resolved entry file when resolveLocalDefinition returns null", () => {
    const graph = buildOutOfGraphMemberGraph(ENTRY).build({
      firstParty: (p) => p.startsWith("/ws/packages/ui/"),
      resolveLocalDefinition: () => null,
    });
    const resolved = resolveGraph(graph);
    const occ = resolved.occurrences.find((o) => exportOf(o.rawComponentId) === "Button");
    expect(occ?.rawComponentId?.source).toEqual({ type: "local", filePath: ENTRY });
  });

  it("emits an external occurrence when membership callbacks are absent", () => {
    const graph = buildOutOfGraphMemberGraph(ENTRY).build();
    const resolved = resolveGraph(graph);
    const occ = resolved.occurrences.find((o) => exportOf(o.rawComponentId) === "Button");
    expect(occ?.rawComponentId?.source.type).toBe("external");
  });

  it("emits an external occurrence when membership returns false", () => {
    const graph = buildOutOfGraphMemberGraph(ENTRY).build({
      firstParty: () => false,
      resolveLocalDefinition: () => ({ absFile: DEF, exportName: "Button" }),
    });
    const resolved = resolveGraph(graph);
    const occ = resolved.occurrences.find((o) => exportOf(o.rawComponentId) === "Button");
    expect(occ?.rawComponentId?.source.type).toBe("external");
  });
});

describe("composition-path membership", () => {
  const ENTRY = "/ws/packages/ui/src/index.ts";
  const DEF = "/ws/packages/ui/src/button.tsx";
  const HOOKS = {
    firstParty: (p: string) => p.startsWith("/ws/packages/ui/"),
    resolveLocalDefinition: (p: string, imported: string) =>
      p === ENTRY && imported === "Button" ? { absFile: DEF, exportName: "Button" } : null,
  };

  function makeBuilder() {
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "@f/ui" ? ENTRY : null),
    });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({
      specifier: "@f/ui",
      imported: "Button",
      local: "Button",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 0 },
    });
    return { gb, fb };
  }

  it("DynamicImport identity promotes to pinned local for an out-of-graph member", () => {
    const graph = makeBuilder().gb.build(HOOKS);
    const fileGraph = graph.files.get("src/App.tsx")!;
    const identity = deriveIdentity(
      { kind: "DynamicImport", specifier: "@f/ui", projection: ["Button"], originFile: "src/App.tsx" },
      fileGraph,
      graph,
    );
    expect(identity).toEqual({ kind: "local", filePath: DEF, export: "Button" });
  });

  it("TypeOf identity promotes to pinned local for an out-of-graph member", () => {
    const graph = makeBuilder().gb.build(HOOKS);
    const fileGraph = graph.files.get("src/App.tsx")!;
    const identity = deriveIdentity(
      {
        kind: "TypeOf",
        ref: { symbol: "Button", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 2 } },
      },
      fileGraph,
      graph,
    );
    expect(identity).toEqual({ kind: "local", filePath: DEF, export: "Button" });
  });

  it("lazy fold identity promotes to pinned local for an out-of-graph member", () => {
    const { gb, fb } = makeBuilder();
    fb.addImport({
      specifier: "react",
      imported: "lazy",
      local: "lazy",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    const graph = gb.build(HOOKS);
    const fileGraph = graph.files.get("src/App.tsx")!;
    const lazyType: InferredType = {
      kind: "ReturnTypeOf",
      callee: {
        kind: "TypeOf",
        ref: { symbol: "lazy", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 } },
      },
      args: [
        {
          kind: "Function",
          returns: [{ kind: "DynamicImport", specifier: "@f/ui", projection: ["Button"], originFile: "src/App.tsx" }],
        },
      ],
    };
    const terminals = walkWithFolding(graph, fileGraph, lazyType, createArgumentMap());
    expect(terminals[0]?.identity).toEqual({ kind: "local", filePath: DEF, export: "Button" });
  });

  it("composition identity equals the direct-import identity (equality invariant)", () => {
    const { gb, fb } = makeBuilder();
    fb.addJsxUsage({
      ref: { symbol: "Button", memberChain: [], loc: { line: 2, column: 2 } },
      loc: { line: 2, column: 2 },
      props: [],
    });
    const graph = gb.build(HOOKS);
    const direct = resolveGraph(graph).occurrences.find((o) => exportOf(o.rawComponentId) === "Button");
    const fileGraph = graph.files.get("src/App.tsx")!;
    const composed = deriveIdentity(
      { kind: "DynamicImport", specifier: "@f/ui", projection: ["Button"], originFile: "src/App.tsx" },
      fileGraph,
      graph,
    );
    expect(composed).toEqual({ kind: "local", filePath: DEF, export: "Button" });
    expect(direct?.rawComponentId?.source).toEqual({ type: "local", filePath: DEF });
    expect(exportOf(direct?.rawComponentId)).toBe("Button");
  });

  it("namespace-member composition identity equals the direct-import identity", () => {
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "@f/ui" ? ENTRY : null),
    });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({
      specifier: "@f/ui",
      imported: "*",
      local: "UI",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 0 },
    });
    fb.addJsxUsage({
      ref: { symbol: "UI", memberChain: ["Button"], loc: { line: 2, column: 2 } },
      loc: { line: 2, column: 2 },
      props: [],
    });
    const graph = gb.build(HOOKS);
    const direct = resolveGraph(graph).occurrences.find((o) => exportOf(o.rawComponentId) === "Button");
    expect(direct?.rawComponentId?.source).toEqual({ type: "local", filePath: DEF });
    const fileGraph = graph.files.get("src/App.tsx")!;
    const composed = deriveIdentity(
      {
        kind: "TypeOf",
        ref: { symbol: "UI", scope: MODULE_SCOPE, memberChain: ["Button"], loc: { line: 3, column: 2 } },
      },
      fileGraph,
      graph,
    );
    expect(composed).toEqual({ kind: "local", filePath: DEF, export: "Button" });
  });

  it("namespace-member composition identity resolves the member name when hooks are absent", () => {
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "@f/ui" ? ENTRY : null),
    });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({
      specifier: "@f/ui",
      imported: "*",
      local: "UI",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 0 },
    });
    const graph = gb.build();
    const fileGraph = graph.files.get("src/App.tsx")!;
    const identity = deriveIdentity(
      {
        kind: "TypeOf",
        ref: { symbol: "UI", scope: MODULE_SCOPE, memberChain: ["Button"], loc: { line: 2, column: 2 } },
      },
      fileGraph,
      graph,
    );
    expect(identity).toMatchObject({ kind: "imported", specifier: "@f/ui", imported: "Button" });
  });

  it("falls through to imported identity when hooks are absent", () => {
    const graph = makeBuilder().gb.build();
    const fileGraph = graph.files.get("src/App.tsx")!;
    const identity = deriveIdentity(
      { kind: "DynamicImport", specifier: "@f/ui", projection: ["Button"], originFile: "src/App.tsx" },
      fileGraph,
      graph,
    );
    expect(identity?.kind).toBe("imported");
  });

  // In-graph targets. Every test above resolves to an out-of-graph target.
  // These resolve to a target that is in `graph.files`, with membership and
  // resolveLocalDefinition both wired (resolveLocalDefinition poisoned with a
  // decoy definition), so they pass only when an in-graph target is never
  // pinned through the unparsed-member hook.
  const DECOY_FILE = "/DECOY/wrong.tsx";
  const DECOY_EXPORT = "Decoy";
  const IN_GRAPH_TARGET = "src/lib/button.tsx";
  const TARGET_BUTTON = { kind: "local", filePath: IN_GRAPH_TARGET, export: "Button" };
  /** The in-graph target declares and exports `Button`. */
  function declareButton(gb: ReturnType<typeof createGraphBuilder>): void {
    const target = gb.beginFile(IN_GRAPH_TARGET);
    target.addDeclaration({ symbol: "Button", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 1, column: 7 }, isExported: true });
    target.addExport({ kind: "named", exportedAs: "Button", local: "Button" });
  }
  const POISONED_HOOKS = {
    firstParty: () => true,
    resolveLocalDefinition: () => ({ absFile: DECOY_FILE, exportName: DECOY_EXPORT }),
  };

  function makeInGraphBuilder() {
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "@f/ui" ? IN_GRAPH_TARGET : null),
    });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({
      specifier: "@f/ui",
      imported: "Button",
      local: "Button",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 0 },
    });
    declareButton(gb);
    return { gb, fb };
  }

  it("DynamicImport identity of an in-graph target never takes the definition hook's decoy", () => {
    const graph = makeInGraphBuilder().gb.build(POISONED_HOOKS);
    const fileGraph = graph.files.get("src/App.tsx")!;
    const identity = deriveIdentity(
      { kind: "DynamicImport", specifier: "@f/ui", projection: ["Button"], originFile: "src/App.tsx" },
      fileGraph,
      graph,
    );
    expect(identity).toMatchObject(TARGET_BUTTON);
  });

  // The same in-graph target through a relative specifier.
  function makeInGraphRelativeBuilder() {
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "./lib/button" ? IN_GRAPH_TARGET : null),
    });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({
      specifier: "./lib/button",
      imported: "Button",
      local: "Button",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 0 },
    });
    declareButton(gb);
    return { gb, fb };
  }

  it("relative-specifier DynamicImport identity of an in-graph target never takes the definition hook's decoy", () => {
    const graph = makeInGraphRelativeBuilder().gb.build(POISONED_HOOKS);
    const fileGraph = graph.files.get("src/App.tsx")!;
    const identity = deriveIdentity(
      { kind: "DynamicImport", specifier: "./lib/button", projection: ["Button"], originFile: "src/App.tsx" },
      fileGraph,
      graph,
    );
    expect(identity).toMatchObject(TARGET_BUTTON);
  });
});
