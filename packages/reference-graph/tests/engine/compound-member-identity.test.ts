import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type InferredType } from "../../src/index.js";
import { resolve } from "../../src/engine/index.js";
import { deriveIdentity } from "../../src/engine/wrapper-folding.js";
import { createDiagnosticCollector } from "../../src/diagnostics.js";

const JSX: InferredType = { kind: "JSX" };
const fn = (...returns: InferredType[]): InferredType => ({ kind: "Function", returns });
const at = (line: number) => ({ line, column: 1 });

describe("compound member identity: members with no reachable declaration", () => {
  it("an external named import rendered through a member mints `Holder.Member` on the package", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "pkg/dialog", imported: "Dialog", local: "DialogPrimitive", scope: MODULE_SCOPE, loc: at(1) });
    fb.addJsxUsage({ ref: { symbol: "DialogPrimitive", scope: MODULE_SCOPE, memberChain: ["Popup"], loc: at(2) }, loc: at(2), props: [] });
    const { occurrences } = resolve(gb.build());
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toEqual({
      kind: "react-component",
      export: "Dialog.Popup",
      source: { type: "external", package: "pkg", publicEntry: "dialog" },
    });
    // Provenance keeps the raw import statement.
    expect(occurrences[0]?.via).toMatchObject({ kind: "direct-import", import: "Dialog" });
  });

  it("a deeper member chain keeps every residual segment (`Dialog.Panel.Title`)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "pkg", imported: "Dialog", local: "Dialog", scope: MODULE_SCOPE, loc: at(1) });
    fb.addJsxUsage({ ref: { symbol: "Dialog", scope: MODULE_SCOPE, memberChain: ["Panel", "Title"], loc: at(2) }, loc: at(2), props: [] });
    const { occurrences } = resolve(gb.build());
    expect(occurrences[0]?.rawComponentId).toMatchObject({ export: "Dialog.Panel.Title", source: { type: "external", package: "pkg" } });
  });

  it("a namespace import consumes the first segment as the export and keeps the rest (`Root.Foo`)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "pkg", imported: "*", local: "Dialog", scope: MODULE_SCOPE, loc: at(1) });
    fb.addJsxUsage({ ref: { symbol: "Dialog", scope: MODULE_SCOPE, memberChain: ["Root", "Foo"], loc: at(2) }, loc: at(2), props: [] });
    fb.addJsxUsage({ ref: { symbol: "Dialog", scope: MODULE_SCOPE, memberChain: ["Root"], loc: at(3) }, loc: at(3), props: [] });
    const { occurrences } = resolve(gb.build());
    expect(occurrences.map((o) => o.rawComponentId?.kind === "react-component" ? o.rawComponentId.export : "")).toEqual(["Root.Foo", "Root"]);
  });

  it("a default-import holder mints `default.Member` and keeps the module path", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "pkg/Modal", imported: "default", local: "Modal", scope: MODULE_SCOPE, loc: at(1) });
    fb.addJsxUsage({ ref: { symbol: "Modal", scope: MODULE_SCOPE, memberChain: ["Header"], loc: at(2) }, loc: at(2), props: [] });
    const { occurrences } = resolve(gb.build());
    expect(occurrences[0]?.rawComponentId).toEqual({
      kind: "react-component",
      export: "default.Header",
      source: { type: "external", package: "pkg", publicEntry: "Modal" },
    });
  });

  it("an inline-function member of an object in another file mints `NS.Inline` on that file", () => {
    const repoRoot = "/repo";
    const resolver = (from: string, spec: string) => (spec === "./ns" && from === "/repo/src/consumer.tsx" ? "/repo/src/ns.tsx" : null);
    const gb = createGraphBuilder({ moduleResolver: resolver, repoRoot });

    const ns = gb.beginFile("src/ns.tsx");
    ns.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: fn(JSX) } }, loc: at(1), isExported: true });
    ns.addExport({ kind: "named", exportedAs: "NS", local: "NS" });

    const consumer = gb.beginFile("src/consumer.tsx");
    consumer.addImport({ specifier: "./ns", imported: "NS", local: "NS", scope: MODULE_SCOPE, loc: at(1) });
    consumer.addJsxUsage({ ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(2) }, loc: at(2), props: [] });

    const { occurrences } = resolve(gb.build());
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toEqual({
      kind: "react-component",
      export: "NS.Inline",
      source: { type: "local", filePath: "src/ns.tsx" },
    });
  });

  it("through a barrel, the compound name is pinned to the file that defines the object, not the barrel", () => {
    const repoRoot = "/repo";
    const resolver = (from: string, spec: string) => {
      if (spec === "./index" && from === "/repo/src/consumer.tsx") return "/repo/src/index.tsx";
      if (spec === "./ns" && from === "/repo/src/index.tsx") return "/repo/src/ns.tsx";
      return null;
    };
    const gb = createGraphBuilder({ moduleResolver: resolver, repoRoot });
    const ns = gb.beginFile("src/ns.tsx");
    ns.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: fn(JSX) } }, loc: at(1), isExported: true });
    ns.addExport({ kind: "named", exportedAs: "NS", local: "NS" });
    const barrel = gb.beginFile("src/index.tsx");
    barrel.addExport({ kind: "named", exportedAs: "NS", from: "./ns", fromImported: "NS" });
    const consumer = gb.beginFile("src/consumer.tsx");
    consumer.addImport({ specifier: "./index", imported: "NS", local: "NS", scope: MODULE_SCOPE, loc: at(1) });
    consumer.addJsxUsage({ ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(2) }, loc: at(2), props: [] });
    const { occurrences } = resolve(gb.build());
    expect(occurrences[0]?.rawComponentId).toEqual({
      kind: "react-component",
      export: "NS.Inline",
      source: { type: "local", filePath: "src/ns.tsx" },
    });
  });

  it("an inline-function member of an object in the same file mints `NS.Inline` on that file", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: fn(JSX) } }, loc: at(1), isExported: true });
    fb.addJsxUsage({ ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(2) }, loc: at(2), props: [] });
    const { occurrences } = resolve(gb.build());
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toEqual({
      kind: "react-component",
      export: "NS.Inline",
      source: { type: "local", filePath: "src/App.tsx" },
    });
    expect(occurrences[0]?.via).toEqual({ kind: "local-component" });
  });

  it("a member that references a declaration resolves to that declaration's own row", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({ symbol: "Root", value: fn(JSX), loc: at(1), isExported: false });
    fb.addDeclaration({
      symbol: "NS",
      value: { kind: "Object", props: { Root: { kind: "TypeOf", ref: { symbol: "Root", scope: MODULE_SCOPE, memberChain: [], loc: at(1), originFile: "src/App.tsx" } } } },
      loc: at(2),
      isExported: true,
    });
    fb.addJsxUsage({ ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Root"], loc: at(3) }, loc: at(3), props: [] });
    const { occurrences } = resolve(gb.build());
    expect(occurrences[0]?.rawComponentId).toMatchObject({ export: "Root", source: { type: "local", filePath: "src/App.tsx" } });
  });

  it("a member whose value is not component-shaped (`Config.Title` → string) emits nothing", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({ symbol: "Config", value: { kind: "Object", props: { Title: { kind: "Str", value: "x" } } }, loc: at(1), isExported: true });
    fb.addJsxUsage({ ref: { symbol: "Config", scope: MODULE_SCOPE, memberChain: ["Title"], loc: at(2) }, loc: at(2), props: [] });
    expect(resolve(gb.build()).occurrences).toHaveLength(0);
  });

  it("deriveIdentity derives the compound name for an import-backed TypeOf with a residual chain, as the direct path does", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "pkg", imported: "Dialog", local: "Dialog", scope: MODULE_SCOPE, loc: at(1) });
    const graph = gb.build();
    const fileGraph = graph.files.get("src/App.tsx")!;
    const composed = deriveIdentity(
      { kind: "TypeOf", ref: { symbol: "Dialog", scope: MODULE_SCOPE, memberChain: ["Popup"], loc: at(3) } },
      fileGraph,
      graph,
    );
    expect(composed).toEqual({ kind: "imported", specifier: "pkg", imported: "Dialog.Popup" });
    const bare = deriveIdentity(
      { kind: "TypeOf", ref: { symbol: "Dialog", scope: MODULE_SCOPE, memberChain: [], loc: at(3) } },
      fileGraph,
      graph,
    );
    expect(bare).toEqual({ kind: "imported", specifier: "pkg", imported: "Dialog" });
  });

  it("deriveIdentity appends the residual to a local declaration: `NS.Inline` on a same-file object namespace", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: fn(JSX) } }, loc: at(1), isExported: true });
    const graph = gb.build();
    const fileGraph = graph.files.get("src/App.tsx")!;
    const composed = deriveIdentity(
      { kind: "TypeOf", ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(3) } },
      fileGraph,
      graph,
    );
    expect(composed).toEqual({ kind: "local", filePath: "src/App.tsx", export: "NS.Inline" });
    const bare = deriveIdentity(
      { kind: "TypeOf", ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: [], loc: at(3) } },
      fileGraph,
      graph,
    );
    expect(bare).toEqual({ kind: "local", filePath: "src/App.tsx", export: "NS", declaration: expect.objectContaining({ symbol: "NS" }) });
  });

  it("a direct render and an opaque-wrapper argument of the same member converge, and the holder name never leaks", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "pkg", imported: "wrap", local: "wrap", scope: MODULE_SCOPE, loc: at(1) });
    fb.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: fn(JSX) } }, loc: at(2), isExported: true });
    fb.addDeclaration({
      symbol: "Wrapped",
      value: {
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { symbol: "wrap", scope: MODULE_SCOPE, memberChain: [], loc: at(1) } },
        args: [{ kind: "TypeOf", ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(2) } }],
      },
      loc: at(3),
      isExported: true,
    });
    fb.addJsxUsage({ ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(4) }, loc: at(4), props: [] });
    const { occurrences } = resolve(gb.build());
    const reactOccs = occurrences.filter((o) => o.rawComponentId?.kind === "react-component");
    expect(reactOccs.length).toBeGreaterThan(0);
    // The holder's bare name never appears as an identity: every occurrence
    // of the member is `NS.Inline`, never `NS`.
    for (const occ of reactOccs) {
      expect(occ.rawComponentId).not.toMatchObject({ export: "NS" });
    }
    expect(reactOccs.some((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "NS.Inline")).toBe(true);
  });
});

