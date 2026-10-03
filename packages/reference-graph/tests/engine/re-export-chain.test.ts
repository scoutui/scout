import { describe, it, expect } from "vitest";
import { createGraphBuilder } from "../../src/index.js";
import { followReExportChain } from "../../src/engine/re-export-chain.js";

/**
 * Builds a graph from a map of filePath → exports. The module resolver
 * matches by exact file path, standing in for `createImportResolver`.
 */
type FileSpec = {
  exports: Array<
    | { kind: "named"; exportedAs: string; local: string }
    | { kind: "named"; exportedAs: string; from: string; fromImported: string }
    | { kind: "default"; local: string }
    | { kind: "star"; from: string }
  >;
  imports?: Array<{ specifier: string; imported: string; local: string }>;
};

function buildGraph(files: Record<string, FileSpec>) {
  const gb = createGraphBuilder({
    moduleResolver: (_importer, specifier) => {
      // Strip leading "./" and resolve against the importer's directory.
      // For these tests, all files live at the root, so specifier → "specifier" key.
      const stripped = specifier.replace(/^\.\//, "");
      return files[stripped] !== undefined ? stripped : null;
    },
  });
  for (const [file, spec] of Object.entries(files)) {
    const fb = gb.beginFile(file);
    for (const imp of spec.imports ?? []) {
      fb.addImport({ specifier: imp.specifier, imported: imp.imported, local: imp.local, loc: { line: 1, column: 1 } });
    }
    for (const e of spec.exports) {
      if (e.kind === "named" && "local" in e) {
        fb.addDeclaration({ symbol: e.local, value: { kind: "JSX" }, loc: { line: 1, column: 1 }, isExported: true });
      }
    }
    for (const exp of spec.exports) fb.addExport(exp);
  }
  return gb.build();
}

describe("followReExportChain: named + star resolution", () => {
  it("resolves a single-level named re-export to the canonical source", () => {
    const graph = buildGraph({
      "barrel.ts": { exports: [{ kind: "named", exportedAs: "X", from: "./leaf.ts", fromImported: "X" }] },
      "leaf.ts": { exports: [{ kind: "named", exportedAs: "X", local: "X" }] },
    });
    expect(followReExportChain(graph, "barrel.ts", "X", [])).toEqual({ file: "leaf.ts", localExport: "X", path: [] });
  });

  it("resolves a single-level star re-export to the canonical source", () => {
    const graph = buildGraph({
      "barrel.ts": { exports: [{ kind: "star", from: "./leaf.ts" }] },
      "leaf.ts": { exports: [{ kind: "named", exportedAs: "X", local: "X" }] },
    });
    expect(followReExportChain(graph, "barrel.ts", "X", [])).toEqual({ file: "leaf.ts", localExport: "X", path: [] });
  });

  it("resolves a multi-level star chain to the deepest canonical source", () => {
    const graph = buildGraph({
      "barrel.ts": { exports: [{ kind: "star", from: "./mid.ts" }] },
      "mid.ts": { exports: [{ kind: "star", from: "./leaf.ts" }] },
      "leaf.ts": { exports: [{ kind: "named", exportedAs: "X", local: "X" }] },
    });
    expect(followReExportChain(graph, "barrel.ts", "X", [])).toEqual({ file: "leaf.ts", localExport: "X", path: [] });
  });

  it("prefers a named hit over star-fallback at the same hop", () => {
    const graph = buildGraph({
      "barrel.ts": {
        exports: [
          { kind: "named", exportedAs: "X", from: "./a.ts", fromImported: "X" },
          { kind: "star", from: "./b.ts" },
        ],
      },
      "a.ts": { exports: [{ kind: "named", exportedAs: "X", local: "X" }] },
      "b.ts": { exports: [{ kind: "named", exportedAs: "X", local: "X_via_star" }] },
    });
    // Named hit at barrel → recurse into a.ts, where X is local → {a.ts, X}.
    expect(followReExportChain(graph, "barrel.ts", "X", [])).toEqual({ file: "a.ts", localExport: "X", path: [] });
  });

  it("first-wins among multiple star branches that all resolve the same symbol", () => {
    const graph = buildGraph({
      "barrel.ts": {
        exports: [
          { kind: "star", from: "./a.ts" },
          { kind: "star", from: "./b.ts" },
        ],
      },
      "a.ts": { exports: [{ kind: "named", exportedAs: "X", local: "X" }] },
      "b.ts": { exports: [{ kind: "named", exportedAs: "X", local: "X" }] },
    });
    expect(followReExportChain(graph, "barrel.ts", "X", [])).toEqual({ file: "a.ts", localExport: "X", path: [] });
  });

  it("returns null on a mutual `export *` cycle when the symbol is nowhere", () => {
    const graph = buildGraph({
      "a.ts": { exports: [{ kind: "star", from: "./b.ts" }] },
      "b.ts": { exports: [{ kind: "star", from: "./a.ts" }] },
    });
    expect(followReExportChain(graph, "a.ts", "Nonexistent", [])).toBeNull();
  });

  it("returns null when a star branch's source can't be resolved", () => {
    const graph = buildGraph({
      "barrel.ts": { exports: [{ kind: "star", from: "./missing.ts" }] },
    });
    expect(followReExportChain(graph, "barrel.ts", "X", [])).toBeNull();
  });

  /** barrel.ts and a.ts with the given `export *` entries. `@example/one` and
   *  `@example/two` resolve under node_modules, which is not first-party. */
  const starGraph = (barrel: Array<{ kind: "star"; from: string }>, a: Array<{ kind: "star"; from: string }> = []) => {
    const targets: Record<string, string> = {
      "./a.ts": "a.ts",
      "@example/one": "node_modules/@example/one/index.js",
      "@example/two": "node_modules/@example/two/index.js",
    };
    const gb = createGraphBuilder({ moduleResolver: (_i, s) => targets[s] ?? null });
    const barrelFile = gb.beginFile("barrel.ts");
    for (const exp of barrel) barrelFile.addExport(exp);
    const aFile = gb.beginFile("a.ts");
    for (const exp of a) aFile.addExport(exp);
    return gb.build({ firstParty: (abs) => !abs.startsWith("node_modules/") });
  };

  it("returns null when `export *` of two packages could hold the name, one of them in a star source", () => {
    const graph = starGraph(
      [
        { kind: "star", from: "./a.ts" },
        { kind: "star", from: "@example/two" },
      ],
      [{ kind: "star", from: "@example/one" }],
    );
    expect(followReExportChain(graph, "barrel.ts", "X", [])).toBeNull();
  });

  it("returns null for `default` through a package's `export *`, which doesn't re-export it", () => {
    const graph = starGraph([{ kind: "star", from: "@example/one" }]);
    expect(followReExportChain(graph, "barrel.ts", "default", [])).toBeNull();
  });
});

describe("followReExportChain: barrel re-wrap of an imported local", () => {
  it("follows `import X from './x'; export default X` to the leaf", () => {
    const graph = buildGraph({
      "index.ts": {
        imports: [{ specifier: "./seo.ts", imported: "default", local: "Seo" }],
        exports: [{ kind: "default", local: "Seo" }],
      },
      "seo.ts": { exports: [{ kind: "default", local: "Seo" }] },
    });
    expect(followReExportChain(graph, "index.ts", "default", [])).toEqual({ file: "seo.ts", localExport: "Seo", path: [] });
  });

  it("follows `import { X } from './x'; export { X }` to the leaf", () => {
    const graph = buildGraph({
      "index.ts": {
        imports: [{ specifier: "./widget.ts", imported: "Widget", local: "Widget" }],
        exports: [{ kind: "named", exportedAs: "Widget", local: "Widget" }],
      },
      "widget.ts": { exports: [{ kind: "named", exportedAs: "Widget", local: "Widget" }] },
    });
    expect(followReExportChain(graph, "index.ts", "Widget", [])).toEqual({ file: "widget.ts", localExport: "Widget", path: [] });
  });

  it("follows `import X from './x'; export { X as default }` to the leaf", () => {
    const graph = buildGraph({
      "index.ts": {
        imports: [{ specifier: "./seo.ts", imported: "default", local: "Seo" }],
        exports: [{ kind: "named", exportedAs: "default", local: "Seo" }],
      },
      "seo.ts": { exports: [{ kind: "default", local: "Seo" }] },
    });
    expect(followReExportChain(graph, "index.ts", "default", [])).toEqual({ file: "seo.ts", localExport: "Seo", path: [] });
  });

  it("follows a multi-hop barrel → barrel → impl re-wrap", () => {
    const graph = buildGraph({
      "index.ts": {
        imports: [{ specifier: "./mid.ts", imported: "default", local: "Seo" }],
        exports: [{ kind: "default", local: "Seo" }],
      },
      "mid.ts": {
        imports: [{ specifier: "./seo.ts", imported: "default", local: "Seo" }],
        exports: [{ kind: "default", local: "Seo" }],
      },
      "seo.ts": { exports: [{ kind: "default", local: "Seo" }] },
    });
    expect(followReExportChain(graph, "index.ts", "default", [])).toEqual({ file: "seo.ts", localExport: "Seo", path: [] });
  });

  it("stays at the barrel for a bare-package re-wrap", () => {
    const graph = buildGraph({
      "index.ts": {
        imports: [{ specifier: "@ds/seo", imported: "default", local: "Seo" }],
        exports: [{ kind: "default", local: "Seo" }],
      },
    });
    expect(followReExportChain(graph, "index.ts", "default", [])).toEqual({ file: "index.ts", localExport: "Seo", path: [] });
  });

  it("stays at the barrel when the re-wrapped specifier does not resolve", () => {
    const graph = buildGraph({
      "index.ts": {
        imports: [{ specifier: "./gone.ts", imported: "default", local: "Seo" }],
        exports: [{ kind: "default", local: "Seo" }],
      },
    });
    // moduleResolver returns null for "./gone.ts" (not in files) → nextKey null.
    expect(followReExportChain(graph, "index.ts", "default", [])).toEqual({ file: "index.ts", localExport: "Seo", path: [] });
  });

  it("advances to an unparsed key on a lazy graph (bounded resolver opt-in)", () => {
    // lazyReExportResolution: true, and the leaf resolves but was never
    // parsed. The walk returns a terminal keyed on the unparsed leaf so the
    // resolver's parse-and-retry loop can advance to it.
    const gb = createGraphBuilder({
      moduleResolver: (_i, s) => (s === "./seo.ts" ? "seo.ts" : null),
      lazyReExportResolution: true,
    });
    const fb = gb.beginFile("index.ts");
    fb.addImport({ specifier: "./seo.ts", imported: "default", local: "Seo", loc: { line: 1, column: 1 } });
    fb.addExport({ kind: "default", local: "Seo" });
    const graph = gb.build(); // "seo.ts" deliberately never begun
    expect(followReExportChain(graph, "index.ts", "default", [])).toEqual({ file: "seo.ts", localExport: "default", path: [] });
  });

  it("keeps the barrel terminal for an out-of-scope target on a complete graph (no repoRoot, no flag)", () => {
    // A complete graph, built without repoRoot and without the lazy flag.
    // The leaf resolves but is out of scan scope (never parsed), so the walk
    // keeps the barrel terminal instead of splitting onto a "default"/leaf id.
    const gb = createGraphBuilder({
      moduleResolver: (_i, s) => (s === "./excluded.ts" ? "excluded.ts" : null),
    });
    const fb = gb.beginFile("index.ts");
    fb.addImport({ specifier: "./excluded.ts", imported: "default", local: "Seo", loc: { line: 1, column: 1 } });
    fb.addExport({ kind: "default", local: "Seo" });
    const graph = gb.build(); // "excluded.ts" resolves but is never begun; flag defaults false
    expect(followReExportChain(graph, "index.ts", "default", [])).toEqual({ file: "index.ts", localExport: "Seo", path: [] });
  });

  it.each([
    { source: 'import * as NS from "./seo.ts"; export { NS }', form: "import", specifier: "./seo.ts" },
    { source: 'export * as NS from "./seo.ts"', form: "export-from", specifier: "./seo.ts" },
    { source: 'import * as NS from "@example/ui"; export { NS }', form: "import", specifier: "@example/ui" },
    { source: 'export * as NS from "@example/ui"', form: "export-from", specifier: "@example/ui" },
  ])("stays at the barrel for a namespace re-export followed with no member: $source", ({ form, specifier }) => {
    const gb = createGraphBuilder({
      moduleResolver: (_i, s) => (s === "./seo.ts" ? "seo.ts" : s === "@example/ui" ? "node_modules/@example/ui/index.js" : null),
    });
    const fb = gb.beginFile("index.ts");
    if (form === "import") {
      fb.addImport({ specifier, imported: "*", local: "NS", loc: { line: 1, column: 1 } });
      fb.addExport({ kind: "named", exportedAs: "NS", local: "NS" });
    } else {
      fb.addExport({ kind: "named", exportedAs: "NS", from: specifier, fromImported: "*" });
    }
    gb.beginFile("seo.ts").addExport({ kind: "named", exportedAs: "Seo", local: "Seo" });
    const graph = gb.build({ firstParty: (abs) => abs === "seo.ts" });
    expect(followReExportChain(graph, "index.ts", "NS", [])).toEqual({ file: "index.ts", localExport: "NS", path: [] });
  });

  it("leaves a locally-defined default export untouched", () => {
    const graph = buildGraph({
      "seo.ts": { exports: [{ kind: "default", local: "Seo" }] },
    });
    expect(followReExportChain(graph, "seo.ts", "default", [])).toEqual({ file: "seo.ts", localExport: "Seo", path: [] });
  });
});
