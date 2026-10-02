import { describe, expect, it } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type InferredType, type Reference } from "../../src/index.js";
import { buildComponentRegistry, entryKey, excludeFoldedHolders, type ComponentRegistry, type RegistryEntry } from "../../src/engine/registry.js";

const JSX: InferredType = { kind: "JSX" };
const fn = (...returns: InferredType[]): InferredType => ({ kind: "Function", returns });
const r = (symbol: string, file = "src/a.tsx"): Reference => ({ symbol, scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: file });
const typeOf = (symbol: string): InferredType => ({ kind: "TypeOf", ref: r(symbol) });
/** What the parser records for an identifier read in value position; the
 *  builder stamps the current scope, as it does for a JSX usage. */
const held = (symbol: string) => ({ symbol, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/a.tsx" });

function registryOf(setup: (gb: ReturnType<typeof createGraphBuilder>) => void) {
  const gb = createGraphBuilder({ moduleResolver: () => null });
  setup(gb);
  const graph = gb.build();
  return buildComponentRegistry(graph);
}

describe("buildComponentRegistry: membership", () => {
  it("an exported component-shaped declaration is a member", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Button", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true });
      fb.addExport({ kind: "named", exportedAs: "Button", local: "Button" });
    });
    expect(reg.hasLocal("src/a.tsx", "Button")).toBe(true);
    expect(reg.localEntries()).toEqual([{ filePath: "src/a.tsx", symbol: "Button", exportName: "Button", kind: "react-component", loc: { line: 1, column: 1 }, isDefault: false }]);
  });

  it("among same-named members, the entry is the declaration the name resolves to, kept at the first one's place", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Gallery", value: fn(JSX), loc: { line: 1, column: 16 }, isExported: true });
      fb.pushScope();
      fb.addDeclaration({ symbol: "Tile", value: fn(JSX), loc: { line: 1, column: 34 }, isExported: false });
      fb.popScope();
      fb.addDeclaration({ symbol: "Frame", value: fn(JSX), loc: { line: 2, column: 13 }, isExported: true });
      fb.addDeclaration({ symbol: "Tile", value: fn(JSX), loc: { line: 3, column: 13 }, isExported: true });
    });
    expect(reg.localEntries().map((e) => [e.symbol, e.loc])).toEqual([
      ["Gallery", { line: 1, column: 16 }],
      ["Tile", { line: 3, column: 13 }],
      ["Frame", { line: 2, column: 13 }],
    ]);
    expect(reg.declarationOf("src/a.tsx", "Tile")?.loc).toEqual({ line: 3, column: 13 });
  });

  it("a nested member keeps its entry when the same-named module-scope declaration is not a member", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Gallery", value: fn(JSX), loc: { line: 1, column: 16 }, isExported: true });
      const inner = fb.pushScope();
      fb.addDeclaration({ symbol: "Tile", value: fn(JSX), loc: { line: 1, column: 34 }, isExported: false });
      fb.addJsxUsage({ ref: { ...r("Tile"), scope: inner }, loc: { line: 1, column: 60 }, props: [] });
      fb.popScope();
      fb.addDeclaration({ symbol: "Tile", value: { kind: "Str", value: "x" }, loc: { line: 2, column: 13 }, isExported: true });
    });
    expect(reg.localEntries().map((e) => [e.symbol, e.loc])).toEqual([
      ["Gallery", { line: 1, column: 16 }],
      ["Tile", { line: 1, column: 34 }],
    ]);
  });

  it("a non-exported, un-referenced JSX-returning helper (renderIcon) is not a member", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "renderIcon", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: false });
    });
    expect(reg.hasLocal("src/a.tsx", "renderIcon")).toBe(false);
    expect(reg.localEntries()).toEqual([]);
  });

  it("a non-exported component that is JSX-referenced is a member", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Inner", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: false });
      fb.addJsxUsage({ ref: r("Inner"), loc: { line: 2, column: 1 }, props: [] });
    });
    expect(reg.hasLocal("src/a.tsx", "Inner")).toBe(true);
  });

  it("a function-scope component that is JSX-referenced from its own scope is a member (body locals)", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "App", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true });
      const inner = fb.pushScope();
      fb.addDeclaration({ symbol: "Inner", value: fn(JSX), loc: { line: 2, column: 1 }, isExported: false });
      fb.addJsxUsage({ ref: { ...r("Inner"), scope: inner }, loc: { line: 3, column: 1 }, props: [] });
      fb.popScope();
    });
    expect(reg.hasLocal("src/a.tsx", "Inner")).toBe(true);
  });

  it("a container the value only reads through is not a hold (`const X = A.B`)", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Palette", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: false });
      fb.addDeclaration({
        symbol: "Swatch",
        value: { kind: "MemberOf", obj: typeOf("Palette"), member: "Swatch" },
        loc: { line: 2, column: 1 },
        isExported: true,
      });
    });
    expect(reg.hasLocal("src/a.tsx", "Palette")).toBe(false);
  });

  it("a JSX value (`const br = <br/>`) is not a member even when referenced", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "br", value: JSX, loc: { line: 1, column: 1 }, isExported: false });
      fb.addJsxUsage({ ref: r("br"), loc: { line: 2, column: 1 }, props: [] });
    });
    expect(reg.hasLocal("src/a.tsx", "br")).toBe(false);
  });

  it("hasLocal answers by exportedAs as well as by symbol", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Foo", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true, exportedAs: "Bar" });
      fb.addExport({ kind: "named", exportedAs: "Bar", local: "Foo" });
    });
    expect(reg.hasLocal("src/a.tsx", "Foo")).toBe(true);
    expect(reg.hasLocal("src/a.tsx", "Bar")).toBe(true);
    expect(reg.localEntries()[0]?.exportName).toBe("Bar");
  });

  it("an anonymous default export is the entry `default` with isDefault true", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "default", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true });
      fb.addExport({ kind: "default", local: "default" });
    });
    expect(reg.localEntries()).toEqual([{ filePath: "src/a.tsx", symbol: "default", exportName: "default", kind: "react-component", loc: { line: 1, column: 1 }, isDefault: true }]);
  });

  it("vue-dialect files contribute no entries", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.vue", "vue");
      fb.addDeclaration({ symbol: "default", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true });
      fb.addExport({ kind: "default", local: "default" });
    });
    expect(reg.localEntries()).toEqual([]);
  });
});

