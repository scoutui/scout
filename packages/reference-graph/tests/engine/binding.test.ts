import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type Graph, type Reference } from "../../src/index.js";
import { bindingIdentity, bindingValue, pinUnparsed, resolveBinding, walkedIdentity, type Binding } from "../../src/engine/binding.js";
import { createCycleGuard, type CycleGuard } from "../../src/engine/cycle-detection.js";

const loc = { line: 1, column: 1 };
const ref = (symbol: string, memberChain: string[] = []): Reference => ({ symbol, scope: MODULE_SCOPE, memberChain, loc });

/** Resolves each specifier in `table` to its graph key; anything else fails to resolve. */
function builder(table: Record<string, string>) {
  return createGraphBuilder({ moduleResolver: (_from, spec) => table[spec] ?? null });
}

function bind(graph: Graph, file: string, r: Reference, guard?: CycleGuard): Binding {
  const fg = graph.files.get(file);
  if (!fg) throw new Error(`no file ${file}`);
  return resolveBinding(graph, fg, r, guard);
}

/** A cycle guard that records every push. */
function recordingGuard(): { guard: CycleGuard; pushes: string[] } {
  const inner = createCycleGuard();
  const pushes: string[] = [];
  const guard: CycleGuard = {
    visited: inner.visited,
    get depth() {
      return inner.depth;
    },
    push(file, symbol) {
      pushes.push(`${file}::${symbol}`);
      return inner.push(file, symbol);
    },
    pop: (file, symbol) => inner.pop(file, symbol),
    pushNode: (node) => inner.pushNode(node),
    popNode: (node) => inner.popNode(node),
  };
  return { guard, pushes };
}