describe("an unbound JSX root", () => {
  it("observes each as an unresolved `unbound-name` occurrence naming the root, and reports nothing", () => {
    const collector = createDiagnosticCollector();
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addJsxUsage({ ref: { symbol: "Disclosure", scope: MODULE_SCOPE, memberChain: ["Button"], loc: { line: 7, column: 5 } }, loc: { line: 7, column: 5 }, props: [] });
    fb.addJsxUsage({ ref: { symbol: "Ghost", scope: MODULE_SCOPE, memberChain: [], loc: { line: 9, column: 3 } }, loc: { line: 9, column: 3 }, props: [] });
    const { occurrences } = resolve(gb.build(), { collector });
    expect(occurrences.map((o) => [o.line, o.unresolved])).toEqual([
      [7, { kind: "unbound-name", name: "Disclosure" }],
      [9, { kind: "unbound-name", name: "Ghost" }],
    ]);
    expect(collector.drain()).toEqual([]);
  });

  it("is silent without a collector, and silent for a bound root", () => {
    const collector = createDiagnosticCollector();
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addDeclaration({ symbol: "Local", value: fn(JSX), loc: at(1), isExported: true });
    fb.addJsxUsage({ ref: { symbol: "Local", scope: MODULE_SCOPE, memberChain: [], loc: at(2) }, loc: at(2), props: [] });
    expect(resolve(gb.build(), { collector }).occurrences).toHaveLength(1);
    expect(collector.drain()).toEqual([]);
  });

  it("host elements are not unresolved: bare lowercase roots stay silent, an unbound member chain on a lowercase root is still observed", () => {
    const collector = createDiagnosticCollector();
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    for (const [i, symbol] of ["div", "svg"].entries()) {
      fb.addJsxUsage({ ref: { symbol, scope: MODULE_SCOPE, memberChain: [], loc: at(i + 1) }, loc: at(i + 1), props: [] });
    }
    fb.addJsxUsage({ ref: { symbol: "motion", scope: MODULE_SCOPE, memberChain: ["div"], loc: at(9) }, loc: at(9), props: [] });
    const { occurrences } = resolve(gb.build(), { collector });
    expect(occurrences.map((o) => [o.line, o.unresolved])).toEqual([[9, { kind: "unbound-name", name: "motion" }]]);
    expect(collector.drain()).toEqual([]);
  });
});