describe("buildComponentRegistry: isComponent, the component judge", () => {
  it("a component-shaped declaration that is not consumed is a component, even though it is not a roster member", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Inner", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: false });
    });
    expect(reg.isComponent("src/a.tsx", "Inner")).toBe(true);
    expect(reg.hasLocal("src/a.tsx", "Inner")).toBe(false);
  });

  it("a JSX value (`const br = <br/>`) is not a component", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "br", value: JSX, loc: { line: 1, column: 1 }, isExported: false });
    });
    expect(reg.isComponent("src/a.tsx", "br")).toBe(false);
  });

  it("a factory (a function returning a function returning JSX) is not a component", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "withLoading", value: fn(fn(JSX)), loc: { line: 1, column: 1 }, isExported: false });
    });
    expect(reg.isComponent("src/a.tsx", "withLoading")).toBe(false);
  });

  it("answers by exportedAs as well as by symbol", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Foo", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true, exportedAs: "Bar" });
      fb.addExport({ kind: "named", exportedAs: "Bar", local: "Foo" });
    });
    expect(reg.isComponent("src/a.tsx", "Foo")).toBe(true);
    expect(reg.isComponent("src/a.tsx", "Bar")).toBe(true);
  });

  it("a vue-dialect file is never a component to the judge", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.vue", "vue");
      fb.addDeclaration({ symbol: "default", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true });
      fb.addExport({ kind: "default", local: "default" });
    });
    expect(reg.isComponent("src/a.vue", "default")).toBe(false);
  });
});

