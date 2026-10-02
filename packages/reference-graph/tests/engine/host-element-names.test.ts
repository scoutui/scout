/**
 * A declaration whose every renderable name is a JSX host-element name
 * is neither a registry member nor an owner. One judge: the roster
 * narrowing, which `classifyDeclaration` consults, so such a declaration's
 * JSX goes to its callers instead of being credited to it.
 */
import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type Graph, type InferredType, type Reference } from "../../src/index.js";
import { resolve } from "../../src/engine/index.js";
import { classifyDeclaration } from "../../src/engine/helper-callers.js";
import { buildComponentRegistry, excludeHostElementNames } from "../../src/engine/registry.js";

const JSX: InferredType = { kind: "JSX" };
const fn = (...returns: InferredType[]): InferredType => ({ kind: "Function", returns });
const at = (line: number) => ({ line, column: 1 });
const ref = (symbol: string, file: string): Reference => ({ symbol, scope: MODULE_SCOPE, memberChain: [], loc: at(1), originFile: file });
/** The roster view owner classification consults. */
const rosterOf = (graph: Graph) => excludeHostElementNames(buildComponentRegistry(graph), graph);
const names = (r: ReturnType<typeof resolve>) => r.registry.localEntries().map((e) => `${e.filePath}::${e.symbol}`).sort();

/** The module-scope declaration `symbol` in `file`; throws if the builder never recorded it. */
function moduleDecl(graph: ReturnType<ReturnType<typeof createGraphBuilder>["build"]>, file: string, symbol: string) {
  const decl = graph.files.get(file)?.declarations.get(`${MODULE_SCOPE}::${symbol}`);
  if (!decl) throw new Error(`no declaration ${file}::${symbol}`);
  return decl;
}

describe("host-element-named declarations are not registry members", () => {
  it("an exported lowercase-initial declaration is not a member; its PascalCase twin is", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/a.tsx");
    fb.addDeclaration({ symbol: "getDealDuration", value: fn(JSX), loc: at(1), isExported: true });
    fb.addExport({ kind: "named", exportedAs: "getDealDuration", local: "getDealDuration" });
    fb.addDeclaration({ symbol: "DealDuration", value: fn(JSX), loc: at(2), isExported: true });
    fb.addExport({ kind: "named", exportedAs: "DealDuration", local: "DealDuration" });

    const r = resolve(gb.build());
    expect(names(r)).toEqual(["src/a.tsx::DealDuration"]);
    expect(r.registry.hasLocal("src/a.tsx", "getDealDuration")).toBe(false);
  });

  it("a default export is exempt: its local name is not the rendered name", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/anon.tsx");
    fb.addDeclaration({ symbol: "default", value: fn(JSX), loc: at(1), isExported: true });
    fb.addExport({ kind: "default", local: "default" });

    const r = resolve(gb.build());
    expect(names(r)).toEqual(["src/anon.tsx::default"]);
  });

  it("a lowercase local that is the default export is exempt (`const view = …; export default view`)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/view.tsx");
    fb.addDeclaration({ symbol: "view", value: fn(JSX), loc: at(1), isExported: false });
    fb.addExport({ kind: "default", local: "view" });

    const r = resolve(gb.build());
    expect(names(r)).toEqual(["src/view.tsx::view"]);
  });

  it("a named export alias rescues a lowercase local (`export { helper as Button }`)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/b.tsx");
    fb.addDeclaration({ symbol: "helper", value: fn(JSX), loc: at(1), isExported: false });
    fb.addExport({ kind: "named", exportedAs: "Button", local: "helper" });

    const r = resolve(gb.build());
    expect(names(r)).toEqual(["src/b.tsx::helper"]);
  });

  it("the rule is `/^[a-z]/`, not `!PascalCase`: `_Private` and `$El` survive", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/c.tsx");
    fb.addDeclaration({ symbol: "_Private", value: fn(JSX), loc: at(1), isExported: true });
    fb.addExport({ kind: "named", exportedAs: "_Private", local: "_Private" });
    fb.addDeclaration({ symbol: "$El", value: fn(JSX), loc: at(2), isExported: true });
    fb.addExport({ kind: "named", exportedAs: "$El", local: "$El" });

    const r = resolve(gb.build());
    expect(names(r)).toEqual(["src/c.tsx::$El", "src/c.tsx::_Private"]);
  });

});

describe("host-element-named declarations are helpers, not owners", () => {
  it("a lowercase JSX-returning declaration classifies as a helper, so its JSX fans out to its callers", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/render.tsx");
    fb.addDeclaration({ symbol: "renderActionItem", value: fn(JSX), loc: at(1), isExported: true });
    fb.addExport({ kind: "named", exportedAs: "renderActionItem", local: "renderActionItem" });
    const graph = gb.build();
    const decl = moduleDecl(graph, "src/render.tsx", "renderActionItem");

    expect(classifyDeclaration(decl, rosterOf(graph), graph.files.get("src/render.tsx")!)).toBe("helper");
  });

  it("a PascalCase JSX-returning declaration still classifies as a component", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/render.tsx");
    fb.addDeclaration({ symbol: "ActionItem", value: fn(JSX), loc: at(1), isExported: true });
    fb.addExport({ kind: "named", exportedAs: "ActionItem", local: "ActionItem" });
    const graph = gb.build();
    const decl = moduleDecl(graph, "src/render.tsx", "ActionItem");

    expect(classifyDeclaration(decl, rosterOf(graph), graph.files.get("src/render.tsx")!)).toBe("component");
  });

  it("a lowercase default-exported declaration is still a component owner", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/view.tsx");
    fb.addDeclaration({ symbol: "view", value: fn(JSX), loc: at(1), isExported: false });
    fb.addExport({ kind: "default", local: "view" });
    const graph = gb.build();
    const decl = moduleDecl(graph, "src/view.tsx", "view");

    expect(classifyDeclaration(decl, rosterOf(graph), graph.files.get("src/view.tsx")!)).toBe("component");
  });

  it("a lowercase local exported under a component name is still a component owner", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/b.tsx");
    fb.addDeclaration({ symbol: "helper", value: fn(JSX), loc: at(1), isExported: false });
    fb.addExport({ kind: "named", exportedAs: "Button", local: "helper" });
    const graph = gb.build();
    const decl = moduleDecl(graph, "src/b.tsx", "helper");

    expect(classifyDeclaration(decl, rosterOf(graph), graph.files.get("src/b.tsx")!)).toBe("component");
  });
});