describe("compound member identity: workspace member arms", () => {
  it("workspace sibling, in graph: a named import resolving to an in-graph sibling mints `NS.Inline` pinned to the sibling file", () => {
    const repoRoot = "/repo";
    const resolver = (_from: string, spec: string) => (spec === "@f/ui" ? "/repo/packages/ui/src/index.tsx" : null);
    const gb = createGraphBuilder({ moduleResolver: resolver, repoRoot });

    const ui = gb.beginFile("packages/ui/src/index.tsx");
    ui.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: fn(JSX) } }, loc: at(1), isExported: true });
    ui.addExport({ kind: "named", exportedAs: "NS", local: "NS" });

    const app = gb.beginFile("src/App.tsx");
    app.addImport({ specifier: "@f/ui", imported: "NS", local: "NS", scope: MODULE_SCOPE, loc: at(1) });
    app.addJsxUsage({ ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(2) }, loc: at(2), props: [] });

    const { occurrences } = resolve(gb.build());
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toEqual({
      kind: "react-component",
      export: "NS.Inline",
      source: { type: "local", filePath: "packages/ui/src/index.tsx" },
    });
  });

  it("unparsed workspace member: a resolved-but-out-of-graph package pins the compound identity to resolveLocalDefinition's absFile", () => {
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "@f/ui" ? "/repo/packages/ui/dist/index.js" : null),
    });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "@f/ui", imported: "NS", local: "NS", scope: MODULE_SCOPE, loc: at(1) });
    fb.addJsxUsage({ ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(2) }, loc: at(2), props: [] });
    const graph = gb.build({
      firstParty: () => true,
      resolveLocalDefinition: () => ({ absFile: "/repo/packages/ui/src/ns.tsx", exportName: "NS" }),
    });
    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toEqual({
      kind: "react-component",
      export: "NS.Inline",
      source: { type: "local", filePath: "/repo/packages/ui/src/ns.tsx" },
    });
  });

  it("deriveIdentity composes a residual chain onto an in-graph workspace sibling's local identity", () => {
    const repoRoot = "/repo";
    const resolver = (_from: string, spec: string) => (spec === "@f/ui" ? "/repo/packages/ui/src/index.tsx" : null);
    const gb = createGraphBuilder({ moduleResolver: resolver, repoRoot });

    const ui = gb.beginFile("packages/ui/src/index.tsx");
    ui.addDeclaration({ symbol: "NS", value: { kind: "Object", props: { Inline: fn(JSX) } }, loc: at(1), isExported: true });
    ui.addExport({ kind: "named", exportedAs: "NS", local: "NS" });

    const app = gb.beginFile("src/App.tsx");
    app.addImport({ specifier: "@f/ui", imported: "NS", local: "NS", scope: MODULE_SCOPE, loc: at(1) });

    const graph = gb.build();
    const appFileGraph = graph.files.get("src/App.tsx")!;
    const composed = deriveIdentity(
      { kind: "TypeOf", ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(3) } },
      appFileGraph,
      graph,
    );
    expect(composed).toEqual({ kind: "local", filePath: "packages/ui/src/index.tsx", export: "NS.Inline" });
    const bare = deriveIdentity(
      { kind: "TypeOf", ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: [], loc: at(3) } },
      appFileGraph,
      graph,
    );
    expect(bare).toEqual({ kind: "local", filePath: "packages/ui/src/index.tsx", export: "NS", declaration: expect.objectContaining({ symbol: "NS" }) });
  });

  it("deriveIdentity composes a residual chain onto an unparsed workspace member's pinned local identity", () => {
    const gb = createGraphBuilder({
      moduleResolver: (_from, spec) => (spec === "@f/ui" ? "/repo/packages/ui/dist/index.js" : null),
    });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "@f/ui", imported: "NS", local: "NS", scope: MODULE_SCOPE, loc: at(1) });
    const graph = gb.build({
      firstParty: () => true,
      resolveLocalDefinition: () => ({ absFile: "/repo/packages/ui/src/ns.tsx", exportName: "NS" }),
    });
    const appFileGraph = graph.files.get("src/App.tsx")!;
    const composed = deriveIdentity(
      { kind: "TypeOf", ref: { symbol: "NS", scope: MODULE_SCOPE, memberChain: ["Inline"], loc: at(3) } },
      appFileGraph,
      graph,
    );
    expect(composed).toEqual({ kind: "local", filePath: "/repo/packages/ui/src/ns.tsx", export: "NS.Inline" });
  });
});