describe("resolveBinding", () => {
  it("binds a same-file name to its declaration, in scope, with the member chain as path", () => {
    const gb = builder({});
    gb.beginFile("src/App.tsx").addDeclaration({ symbol: "Card", value: { kind: "JSX" }, loc, isExported: false });
    const b = bind(gb.build(), "src/App.tsx", ref("Card", ["Header"]));
    expect(b).toMatchObject({ kind: "declaration", file: "src/App.tsx", inScope: true, path: ["Header"] });
    expect(bindingValue(b)).toEqual({ kind: "MemberOf", obj: { kind: "JSX" }, member: "Header" });
  });

  it("follows an import through an `export … from` hop to the declaration, out of scope", () => {
    const gb = builder({ "./x": "src/x.tsx", "./y": "src/y.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./x", imported: "X", local: "X", loc });
    gb.beginFile("src/x.tsx").addExport({ kind: "named", exportedAs: "X", from: "./y", fromImported: "X" });
    const y = gb.beginFile("src/y.tsx");
    y.addDeclaration({ symbol: "X", value: { kind: "JSX" }, loc, isExported: true });
    y.addExport({ kind: "named", exportedAs: "X", local: "X" });
    const b = bind(gb.build(), "src/App.tsx", ref("X"));
    expect(b).toMatchObject({ kind: "declaration", file: "src/y.tsx", inScope: false, path: [] });
    expect(b.kind === "declaration" && b.decl.symbol).toBe("X");
  });

  it("takes the first `export *` branch that binds the name", () => {
    const gb = builder({ "./barrel": "src/barrel.ts", "./a": "src/a.tsx", "./b": "src/b.tsx", "./c": "src/c.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./barrel", imported: "X", local: "X", loc });
    const barrel = gb.beginFile("src/barrel.ts");
    barrel.addExport({ kind: "star", from: "./a" });
    barrel.addExport({ kind: "star", from: "./b" });
    barrel.addExport({ kind: "star", from: "./c" });
    gb.beginFile("src/a.tsx");
    for (const file of ["src/b.tsx", "src/c.tsx"]) {
      const fb = gb.beginFile(file);
      fb.addDeclaration({ symbol: "X", value: { kind: "Str", value: file }, loc, isExported: true });
      fb.addExport({ kind: "named", exportedAs: "X", local: "X" });
    }
    const b = bind(gb.build(), "src/App.tsx", ref("X"));
    expect(b).toMatchObject({ kind: "declaration", file: "src/b.tsx", inScope: false });
  });

  it("resolves the first `export *` branch that holds the record, even when that record leads nowhere", () => {
    const gb = builder({ "./barrel": "src/barrel.ts", "./a": "src/a.ts", "./b": "src/b.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./barrel", imported: "X", local: "X", loc });
    const barrel = gb.beginFile("src/barrel.ts");
    barrel.addExport({ kind: "star", from: "./a" });
    barrel.addExport({ kind: "star", from: "./b" });
    gb.beginFile("src/a.ts").addExport({ kind: "named", exportedAs: "X", from: "./missing", fromImported: "X" });
    const b = gb.beginFile("src/b.tsx");
    b.addDeclaration({ symbol: "X", value: { kind: "JSX" }, loc, isExported: true });
    b.addExport({ kind: "named", exportedAs: "X", local: "X" });
    const binding = bind(gb.build(), "src/App.tsx", ref("X"));
    expect(binding).toEqual({ kind: "import-failed", specifier: "./missing", exportName: "X", path: [] });
    expect(bindingValue(binding)).toEqual({ kind: "Unknown" });
  });

  it("gives no-export, without a guard push, for an `export … from` hop whose target lacks the export", () => {
    const gb = builder({ "./x": "src/x.ts", "./y": "src/y.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./x", imported: "X", local: "X", loc });
    gb.beginFile("src/x.ts").addExport({ kind: "named", exportedAs: "X", from: "./y", fromImported: "Y" });
    const y = gb.beginFile("src/y.tsx");
    y.addDeclaration({ symbol: "X", value: { kind: "JSX" }, loc, isExported: true });
    y.addExport({ kind: "named", exportedAs: "X", local: "X" });
    const { guard, pushes } = recordingGuard();
    expect(bind(gb.build(), "src/App.tsx", ref("X"), guard)).toEqual({ kind: "no-export" });
    expect(pushes).toEqual([]);
    expect([guard.visited.size, guard.depth]).toEqual([0, 0]);
  });

  it("pushes and pops the guard once per hop on a resolving `export … from` chain", () => {
    const gb = builder({ "./x": "src/x.ts", "./y": "src/y.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./x", imported: "X", local: "X", loc });
    gb.beginFile("src/x.ts").addExport({ kind: "named", exportedAs: "X", from: "./y", fromImported: "Y" });
    const y = gb.beginFile("src/y.tsx");
    y.addDeclaration({ symbol: "Y", value: { kind: "JSX" }, loc, isExported: true });
    y.addExport({ kind: "named", exportedAs: "Y", local: "Y" });
    const { guard, pushes } = recordingGuard();
    expect(bind(gb.build(), "src/App.tsx", ref("X"), guard)).toMatchObject({ kind: "declaration", file: "src/y.tsx" });
    expect(pushes).toEqual(["src/x.ts::X", "src/y.tsx::Y"]);
    expect([guard.visited.size, guard.depth]).toEqual([0, 0]);
  });

  it("skips an `export *` branch the resolution has already sought, and binds the next", () => {
    const gb = builder({ "./a": "src/a.ts", "./b": "src/b.ts", "./c": "src/c.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./a", imported: "X", local: "X", loc });
    gb.beginFile("src/a.ts").addExport({ kind: "named", exportedAs: "X", from: "./b", fromImported: "X" });
    const b = gb.beginFile("src/b.ts");
    b.addExport({ kind: "star", from: "./a" });
    b.addExport({ kind: "star", from: "./c" });
    const c = gb.beginFile("src/c.tsx");
    c.addDeclaration({ symbol: "X", value: { kind: "JSX" }, loc, isExported: true });
    c.addExport({ kind: "named", exportedAs: "X", local: "X" });
    const binding = bind(gb.build(), "src/App.tsx", ref("X"));
    expect(binding).toMatchObject({ kind: "declaration", file: "src/c.tsx", path: [], inScope: false });
    expect(bindingValue(binding)).toEqual({ kind: "JSX" });
  });

  it("gives no-export for a name absent from two barrels that `export *` each other", () => {
    const gb = builder({ "./a": "src/a.ts", "./b": "src/b.ts" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./a", imported: "X", local: "X", loc });
    gb.beginFile("src/a.ts").addExport({ kind: "star", from: "./b" });
    gb.beginFile("src/b.ts").addExport({ kind: "star", from: "./a" });
    expect(bind(gb.build(), "src/App.tsx", ref("X"))).toEqual({ kind: "no-export" });
  });

  it.each([
    ["the default of a file", "default", "src/a.ts"],
    ["a name of a file", "X", "src/a.ts"],
    ["a name, through `export *`, of a file", "X", "src/b.ts"],
  ])("does not follow %s that exports something it does not record", (_label, imported, marked) => {
    const gb = builder({ "./a": "src/a.ts", "./b": "src/b.ts" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./a", imported, local: "X", loc });
    const files = { "src/a.ts": gb.beginFile("src/a.ts"), "src/b.ts": gb.beginFile("src/b.ts") };
    files["src/a.ts"].addExport({ kind: "star", from: "./b" });
    files[marked as keyof typeof files].markUnrecordedExports();
    expect(bind(gb.build(), "src/App.tsx", ref("X"))).toEqual({ kind: "unfollowed" });
  });

  it("does not follow an `export … from` cycle", () => {
    const gb = builder({ "./a": "src/a.ts", "./b": "src/b.ts" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./a", imported: "X", local: "X", loc });
    gb.beginFile("src/a.ts").addExport({ kind: "named", exportedAs: "X", from: "./b", fromImported: "X" });
    gb.beginFile("src/b.ts").addExport({ kind: "named", exportedAs: "X", from: "./a", fromImported: "X" });
    expect(bind(gb.build(), "src/App.tsx", ref("X"))).toEqual({ kind: "unfollowed" });
  });

  describe("a namespace import of a parsed file", () => {
    function graph() {
      const gb = builder({ "./ui": "src/ui.tsx" });
      gb.beginFile("src/App.tsx").addImport({ specifier: "./ui", imported: "*", local: "UI", loc });
      const ui = gb.beginFile("src/ui.tsx");
      ui.addDeclaration({ symbol: "Plain", value: { kind: "JSX" }, loc, isExported: true });
      ui.addExport({ kind: "named", exportedAs: "Plain", local: "Plain" });
      ui.addImport({ specifier: "react", imported: "memo", local: "memo", loc });
      ui.addExport({ kind: "named", exportedAs: "memo", local: "memo" });
      return gb.build();
    }

    it("binds a member to its declaration and values it", () => {
      const b = bind(graph(), "src/App.tsx", ref("UI", ["Plain"]));
      expect(b).toEqual({
        kind: "declaration",
        file: "src/ui.tsx",
        decl: expect.objectContaining({ symbol: "Plain" }),
        member: null,
        path: [],
        inScope: false,
      });
      expect(bindingValue(b)).toEqual({ kind: "JSX" });
    });

    it("does not follow the namespace object itself", () => {
      expect(bind(graph(), "src/App.tsx", ref("UI"))).toEqual({ kind: "unfollowed" });
    });

    it("values a member that is a stubbed library export as its stub", () => {
      const b = bind(graph(), "src/App.tsx", ref("UI", ["memo"]));
      expect(b).toMatchObject({ kind: "package-export", specifier: "react", exportName: "memo" });
      expect(bindingValue(b)).toMatchObject({ kind: "Function" });
    });
  });

  describe("a parsed barrel whose export leads to a package", () => {
    const packageButton = (fromFile: string, resolved: boolean): Binding => ({
      kind: "package-export",
      specifier: "@ds/react",
      exportName: "Button",
      path: [],
      stub: null,
      fromFile,
      resolved,
    });

    it("names the package export an imported local re-exports", () => {
      const gb = builder({ "./ds": "src/ds.tsx" });
      gb.beginFile("src/App.tsx").addImport({ specifier: "./ds", imported: "Button", local: "Button", loc });
      const ds = gb.beginFile("src/ds.tsx");
      ds.addImport({ specifier: "@ds/react", imported: "Button", local: "Button", loc });
      ds.addExport({ kind: "named", exportedAs: "Button", local: "Button" });
      expect(bind(gb.build(), "src/App.tsx", ref("Button"))).toEqual(packageButton("src/ds.tsx", false));
    });

    it("names the package export an `export … from` hop re-exports", () => {
      const gb = builder({ "./ds": "src/ds.tsx", "@ds/react": "/elsewhere/node_modules/@ds/react/index.js" });
      gb.beginFile("src/App.tsx").addImport({ specifier: "./ds", imported: "Button", local: "Button", loc });
      gb.beginFile("src/ds.tsx").addExport({ kind: "named", exportedAs: "Button", from: "@ds/react", fromImported: "Button" });
      expect(bind(gb.build(), "src/App.tsx", ref("Button"))).toEqual(packageButton("src/ds.tsx", true));
    });

    it("names the package export an `export *` into a package re-exports, when no parsed branch exports the name", () => {
      const gb = builder({ "./ds": "src/ds.tsx", "./inner": "src/inner.tsx", "./own": "src/own.tsx" });
      const app = gb.beginFile("src/App.tsx");
      app.addImport({ specifier: "./ds", imported: "Button", local: "Button", loc });
      app.addImport({ specifier: "./ds", imported: "Card", local: "Card", loc });
      const ds = gb.beginFile("src/ds.tsx");
      ds.addExport({ kind: "star", from: "./inner" });
      ds.addExport({ kind: "star", from: "./own" });
      gb.beginFile("src/inner.tsx").addExport({ kind: "star", from: "@ds/react" });
      const own = gb.beginFile("src/own.tsx");
      own.addDeclaration({ symbol: "Card", value: { kind: "JSX" }, loc, isExported: true });
      own.addExport({ kind: "named", exportedAs: "Card", local: "Card" });
      const graph = gb.build();
      expect(bind(graph, "src/App.tsx", ref("Button"))).toEqual(packageButton("src/inner.tsx", false));
      expect(bind(graph, "src/App.tsx", ref("Card"))).toMatchObject({ kind: "declaration", file: "src/own.tsx" });
    });

    describe("names no package export through `export *` when the package is not the one place the name can come from", () => {
      const graphWith = (stars: Record<string, string[]>) => {
        const gb = builder({ "./ds": "src/ds.tsx", "./inner": "src/inner.tsx", "./skip": "src/skip.tsx" });
        const app = gb.beginFile("src/App.tsx");
        app.addImport({ specifier: "./ds", imported: "Button", local: "Button", loc });
        app.addImport({ specifier: "./ds", imported: "default", local: "D", loc });
        for (const [file, froms] of Object.entries(stars)) {
          const fb = gb.beginFile(file);
          for (const from of froms) fb.addExport({ kind: "star", from });
        }
        return gb.build();
      };

      it("and does not follow it beside an `export *` of a file the scan did not parse", () => {
        const graph = graphWith({ "src/ds.tsx": ["./skip", "./inner"], "src/inner.tsx": ["@ds/react"] });
        expect(bind(graph, "src/App.tsx", ref("Button"))).toEqual({ kind: "unfollowed" });
      });

      it("and does not follow it beside another package's `export *`", () => {
        const graph = graphWith({ "src/ds.tsx": ["@ds/react", "@ds/icons"] });
        expect(bind(graph, "src/App.tsx", ref("Button"))).toEqual({ kind: "unfollowed" });
      });
    });
  });

  describe("a target the scan did not parse", () => {
    function graph(rld: string[]) {
      const gb = builder({
        "@ws/card": "/repo/packages/card/src/index.ts",
        "@/skip": "/repo/src/skip.tsx",
        "./skip": "/repo/src/skip.tsx",
        "./barrel": "src/barrel.ts",
        "@vendor/ui": "/repo/node_modules/@vendor/ui/index.js",
        "../node_modules/v": "/repo/node_modules/v/index.js",
      });
      const app = gb.beginFile("src/App.tsx");
      app.addImport({ specifier: "@ws/card", imported: "Card", local: "Card", loc });
      app.addImport({ specifier: "@/skip", imported: "Panel", local: "AliasPanel", loc });
      app.addImport({ specifier: "./skip", imported: "Panel", local: "Panel", loc });
      app.addImport({ specifier: "./barrel", imported: "Card", local: "BarrelCard", loc });
      app.addImport({ specifier: "./barrel", imported: "Panel", local: "BarrelPanel", loc });
      app.addImport({ specifier: "@vendor/ui", imported: "Button", local: "Button", loc });
      app.addImport({ specifier: "../node_modules/v", imported: "V", local: "V", loc });
      const barrel = gb.beginFile("src/barrel.ts");
      barrel.addExport({ kind: "named", exportedAs: "Card", from: "@ws/card", fromImported: "Card" });
      barrel.addImport({ specifier: "./skip", imported: "Panel", local: "Panel", loc });
      barrel.addExport({ kind: "named", exportedAs: "Panel", local: "Panel" });
      return gb.build({
        firstParty: (abs) => abs.startsWith("/repo/") && !abs.includes("/node_modules/"),
        resolveLocalDefinition: (abs, name) => {
          rld.push(`${abs}#${name}`);
          return { absFile: "/repo/packages/card/src/Card.tsx", exportName: name };
        },
      });
    }
    const unparsed = (file: string, exportName: string, path: string[] = []) => ({ kind: "unparsed", file, exportName, path });

    it("names a first-party file by its resolved path, unpinned, without asking the host, whatever the specifier", () => {
      const rld: string[] = [];
      const g = graph(rld);
      expect(bind(g, "src/App.tsx", ref("Card"))).toEqual(unparsed("/repo/packages/card/src/index.ts", "Card"));
      expect(bind(g, "src/App.tsx", ref("AliasPanel"))).toEqual(unparsed("/repo/src/skip.tsx", "Panel"));
      expect(bind(g, "src/App.tsx", ref("Panel", ["Body"]))).toEqual(unparsed("/repo/src/skip.tsx", "Panel", ["Body"]));
      expect(bind(g, "src/App.tsx", ref("BarrelCard"))).toEqual(unparsed("/repo/packages/card/src/index.ts", "Card"));
      expect(bind(g, "src/App.tsx", ref("BarrelPanel"))).toEqual(unparsed("/repo/src/skip.tsx", "Panel"));
      expect(rld).toEqual([]);
    });

    it("names a package export for a package specifier, and a failed import for any other, outside first-party", () => {
      const g = graph([]);
      expect(bind(g, "src/App.tsx", ref("Button"))).toEqual({
        kind: "package-export",
        specifier: "@vendor/ui",
        exportName: "Button",
        path: [],
        stub: null,
        fromFile: "src/App.tsx",
        resolved: true,
      });
      expect(bind(g, "src/App.tsx", ref("V"))).toEqual({ kind: "import-failed", specifier: "../node_modules/v", exportName: "V", path: [] });
    });
  });

  it("gives import-failed for an unresolvable relative import and a stubless package export for a package", () => {
    const gb = builder({});
    const app = gb.beginFile("src/App.tsx");
    app.addImport({ specifier: "./missing", imported: "Gone", local: "Gone", loc });
    app.addImport({ specifier: "@ds/react", imported: "Button", local: "Button", loc });
    const graph = gb.build();
    expect(bind(graph, "src/App.tsx", ref("Gone"))).toEqual({ kind: "import-failed", specifier: "./missing", exportName: "Gone", path: [] });
    expect(bind(graph, "src/App.tsx", ref("Button"))).toEqual({
      kind: "package-export",
      specifier: "@ds/react",
      exportName: "Button",
      path: [],
      stub: null,
      fromFile: "src/App.tsx",
      resolved: false,
    });
  });

  it("gives a library stub built from the reference for a stubbed package export", () => {
    const gb = builder({});
    gb.beginFile("src/App.tsx").addImport({ specifier: "react", imported: "memo", local: "memo", loc });
    const r = ref("memo");
    const b = bind(gb.build(), "src/App.tsx", r);
    expect(b).toMatchObject({ kind: "package-export", specifier: "react", exportName: "memo" });
    const stub = b.kind === "package-export" ? b.stub : null;
    expect(stub?.kind === "Function" && stub.returns[0]?.kind === "ParameterOf" && stub.returns[0].fn).toBe(r);
    expect(bindingValue(b)).toBe(stub);
  });

  it("gives unbound for a name neither declared nor imported", () => {
    const gb = builder({});
    gb.beginFile("src/App.tsx");
    expect(bind(gb.build(), "src/App.tsx", ref("Nothing"))).toEqual({ kind: "unbound" });
  });
});

describe("bindingIdentity", () => {
  const decl = { symbol: "Card", scope: MODULE_SCOPE, value: { kind: "JSX" as const }, loc, isExported: true };

  it("names a declaration local, carrying the declaration only when nothing is left on the path", () => {
    const bare: Binding = { kind: "declaration", file: "src/card.tsx", decl, member: null, path: [], inScope: false };
    expect(bindingIdentity(bare)).toEqual({ kind: "local", filePath: "src/card.tsx", export: "Card", declaration: decl });
    const member: Binding = { kind: "declaration", file: "src/card.tsx", decl, member: null, path: ["Header", "Title"], inScope: true };
    expect(bindingIdentity(member)).toEqual({ kind: "local", filePath: "src/card.tsx", export: "Card.Header.Title" });
  });

  it("names a static member under its holder, carrying no declaration, and values it by the member", () => {
    const header = { name: "Header", value: { kind: "Str" as const, value: "h" }, loc };
    const bare: Binding = { kind: "declaration", file: "src/card.tsx", decl, member: header, path: [], inScope: false };
    expect(bindingIdentity(bare)).toEqual({ kind: "local", filePath: "src/card.tsx", export: "Card.Header" });
    expect(bindingValue(bare)).toEqual(header.value);
    const deeper: Binding = { ...bare, path: ["Title"] };
    expect(bindingIdentity(deeper)).toEqual({ kind: "local", filePath: "src/card.tsx", export: "Card.Header.Title" });
    expect(bindingValue(deeper)).toEqual({ kind: "MemberOf", obj: header.value, member: "Title" });
  });

  it("names a package export by the import as written, with no resolved file", () => {
    expect(
      bindingIdentity({ kind: "package-export", specifier: "@ds/react", exportName: "Dialog", path: ["Popup"], stub: null, fromFile: "src/App.tsx", resolved: true }),
    ).toEqual({ kind: "imported", specifier: "@ds/react", imported: "Dialog.Popup" });
  });

  it("names nothing for a failed import", () => {
    expect(bindingIdentity({ kind: "import-failed", specifier: "./missing", exportName: "Gone", path: [] })).toBeNull();
  });

  it("names an unparsed file local", () => {
    expect(bindingIdentity({ kind: "unparsed", file: "src/skip.tsx", exportName: "Panel", path: ["Body"] })).toEqual({
      kind: "local",
      filePath: "src/skip.tsx",
      export: "Panel.Body",
    });
  });

  it("names nothing for unbound and no-export", () => {
    expect(bindingIdentity({ kind: "unbound" })).toBeNull();
    expect(bindingIdentity({ kind: "no-export" })).toBeNull();
  });
});

describe("pinUnparsed", () => {
  /** Every path the host is asked about is first-party. */
  function graph(rld: string[]) {
    return builder({}).build({
      firstParty: () => true,
      resolveLocalDefinition: (abs, name) => {
        rld.push(`${abs}#${name}`);
        return abs.endsWith("index.ts") ? { absFile: "/repo/packages/card/src/Card.tsx", exportName: `${name}Impl` } : null;
      },
    });
  }

  it("pins a workspace member to the definition the host resolves, keeping the path", () => {
    const rld: string[] = [];
    const b: Binding = { kind: "unparsed", file: "/repo/packages/card/src/index.ts", exportName: "Card", path: ["Body"] };
    expect(pinUnparsed(graph(rld), b)).toEqual({
      kind: "unparsed",
      file: "/repo/packages/card/src/Card.tsx",
      exportName: "CardImpl",
      path: ["Body"],
    });
    expect(rld).toEqual(["/repo/packages/card/src/index.ts#Card"]);
  });

  it("keeps the resolved entry when the host finds no definition", () => {
    const rld: string[] = [];
    const b: Binding = { kind: "unparsed", file: "/repo/packages/card/src/entry.js", exportName: "Card", path: [] };
    expect(pinUnparsed(graph(rld), b)).toEqual(b);
    expect(rld).toEqual(["/repo/packages/card/src/entry.js#Card"]);
  });

  it("asks the host nothing for any other binding", () => {
    const rld: string[] = [];
    const g = graph(rld);
    const external: Binding = { kind: "package-export", specifier: "@ds/react", exportName: "Card", path: [], stub: null, fromFile: "src/App.tsx", resolved: true };
    const failed: Binding = { kind: "import-failed", specifier: "./missing", exportName: "Card", path: [] };
    for (const b of [external, failed, { kind: "unbound" } as Binding]) expect(pinUnparsed(g, b)).toBe(b);
    expect(rld).toEqual([]);
  });
});

describe("the identity a walk credits through bindingIdentity", () => {
  const identity = (graph: Graph, r: Reference) => bindingIdentity(bind(graph, "src/App.tsx", r));

  it("names nothing when the parsed target does not export the name", () => {
    const gb = builder({ "./x": "src/x.tsx", "@ws/x": "src/x.tsx" });
    const app = gb.beginFile("src/App.tsx");
    app.addImport({ specifier: "./x", imported: "Gone", local: "Gone", loc });
    app.addImport({ specifier: "@ws/x", imported: "Lost", local: "Lost", loc });
    gb.beginFile("src/x.tsx");
    const graph = gb.build();
    expect(identity(graph, ref("Gone"))).toBeNull();
    expect(identity(graph, ref("Lost", ["Item"]))).toBeNull();
  });

  it("names the package a barrel's aliased imported local leads to, under the package's export name", () => {
    const gb = builder({ "./ds": "src/ds.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./ds", imported: "Button", local: "Button", loc });
    const ds = gb.beginFile("src/ds.tsx");
    ds.addImport({ specifier: "@ds/react", imported: "Button", local: "B", loc });
    ds.addExport({ kind: "named", exportedAs: "Button", local: "B" });
    expect(identity(gb.build(), ref("Button"))).toEqual({ kind: "imported", specifier: "@ds/react", imported: "Button" });
  });

  it("names nothing for an `export … from` cycle", () => {
    const gb = builder({ "./a": "src/a.ts", "./b": "src/b.ts" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./a", imported: "X", local: "X", loc });
    gb.beginFile("src/a.ts").addExport({ kind: "named", exportedAs: "X", from: "./b", fromImported: "X" });
    gb.beginFile("src/b.ts").addExport({ kind: "named", exportedAs: "X", from: "./a", fromImported: "X" });
    expect(identity(gb.build(), ref("X"))).toBeNull();
  });

  it("names an unparsed workspace member reached through a barrel's `export … from` as a direct import does: pinned, else its resolved path", () => {
    const rld: string[] = [];
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => ({ "./barrel": "/repo/src/barrel.ts", "@ws/card": "/repo/packages/card/src/index.ts" })[spec] ?? null,
      repoRoot: "/repo",
    });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./barrel", imported: "Card", local: "Card", loc });
    gb.beginFile("src/barrel.ts").addExport({ kind: "named", exportedAs: "Card", from: "@ws/card", fromImported: "Card" });
    const graph = gb.build({
      firstParty: (abs) => abs.startsWith("/repo/packages/"),
      resolveLocalDefinition: (abs, name) => {
        rld.push(`${abs}#${name}`);
        return null;
      },
    });
    expect(walkedIdentity(graph, bind(graph, "src/App.tsx", ref("Card")))).toEqual({
      kind: "local",
      filePath: "/repo/packages/card/src/index.ts",
      export: "Card",
    });
    expect(rld).toEqual(["/repo/packages/card/src/index.ts#Card"]);
  });

  it("names a relative unparsed first-party file local, pinned to its definition", () => {
    const rld: string[] = [];
    const gb = builder({ "./skip": "/repo/src/skip.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./skip", imported: "Panel", local: "Panel", loc });
    const graph = gb.build({
      firstParty: () => true,
      resolveLocalDefinition: (abs, name) => {
        rld.push(`${abs}#${name}`);
        return { absFile: "/repo/src/panel.tsx", exportName: name };
      },
    });
    expect(walkedIdentity(graph, bind(graph, "src/App.tsx", ref("Panel")))).toEqual({ kind: "local", filePath: "/repo/src/panel.tsx", export: "Panel" });
    expect(rld).toEqual(["/repo/src/skip.tsx#Panel"]);
  });

  it("names nothing for a relative import the host does not call first-party", () => {
    const gb = builder({ "./skip": "/elsewhere/skip.tsx" });
    gb.beginFile("src/App.tsx").addImport({ specifier: "./skip", imported: "Panel", local: "Panel", loc });
    expect(identity(gb.build({ firstParty: () => false }), ref("Panel"))).toBeNull();
  });
});
