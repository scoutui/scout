import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE } from "../src/index.js";
import type { OccurrenceVia, Reference, ScopeId } from "../src/index.js";

describe("GraphBuilder: file lifecycle + basic emissions", () => {
  it("begins a file, returns FileBuilder with module scope", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    expect(fb.currentScope()).toBe(MODULE_SCOPE);
  });

  it("pushScope/popScope nests scopes correctly", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    expect(fb.currentScope()).toBe(MODULE_SCOPE);
    const inner = fb.pushScope();
    expect(inner).toBe(1);
    expect(fb.currentScope()).toBe(1);
    fb.popScope();
    expect(fb.currentScope()).toBe(MODULE_SCOPE);
  });

  it("addDeclaration stores by `${scope}::${symbol}` key", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "JSX" },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const graph = gb.build();
    const fg = graph.files.get("src/App.tsx");
    expect(fg?.declarations.get("0::Foo")?.symbol).toBe("Foo");
  });

  it("addImport / addExport / addJsxUsage append to file records", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({
      specifier: "react",
      imported: "lazy",
      local: "lazy",
      loc: { line: 1, column: 1 },
    });
    fb.addExport({ kind: "named", exportedAs: "App", local: "App" });
    fb.addJsxUsage({
      ref: { symbol: "App", memberChain: [], loc: { line: 5, column: 5 } },
      loc: { line: 5, column: 5 },
      props: [],
    });
    const graph = gb.build();
    const fg = graph.files.get("src/App.tsx");
    expect(fg?.imports).toHaveLength(1);
    expect(fg?.exports).toHaveLength(1);
    expect(fg?.jsxUsages).toHaveLength(1);
    expect(fg?.ownership).toHaveLength(1);
    expect(fg?.ownership[0]?.ownerSymbolRef).toBeNull();
  });

  it("addMemberAssignment records the holder at the current scope, once per assignment", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    expect(gb.build().files.get("src/App.tsx")?.memberAssignments).toEqual([]);
    const inner = fb.pushScope();
    const entry = {
      holder: { symbol: "Card", memberChain: [], loc: { line: 3, column: 0 } },
      member: "Header",
      value: { kind: "JSX" } as const,
      loc: { line: 3, column: 0 },
    };
    fb.addMemberAssignment(entry);
    fb.addMemberAssignment(entry);
    fb.addMemberAssignment({ ...entry, member: "Footer" });
    const fg = gb.build().files.get("src/App.tsx");
    expect(fg?.memberAssignments).toEqual([
      { ...entry, holder: { ...entry.holder, scope: inner } },
      { ...entry, holder: { ...entry.holder, scope: inner }, member: "Footer" },
    ]);
  });

  it("setOwner wires the last-emitted JSX usage", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addJsxUsage({
      ref: { symbol: "Foo", memberChain: [], loc: { line: 3, column: 3 } },
      loc: { line: 3, column: 3 },
      props: [],
    });
    const ownerRef = { symbol: "App", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 } };
    fb.setOwner(ownerRef);
    const graph = gb.build();
    const fg = graph.files.get("src/App.tsx");
    expect(fg?.ownership[0]?.ownerSymbolRef).toEqual(ownerRef);
  });
});

describe("FileBuilder: setOwner with viaOverride", () => {
  it("setOwner stores a viaOverride on the last ownership entry when provided", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/x.jsx");
    const ref: Reference = { symbol: "Foo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 0 }, originFile: "src/x.jsx" };
    fb.addJsxUsage({ ref, loc: { line: 1, column: 0 }, props: [] });
    const ownerRef: Reference = { symbol: "App", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 0 }, originFile: "src/x.jsx" };
    const via: OccurrenceVia = { kind: "prop-forward", bindingName: "slot", constructionSite: { file: "src/x.jsx", line: 1, column: 0 } };
    fb.setOwner(ownerRef, via);
    const fg = gb.build().files.get("src/x.jsx")!;
    expect(fg.ownership[0]?.ownerSymbolRef?.symbol).toBe("App");
    expect(fg.ownership[0]?.viaOverride?.kind).toBe("prop-forward");
  });

  it("setOwner without viaOverride leaves viaOverride undefined", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/x.jsx");
    const ref: Reference = { symbol: "Foo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 0 }, originFile: "src/x.jsx" };
    fb.addJsxUsage({ ref, loc: { line: 1, column: 0 }, props: [] });
    fb.setOwner(null);
    const fg = gb.build().files.get("src/x.jsx")!;
    expect(fg.ownership[0]?.viaOverride).toBeUndefined();
  });
});