describe("buildComponentRegistry: component namespaces", () => {
  it("an Object with at least one component-shaped prop is a component (a component namespace)", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Root", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: false });
      fb.addDeclaration({
        symbol: "Sidebar",
        value: { kind: "Object", props: { Root: typeOf("Root") } },
        loc: { line: 2, column: 1 },
        isExported: true,
      });
    });
    expect(reg.isComponent("src/a.tsx", "Sidebar")).toBe(true);
  });

  it("an Object whose props are all non-component-shaped (e.g. strings) is not a component", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({
        symbol: "Labels",
        value: { kind: "Object", props: { title: { kind: "Str", value: "hi" } } },
        loc: { line: 1, column: 1 },
        isExported: true,
      });
    });
    expect(reg.isComponent("src/a.tsx", "Labels")).toBe(false);
  });

  it("a consumed component namespace is a roster member (hasLocal/localEntries), not just shape-true", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Root", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: false });
      fb.addDeclaration({
        symbol: "Sidebar",
        value: { kind: "Object", props: { Root: typeOf("Root") } },
        loc: { line: 2, column: 1 },
        isExported: true,
      });
      fb.addExport({ kind: "named", exportedAs: "Sidebar", local: "Sidebar" });
    });
    expect(reg.hasLocal("src/a.tsx", "Sidebar")).toBe(true);
    expect(reg.localEntries().some((e) => e.exportName === "Sidebar")).toBe(true);
  });

  it("evalKind itself stays pure: an Object is still 'other', regardless of the registry-only namespace widening", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Root", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: false });
      fb.addDeclaration({
        symbol: "Sidebar",
        value: { kind: "Object", props: { Root: typeOf("Root") } },
        loc: { line: 2, column: 1 },
        isExported: false,
      });
    });
    // Not consumed (never exported, JSX-used or passed as an arg): the
    // namespace widening is a shape rule, not a blanket "Object is a member".
    expect(reg.hasLocal("src/a.tsx", "Sidebar")).toBe(false);
    // But a component to the judge, since it is admitted-shaped.
    expect(reg.isComponent("src/a.tsx", "Sidebar")).toBe(true);
  });
});


describe("buildComponentRegistry: isComponent on a compound name", () => {
  const inlineComponent: InferredType = fn(JSX);

  it("`NS.Inline` is a component when NS is an Object whose `Inline` prop is component-shaped", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({
        symbol: "NS",
        value: { kind: "Object", props: { Inline: inlineComponent } },
        loc: { line: 1, column: 1 },
        isExported: true,
      });
    });
    expect(reg.isComponent("src/a.tsx", "NS.Inline")).toBe(true);
  });

  it("walks a deeper chain through nested Objects (`NS.Sub.Inline`)", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({
        symbol: "NS",
        value: { kind: "Object", props: { Sub: { kind: "Object", props: { Inline: inlineComponent } } } },
        loc: { line: 1, column: 1 },
        isExported: true,
      });
    });
    expect(reg.isComponent("src/a.tsx", "NS.Sub.Inline")).toBe(true);
    expect(reg.isComponent("src/a.tsx", "NS.Sub")).toBe(true); // Sub is itself a component namespace
  });

  it("a member that is not component-shaped (`Config.Title` → a string) is not a component", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({
        symbol: "Config",
        value: { kind: "Object", props: { Title: { kind: "Str", value: "hi" }, Panel: inlineComponent } },
        loc: { line: 1, column: 1 },
        isExported: true,
      });
    });
    expect(reg.isComponent("src/a.tsx", "Config.Title")).toBe(false);
    expect(reg.isComponent("src/a.tsx", "Config.Panel")).toBe(true);
  });

  it("a missing member, or a root that is not an Object, is not a component", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: inlineComponent } }, loc: { line: 1, column: 1 }, isExported: true });
      fb.addDeclaration({ symbol: "Button", value: fn(JSX), loc: { line: 2, column: 1 }, isExported: true });
    });
    expect(reg.isComponent("src/a.tsx", "NS.Missing")).toBe(false);
    expect(reg.isComponent("src/a.tsx", "Button.Icon")).toBe(false);
    expect(reg.isComponent("src/a.tsx", "Nope.Inline")).toBe(false);
  });

  it("a dotted export never becomes a roster member; the holder does (rows come from occurrences)", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: inlineComponent } }, loc: { line: 1, column: 1 }, isExported: true });
      fb.addExport({ kind: "named", exportedAs: "NS", local: "NS" });
    });
    expect(reg.hasLocal("src/a.tsx", "NS")).toBe(true);
    expect(reg.hasLocal("src/a.tsx", "NS.Inline")).toBe(false);
  });
});

describe("buildComponentRegistry: declarationOf", () => {
  it("answers with the symbol and position of a module-scope declaration", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Button", value: fn(JSX), loc: { line: 7, column: 3 }, isExported: true });
      fb.addExport({ kind: "named", exportedAs: "Button", local: "Button" });
    });
    expect(reg.declarationOf("src/a.tsx", "Button")).toEqual({ symbol: "Button", loc: { line: 7, column: 3 } });
  });

  it("answers by export name and reports the local symbol", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Foo", value: fn(JSX), loc: { line: 4, column: 2 }, isExported: true, exportedAs: "Bar" });
      fb.addExport({ kind: "named", exportedAs: "Bar", local: "Foo" });
    });
    expect(reg.declarationOf("src/a.tsx", "Bar")).toEqual({ symbol: "Foo", loc: { line: 4, column: 2 } });
  });

  it("a declaration exported under the name wins over an earlier nested declaration of that symbol", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Page", value: fn(JSX), loc: { line: 1, column: 16 }, isExported: true });
      fb.pushScope();
      fb.addDeclaration({ symbol: "Tile", value: fn(JSX), loc: { line: 2, column: 8 }, isExported: false });
      fb.popScope();
      fb.addDeclaration({ symbol: "TileImpl", value: fn(JSX), loc: { line: 5, column: 6 }, isExported: true, exportedAs: "Tile" });
      fb.addExport({ kind: "named", exportedAs: "Tile", local: "TileImpl" });
    });
    expect(reg.declarationOf("src/a.tsx", "Tile")).toEqual({ symbol: "TileImpl", loc: { line: 5, column: 6 } });
  });

  it("finds a declaration in a nested scope by its symbol", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "App", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true });
      fb.pushScope();
      fb.addDeclaration({ symbol: "Inner", value: fn(JSX), loc: { line: 9, column: 5 }, isExported: false });
      fb.popScope();
    });
    expect(reg.declarationOf("src/a.tsx", "Inner")).toEqual({ symbol: "Inner", loc: { line: 9, column: 5 } });
  });

  it("a compound name has no declaration of its own; its holder does", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: fn(JSX) } }, loc: { line: 2, column: 1 }, isExported: true });
    });
    expect(reg.declarationOf("src/a.tsx", "NS.Inline")).toBeUndefined();
    expect(reg.declarationOf("src/a.tsx", "NS")).toEqual({ symbol: "NS", loc: { line: 2, column: 1 } });
  });

  it("an unknown name is undefined", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addDeclaration({ symbol: "Button", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true });
    });
    expect(reg.declarationOf("src/a.tsx", "Missing")).toBeUndefined();
    expect(reg.declarationOf("src/nowhere.tsx", "Button")).toBeUndefined();
  });

  it("a vue-dialect file is undefined", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.vue", "vue");
      fb.addDeclaration({ symbol: "default", value: fn(JSX), loc: { line: 1, column: 1 }, isExported: true });
      fb.addExport({ kind: "default", local: "default" });
    });
    expect(reg.declarationOf("src/a.vue", "default")).toBeUndefined();
  });

  it("the registry narrowed by excludeFoldedHolders still answers for the folded holder", () => {
    const reg = registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addImport({ specifier: "react", imported: "memo", local: "memo", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
      fb.addDeclaration({ symbol: "Foo", value: fn(JSX), loc: { line: 2, column: 1 }, isExported: false });
      fb.addDeclaration({ symbol: "Enhanced", value: { kind: "ReturnTypeOf", callee: typeOf("memo"), args: [typeOf("Foo")] }, loc: { line: 3, column: 1 }, isExported: true });
      fb.addExport({ kind: "named", exportedAs: "Enhanced", local: "Enhanced" });
      fb.addHeldRef(held("Foo"));
    });
    const narrowed = excludeFoldedHolders(reg, new Map([[entryKey("src/a.tsx", "Enhanced"), { target: { filePath: "src/a.tsx", export: "Foo" } }]]));
    expect(narrowed.hasLocal("src/a.tsx", "Enhanced")).toBe(false);
    expect(narrowed.declarationOf("src/a.tsx", "Enhanced")).toEqual({ symbol: "Enhanced", loc: { line: 3, column: 1 } });
    expect(narrowed.declarationOf("src/a.tsx", "Foo")).toEqual({ symbol: "Foo", loc: { line: 2, column: 1 } });
  });
});