describe("FileBuilder: setOwnerAt", () => {
  it("setOwnerAt mutates the specified ownership entry", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/x.jsx");
    const refA: Reference = { symbol: "A", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 0 }, originFile: "src/x.jsx" };
    const refB: Reference = { symbol: "B", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 0 }, originFile: "src/x.jsx" };
    fb.addJsxUsage({ ref: refA, loc: { line: 1, column: 0 }, props: [] });
    fb.addJsxUsage({ ref: refB, loc: { line: 2, column: 0 }, props: [] });
    const ownerRef: Reference = { symbol: "App", scope: MODULE_SCOPE, memberChain: [], loc: { line: 5, column: 0 }, originFile: "src/x.jsx" };
    fb.setOwnerAt(0, ownerRef);
    const fg = gb.build().files.get("src/x.jsx")!;
    expect(fg.ownership[0]?.ownerSymbolRef?.symbol).toBe("App");
    expect(fg.ownership[1]?.ownerSymbolRef).toBeNull();
  });

  it("setOwnerAt stores viaOverride at the specified index", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/x.jsx");
    const ref: Reference = { symbol: "Foo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 0 }, originFile: "src/x.jsx" };
    fb.addJsxUsage({ ref, loc: { line: 1, column: 0 }, props: [] });
    const via: OccurrenceVia = { kind: "prop-forward", bindingName: "slot", constructionSite: { file: "src/x.jsx", line: 1, column: 0 } };
    fb.setOwnerAt(0, null, via);
    const fg = gb.build().files.get("src/x.jsx")!;
    expect(fg.ownership[0]?.viaOverride?.kind).toBe("prop-forward");
  });
});

describe("FileBuilder.addTagUsage", () => {
  it("records tag usage with kind tag on ownership entry", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.vue", "vue");
    fb.addTagUsage({
      tagName: "web-button",
      loc: { line: 3, column: 5 },
      props: [{ name: "size", tier: "written", value: "large" }],
    });
    const fg = gb.build().files.get("a.vue")!;
    expect(fg.tagUsages).toHaveLength(1);
    expect(fg.tagUsages[0]?.tagName).toBe("web-button");
    expect(fg.ownership).toHaveLength(1);
    expect(fg.ownership[0]).toMatchObject({ usageIdx: 0, kind: "tag", ownerSymbolRef: null });
  });

  it("setTagOwner stamps owner on last tag usage", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.vue", "vue");
    fb.addTagUsage({ tagName: "web-button", loc: { line: 1, column: 1 }, props: [] });
    fb.setTagOwner({ symbol: "MyPage", scope: 0 as ScopeId, memberChain: [], loc: { line: 1, column: 1 } });
    const fg = gb.build().files.get("a.vue")!;
    expect(fg.ownership[0]?.ownerSymbolRef?.symbol).toBe("MyPage");
  });
});

describe("GraphBuilder.beginFile dialect", () => {
  it("defaults to react when dialect arg omitted", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.tsx");
    const fg = gb.build().files.get("a.tsx");
    expect(fg?.dialect).toBe("react");
  });

  it("accepts an explicit vue dialect", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    gb.beginFile("a.vue", "vue");
    expect(gb.build().files.get("a.vue")?.dialect).toBe("vue");
  });
});

describe("build() host hooks", () => {
  it("stamps firstParty and resolveLocalDefinition onto the Graph", () => {
    const membership = (p: string) => p.startsWith("/ws/");
    const resolveDef = (_p: string, imported: string) => ({ absFile: "/ws/def.tsx", exportName: imported });
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const graph = gb.build({ firstParty: membership, resolveLocalDefinition: resolveDef });
    expect(graph.firstParty).toBe(membership);
    expect(graph.resolveLocalDefinition).toBe(resolveDef);
  });

  it("stamps hooks on the repoRoot-branch Graph too", () => {
    const membership = () => true;
    const gb = createGraphBuilder({ moduleResolver: () => null, repoRoot: "/repo" });
    const graph = gb.build({ firstParty: membership });
    expect(graph.firstParty).toBe(membership);
    expect(graph.resolveToGraphKey?.("/repo/src/a.tsx")).toBe("src/a.tsx");
    expect(graph.resolveToGraphKey?.("/elsewhere/a.tsx")).toBeNull();
  });

  it("omits hook fields when build() is called bare", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const graph = gb.build();
    expect(graph.firstParty).toBeUndefined();
    expect(graph.resolveLocalDefinition).toBeUndefined();
  });
});