describe("excludeFoldedHolders: folded holders are not members", () => {
  // `memo` is a call; the holder's value shape does not matter to the
  // seam: the engine decides what is folded and hands the seam the keys.
  const call = (arg: string): InferredType => ({ kind: "ReturnTypeOf", callee: typeOf("memo"), args: [typeOf(arg)] });

  function withHolders() {
    return registryOf((gb) => {
      const fb = gb.beginFile("src/a.tsx");
      fb.addImport({ specifier: "react", imported: "memo", local: "memo", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
      fb.addDeclaration({ symbol: "Foo", value: fn(JSX), loc: { line: 2, column: 1 }, isExported: false });
      fb.addDeclaration({ symbol: "Enhanced", value: call("Foo"), loc: { line: 3, column: 1 }, isExported: true });
      fb.addExport({ kind: "named", exportedAs: "Enhanced", local: "Enhanced" });
      fb.addDeclaration({ symbol: "Page", value: fn(JSX), loc: { line: 4, column: 1 }, isExported: false });
      fb.addDeclaration({ symbol: "default", value: call("Page"), loc: { line: 5, column: 1 }, isExported: true });
      fb.addExport({ kind: "default", local: "default" });
      fb.addHeldRef(held("Foo"));
      fb.addHeldRef(held("Page"));
    });
  }

  it("omits folded holders from localEntries and answers hasLocal false for their symbol and export name", () => {
    const reg = withHolders();
    expect(reg.localEntries().map((e) => e.symbol).sort()).toEqual(["Enhanced", "Foo", "Page", "default"]);
    const narrowed = excludeFoldedHolders(
      reg,
      new Map([
        [entryKey("src/a.tsx", "Enhanced"), { target: { filePath: "src/a.tsx", export: "Foo" } }],
        [entryKey("src/a.tsx", "default"), { target: { filePath: "src/a.tsx", export: "Page" } }],
      ]),
    );
    expect(narrowed.localEntries().map((e) => e.symbol).sort()).toEqual(["Foo", "Page"]);
    expect(narrowed.hasLocal("src/a.tsx", "Enhanced")).toBe(false);
    expect(narrowed.hasLocal("src/a.tsx", "default")).toBe(false);
    expect(narrowed.hasLocal("src/a.tsx", "Foo")).toBe(true);
  });

  it("transfers isDefault to the same-file target only when the folded holder was the default export", () => {
    const reg = withHolders();
    const narrowed = excludeFoldedHolders(
      reg,
      new Map([
        [entryKey("src/a.tsx", "Enhanced"), { target: { filePath: "src/a.tsx", export: "Foo" } }],
        [entryKey("src/a.tsx", "default"), { target: { filePath: "src/a.tsx", export: "Page" } }],
      ]),
    );
    const byName = Object.fromEntries(narrowed.localEntries().map((e) => [e.symbol, e.isDefault]));
    expect(byName).toEqual({ Foo: false, Page: true });
  });

  it("transfers nothing when the folded default holder has no single same-file target", () => {
    const reg = withHolders();
    const narrowed = excludeFoldedHolders(reg, new Map([[entryKey("src/a.tsx", "default"), { target: null }]]));
    expect(narrowed.localEntries().find((e) => e.symbol === "Page")?.isDefault).toBe(false);
    expect(narrowed.localEntries().some((e) => e.symbol === "default")).toBe(false);
  });

  it("passes isComponent and declarationOf through unchanged and returns the same registry for an empty map", () => {
    const reg = withHolders();
    expect(excludeFoldedHolders(reg, new Map())).toBe(reg);
    const narrowed = excludeFoldedHolders(reg, new Map([[entryKey("src/a.tsx", "Enhanced"), { target: null }]]));
    expect(narrowed.isComponent("src/a.tsx", "Enhanced")).toBe(reg.isComponent("src/a.tsx", "Enhanced"));
    expect(narrowed.isComponent("src/a.tsx", "Foo")).toBe(true);
    expect(narrowed.declarationOf("src/a.tsx", "Enhanced")).toEqual({ symbol: "Enhanced", loc: { line: 3, column: 1 } });
  });

  it("keeps a folded holder a tag rendered as a function, and hands its target nothing", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/a.tsx");
    fb.addImport({ specifier: "react", imported: "memo", local: "memo", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    fb.addDeclaration({ symbol: "Page", value: fn(JSX), loc: { line: 4, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "default", value: call("Page"), loc: { line: 5, column: 1 }, isExported: true });
    fb.addExport({ kind: "default", local: "default" });
    fb.addHeldRef(held("Page"));
    const graph = gb.build();
    const tagged = graph.files.get("src/a.tsx")?.declarations.get(`${MODULE_SCOPE}::default`);
    const reg = buildComponentRegistry(graph, tagged === undefined ? [] : [tagged]);
    const entry = reg.localEntries().find((e) => e.symbol === "default");
    expect(entry !== undefined && reg.isRenderedAsTag(entry)).toBe(true);
    const narrowed = excludeFoldedHolders(reg, new Map([[entryKey("src/a.tsx", "default"), { target: { filePath: "src/a.tsx", export: "Page" } }]]));
    expect(narrowed.localEntries().map((e) => [e.symbol, e.isDefault]).sort()).toEqual([
      ["Page", false],
      ["default", true],
    ]);
    expect(narrowed.hasLocal("src/a.tsx", "default")).toBe(true);
  });

  it("a folded holder's export name never shadows an unrelated member's symbol (survivors decide hasLocal)", () => {
    // Hand-built: `buildComponentRegistry` collapses this collision by
    // declaration order, but the seam accepts any registry and must not
    // mix the symbol and export-name key spaces on its own.
    const entry = (symbol: string, exportName: string, isDefault = false): RegistryEntry => ({
      filePath: "src/a.tsx", symbol, exportName, kind: "react-component", loc: { line: 1, column: 1 }, isDefault,
    });
    const entries = [entry("Alias", "Alias"), entry("Foo", "Foo"), entry("Wrapped", "Alias")];
    const names = new Set(entries.flatMap((e) => [entryKey(e.filePath, e.symbol), entryKey(e.filePath, e.exportName)]));
    const reg: ComponentRegistry = {
      hasLocal: (filePath, name) => names.has(entryKey(filePath, name)),
      isComponent: () => true,
      declarationOf: () => undefined,
      isRenderedAsTag: () => false,
      isTagged: () => false,
      localEntries: () => entries,
    };
    const narrowed = excludeFoldedHolders(reg, new Map([[entryKey("src/a.tsx", "Wrapped"), { target: { filePath: "src/a.tsx", export: "Foo" } }]]));
    expect(narrowed.localEntries().map((e) => e.symbol).sort()).toEqual(["Alias", "Foo"]);
    expect(narrowed.hasLocal("src/a.tsx", "Alias")).toBe(true);
    expect(narrowed.hasLocal("src/a.tsx", "Wrapped")).toBe(false);
  });
});
