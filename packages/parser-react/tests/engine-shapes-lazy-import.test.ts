/**
 * Lazy-import credit on real parser output: a lazy wrapper credits the
 * component the import() resolves to, wherever the wrapper is rendered.
 */
import { describe, it, expect } from "vitest";
import { MODULE_SCOPE, createDiagnosticCollector } from "@scoutui/reference-graph";
import { scan, scanGraph, pathResolver, idsOf, buildGraph, lineOf, columnOf } from "./shape-helpers.js";

const DECLINED_DETAIL = "the import() target could not be resolved to a component";

const REPO = "/repo";
type Occs = ReturnType<typeof scan>;
const inFile = (occs: Occs, filePath: string) => occs.filter((o) => o.filePath === filePath);
const byExport = (rows: ReturnType<typeof idsOf>) =>
  [...rows].sort((a, b) => (a.export ?? "").localeCompare(b.export ?? ""));
/** Hop kinds per occurrence, outermost first (`via` is only `viaChain[0]`). */
const chainKinds = (occs: Occs, filePath: string) =>
  inFile(occs, filePath).map((o) => o.viaChain.map((v) => v.kind));

const TWO_FOLDER_FILES = {
  "src/views/card.jsx": "export const Card = () => <div>card</div>;",
  "src/views/banner.jsx": "const Banner = () => <div>banner</div>; export default Banner;",
  "src/loaders/lazy-components.js": `
    import { lazy } from "react";
    import dynamic from "next/dynamic";
    export const LazyCard = dynamic(() => import("../views/card.jsx").then((mod) => mod.Card));
    export const LazyBanner = lazy(() => import("../views/banner.jsx"));
  `,
  "src/loaders/same-folder-page.jsx": `
    import { LazyCard, LazyBanner } from "./lazy-components.js";
    export const SameFolderPage = () => <div><LazyCard /><LazyBanner /></div>;
  `,
  "src/pages/settings/settings-page.jsx": `
    import { LazyCard, LazyBanner } from "../../loaders/lazy-components.js";
    export const SettingsPage = () => <div><LazyCard /><LazyBanner /></div>;
  `,
};

const EXPECTED_ROWS = [
  { export: "Banner", package: undefined, filePath: "src/views/banner.jsx", via: "direct-import" },
  { export: "Card", package: undefined, filePath: "src/views/card.jsx", via: "direct-import" },
];

describe("lazy target bound at the declaring file", () => {
  it("a wrapper rendered from its own folder credits the resolved view", () => {
    const occs = scan(TWO_FOLDER_FILES, pathResolver(REPO), REPO);
    expect(byExport(idsOf(inFile(occs, "src/loaders/same-folder-page.jsx")))).toEqual(EXPECTED_ROWS);
    for (const kinds of chainKinds(occs, "src/loaders/same-folder-page.jsx")) {
      expect(kinds).toContain("lazy-import");
    }
  });

  it("the same wrapper rendered from another folder credits the same view, not a relative path", () => {
    const occs = scan(TWO_FOLDER_FILES, pathResolver(REPO), REPO);
    expect(byExport(idsOf(inFile(occs, "src/pages/settings/settings-page.jsx")))).toEqual(EXPECTED_ROWS);
    for (const kinds of chainKinds(occs, "src/pages/settings/settings-page.jsx")) {
      expect(kinds).toContain("lazy-import");
    }
  });

  it("no identity anywhere in the scan points at a file the fixture does not have", () => {
    const occs = scan(TWO_FOLDER_FILES, pathResolver(REPO), REPO);
    expect(occs.length).toBe(4);
    for (const row of idsOf(occs)) {
      if (row.filePath !== undefined) expect(Object.keys(TWO_FOLDER_FILES)).toContain(row.filePath);
    }
  });
});

const CHAIN_FILES = {
  "src/card.jsx": "export const Card = () => <div>card</div>; export default Card;",
  "src/app.jsx": `
    import { lazy } from "react";
    import dynamic from "next/dynamic";
    const logError = (e) => e;
    const Plain = dynamic(() => import("./card.jsx").then((mod) => mod.Card));
    const Caught = dynamic(() => import("./card.jsx").then((mod) => mod.Card).catch(logError));
    const Finished = dynamic(() => import("./card.jsx").then((mod) => mod.Card).finally(logError));
    const LazyCaught = lazy(() => import("./card.jsx").catch(logError));
    export const App = () => <div><Plain /><Caught /><Finished /><LazyCaught /></div>;
  `,
};

const HELD_FILES = {
  "src/card.jsx": "export const Card = () => <div>card</div>; export default Card;",
  "src/held.jsx": `
    import { lazy } from "react";
    const logError = (e) => e;
    const held = import("./card.jsx").then((mod) => mod.Card);
    const Held = lazy(() => held.catch(logError));
    export const HeldPage = () => <div><Held /></div>;
  `,
};

const ADAPTER_FILES = {
  "src/card.jsx": "export const Card = () => <div>card</div>; export default Card;",
  "src/adapters.jsx": `
    import { lazy } from "react";
    import dynamic from "next/dynamic";
    const Adapted = lazy(() => import("./card.jsx").then((m) => ({ default: m.Card })));
    const Identity = dynamic(() => import("./card.jsx").then((mod) => mod));
    export const AdapterPage = () => <div><Adapted /><Identity /></div>;
  `,
};

describe("promise chains around import()", () => {
  it("the parser collapses .then/.catch/.finally chains into one DynamicImport with the projection", () => {
    const graph = buildGraph(CHAIN_FILES, pathResolver(REPO), REPO);
    const decls = graph.files.get("src/app.jsx")?.declarations;
    const declValue = (symbol: string) =>
      decls?.get(`${MODULE_SCOPE}::${symbol}`)?.value as { kind: string; args?: unknown[] };
    const thunkOf = (symbol: string) => {
      const v = declValue(symbol);
      const arg = (v as { args: Array<{ kind: string; returns?: unknown[] }> }).args[0];
      return arg?.returns?.[0];
    };
    expect(thunkOf("Plain")).toEqual({ kind: "DynamicImport", specifier: "./card.jsx", projection: ["Card"], originFile: "src/app.jsx" });
    expect(thunkOf("Caught")).toEqual({ kind: "DynamicImport", specifier: "./card.jsx", projection: ["Card"], originFile: "src/app.jsx" });
    expect(thunkOf("Finished")).toEqual({ kind: "DynamicImport", specifier: "./card.jsx", projection: ["Card"], originFile: "src/app.jsx" });
    expect(thunkOf("LazyCaught")).toEqual({ kind: "DynamicImport", specifier: "./card.jsx", projection: [], originFile: "src/app.jsx" });
  });

  it("all four wrappers credit Card", () => {
    const occs = scan(CHAIN_FILES, pathResolver(REPO), REPO);
    expect(occs).toHaveLength(4);
    const lazyOccs = occs.filter((o) => o.viaChain.some((v) => v.kind === "lazy-import"));
    expect(lazyOccs).toHaveLength(4);
    for (const o of lazyOccs) {
      expect(idsOf([o])[0]).toEqual({
        export: "Card",
        package: undefined,
        filePath: "src/card.jsx",
        via: "local-component",
      });
      expect(o.viaChain.map((v) => v.kind)).toEqual(["local-component", "lazy-import"]);
    }
  });

  it("a held import promise with a catch credits Card through the engine", () => {
    const graph = buildGraph(HELD_FILES, pathResolver(REPO), REPO);
    const thunk = (
      graph.files.get("src/held.jsx")?.declarations.get(`${MODULE_SCOPE}::Held`)?.value as {
        args: Array<{ returns?: Array<{ kind: string }> }>;
      }
    ).args[0]?.returns?.[0];
    // The parser declines a chain rooted in a held promise rather than an
    // `import()`, so the credit below can only come from the engine's descent.
    expect(thunk?.kind).toBe("ReturnTypeOf");

    const occs = scan(HELD_FILES, pathResolver(REPO), REPO);
    expect(occs).toHaveLength(1);
    expect(idsOf(occs)[0]).toEqual({
      export: "Card",
      package: undefined,
      filePath: "src/card.jsx",
      via: "local-component",
    });
    expect(occs[0]?.viaChain.map((v) => v.kind)).toEqual(["local-component", "lazy-import"]);
  });

  it("a named-export adapter projects the export it reads and an identity thunk projects nothing", () => {
    const graph = buildGraph(ADAPTER_FILES, pathResolver(REPO), REPO);
    const decls = graph.files.get("src/adapters.jsx")?.declarations;
    const thunkOf = (symbol: string) =>
      (
        decls?.get(`${MODULE_SCOPE}::${symbol}`)?.value as {
          args: Array<{ returns?: unknown[] }>;
        }
      ).args[0]?.returns?.[0];
    expect(thunkOf("Adapted")).toEqual({
      kind: "DynamicImport",
      specifier: "./card.jsx",
      projection: ["Card"],
      originFile: "src/adapters.jsx",
    });
    expect(thunkOf("Identity")).toEqual({
      kind: "DynamicImport",
      specifier: "./card.jsx",
      projection: [],
      originFile: "src/adapters.jsx",
    });
  });

  it("both adapter wrappers credit Card", () => {
    const occs = scan(ADAPTER_FILES, pathResolver(REPO), REPO);
    const rows = inFile(occs, "src/adapters.jsx");
    expect(rows).toHaveLength(2);
    for (const o of rows) {
      expect(idsOf([o])[0]).toEqual({
        export: "Card",
        package: undefined,
        filePath: "src/card.jsx",
        via: "local-component",
      });
      expect(o.viaChain.map((v) => v.kind)).toEqual(["local-component", "lazy-import"]);
    }
  });

  it("an async loader that awaits import() into a local and returns its member credits that export", () => {
    const files = {
      "src/x.jsx": "export const X = () => <div>x</div>;",
      "src/app.jsx": `
        import dynamic from "next/dynamic";
        const Shown = dynamic(async () => { const m = await import("./x.jsx"); return m.X; });
        export const App = () => <div><Shown /></div>;
      `,
    };
    const rows = inFile(scan(files, pathResolver(REPO), REPO), "src/app.jsx");
    expect(idsOf(rows)).toEqual([{ export: "X", package: undefined, filePath: "src/x.jsx", via: "local-component" }]);
    expect(rows[0]?.viaChain).toEqual([
      { kind: "local-component" },
      { kind: "lazy-import", wrapperCallee: "dynamic", specifier: "./x.jsx", import: "X" },
    ]);
  });
});

describe("a lazy shape the parser declines", () => {
  const app = `
    import dynamic from "next/dynamic";
    const Odd = dynamic(() => import("./card.jsx").then((mod) => mod.cards[0]));
    export const App = () => <div><Odd /></div>;
  `;
  const files = { "src/card.jsx": "export const Card = () => <div>card</div>;", "src/app.jsx": app };

  const lazyPage = `
    import { Odd } from "./lazy.jsx";
    export const LazyPage = () => <div><Odd /></div>;
  `;
  const importedFiles = {
    "src/card.jsx": "export const Card = () => <div>card</div>;",
    "src/lazy.jsx": `
    import dynamic from "next/dynamic";
    export const Odd = dynamic(() => import("./card.jsx").then((mod) => mod.cards[0]));
  `,
    "src/app.jsx": lazyPage,
  };

  it("emits lazy-import-unsupported at the render site and credits nothing", () => {
    const collector = createDiagnosticCollector();
    const occs = scan(files, pathResolver(REPO), REPO, { collector });
    expect(occs.filter((o) => o.viaChain.some((v) => v.kind === "lazy-import"))).toHaveLength(0);
    expect(collector.drain()).toEqual([
      {
        code: "lazy-import-unsupported",
        severity: "warning",
        filePath: "src/app.jsx",
        line: lineOf(app, "<Odd />"),
        column: columnOf(app, "<Odd />", "<Odd"),
        specifier: "./card.jsx",
        detail: DECLINED_DETAIL,
      },
    ]);
  });

  it("reports the same wrapper imported from another file, at the importing render site", () => {
    const collector = createDiagnosticCollector();
    const occs = scan(importedFiles, pathResolver(REPO), REPO, { collector });
    expect(occs.filter((o) => o.viaChain.some((v) => v.kind === "lazy-import"))).toHaveLength(0);
    expect(collector.drain()).toEqual([
      {
        code: "lazy-import-unsupported",
        severity: "warning",
        filePath: "src/app.jsx",
        line: lineOf(lazyPage, "<Odd />"),
        column: columnOf(lazyPage, "<Odd />", "<Odd"),
        specifier: "./card.jsx",
        detail: `${DECLINED_DETAIL} (declared in src/lazy.jsx)`,
      },
    ]);
  });

  const loaderFiles = (holder: string) => ({
    "src/quiet.jsx": "export const Quiet = () => null; export default Quiet;",
    "src/app.jsx": `import { lazy } from "react";\nimport { wait } from "kit";\n${holder}\nexport const App = () => <div><Shown /></div>;`,
  });

  it.each([
    ["an object literal", `const Shown = lazy(async () => ({ default: (await import("./quiet.jsx")).Quiet }));`],
    ["an array", `const Shown = lazy(() => Promise.all([import("./quiet.jsx"), wait(300)]).then(([m]) => m));`],
    ["a local binding", `const Shown = lazy(async () => { const m = await import("./quiet.jsx"); return { default: m.Quiet }; });`],
    ["a local loader", `const loadQuiet = () => import("./quiet.jsx");\nconst Shown = lazy(() => loadQuiet());`],
  ])("a declined loader holding an import() in %s credits neither its holder nor a hop naming it", (_label, holder) => {
    const occs = scan(loaderFiles(holder), pathResolver(REPO), REPO);
    expect(occs.filter((o) => (o.rawComponentId as { export?: string }).export === "Shown")).toEqual([]);
    expect(occs.filter((o) => o.viaChain.some((v) => v.kind === "hoc-wrapper" && v.import === "Shown"))).toEqual([]);
  });

  it.each([
    [
      "a held thunk",
      loaderFiles(`const load = async () => ({ default: (await import("./quiet.jsx")).Quiet });\nconst Shown = lazy(load);`),
    ],
    [
      "a local loader in the file that declares the holder",
      {
        "src/quiet.jsx": "export const Quiet = () => null; export default Quiet;",
        "src/holder.jsx": `import { lazy } from "react";\nconst loadQuiet = () => import("./quiet.jsx");\nexport const Shown = lazy(() => loadQuiet());`,
        "src/app.jsx": `import { Shown } from "./holder.jsx";\nexport const App = () => <div><Shown /></div>;`,
      },
    ],
  ])("a declined loader reached through %s is called, and the render credits nothing", (_label, files) => {
    expect(scan(files, pathResolver(REPO), REPO)).toEqual([]);
  });

  const OBJECT_LOADER = `async () => ({ default: (await import("./quiet.jsx")).Quiet })`;
  it.each([
    ["a static member of an object literal", `const loaders = { a: ${OBJECT_LOADER} };\nconst Shown = lazy(loaders.a);`, {}],
    [
      "a static member of an object literal, under dynamic()",
      `import dynamic from "next/dynamic";\nconst loaders = { a: ${OBJECT_LOADER} };\nconst Shown = dynamic(loaders.a);`,
      {},
    ],
    [
      "a dynamic member of an object literal of loaders",
      `const loaders = { a: ${OBJECT_LOADER}, b: ${OBJECT_LOADER} };\nconst key = globalThis.kind;\nconst Shown = lazy(loaders[key]);`,
      {},
    ],
    [
      "a static member of an imported object literal",
      `import { loaders } from "./loaders.jsx";\nconst Shown = lazy(loaders.a);`,
      { "src/loaders.jsx": `export const loaders = { a: ${OBJECT_LOADER} };` },
    ],
    ["a two-hop alias", `const load0 = ${OBJECT_LOADER};\nconst load = load0;\nconst Shown = lazy(load);`, {}],
    ["a capitalised two-hop alias", `const Load0 = ${OBJECT_LOADER};\nconst Load = Load0;\nconst Shown = lazy(Load);`, {}],
  ])("a declined loader reached through %s is called: no credit names the holder or the loader", (_label, holder, extra) => {
    const { occurrences, registry } = scanGraph({ ...loaderFiles(holder), ...extra }, pathResolver(REPO), REPO);
    const loaderNames = ["Shown", "loaders", "load", "load0", "Load", "Load0"];
    expect(occurrences.filter((o) => loaderNames.includes((o.rawComponentId as { export?: string }).export ?? ""))).toEqual([]);
    expect(occurrences.filter((o) => o.viaChain.some((v) => v.kind === "hoc-wrapper" && loaderNames.includes(v.import ?? "")))).toEqual([]);
    expect(registry.localEntries().filter((e) => loaderNames.includes(e.exportName))).toEqual([]);
  });

  it("a dynamic member of an object literal mixing a loader and a component is no loader: the map is walked at the tag", () => {
    const holder = `const Other = () => null;\nconst parts = { a: ${OBJECT_LOADER}, b: Other };\nconst key = globalThis.kind;\nconst Shown = lazy(parts[key]);`;
    const collector = createDiagnosticCollector();
    const occs = scan(loaderFiles(holder), pathResolver(REPO), REPO, { collector });
    expect(occs.map((o) => (o.rawComponentId as { export?: string }).export)).toContain("Other");
    expect(collector.drain()).toEqual([]);
  });

  it("reports lazy-import-unsupported for an import() inside an object literal the loader returns", () => {
    const holder = `const Shown = lazy(async () => ({ default: (await import("./quiet.jsx")).Quiet }));`;
    const collector = createDiagnosticCollector();
    scan(loaderFiles(holder), pathResolver(REPO), REPO, { collector });
    const app = loaderFiles(holder)["src/app.jsx"];
    expect(collector.drain()).toEqual([
      {
        code: "lazy-import-unsupported",
        severity: "warning",
        filePath: "src/app.jsx",
        line: lineOf(app, "<Shown />"),
        column: columnOf(app, "<Shown />", "<Shown"),
        specifier: "./quiet.jsx",
        detail: DECLINED_DETAIL,
      },
    ]);
  });
});

const chainOf = (o: Occs[number]) => o.viaChain.map((v) => v.kind).join(">");
const hasLazyHop = (o: Occs[number]) => o.viaChain.some((v) => v.kind === "lazy-import");

describe("a lazy wrapper over a pass-through product", () => {
  const files = {
    "src/card.jsx": "export const Card = () => <div>card</div>;",
    "src/card-enhanced.js": `
      import { connect } from "react-redux";
      import { Card } from "./card.jsx";
      const mapStateToProps = (s) => s;
      export const CardEnhanced = connect(mapStateToProps)(Card);
      export default CardEnhanced;
    `,
    "src/app.jsx": `
      import { lazy } from "react";
      import dynamic from "next/dynamic";
      import { CardEnhanced } from "./card-enhanced.js";
      const NextDynamicCard = dynamic(() => import("./card-enhanced.js").then((mod) => mod.CardEnhanced));
      const ReactLazyCard = lazy(() => import("./card-enhanced.js"));
      export const App = () => <div><CardEnhanced /><NextDynamicCard /><ReactLazyCard /></div>;
    `,
  };

  it("all three renders credit Card, the lazy ones through the same hop as the direct one", () => {
    const occs = scan(files, pathResolver(REPO), REPO);
    const rows = inFile(occs, "src/app.jsx");
    expect(idsOf(rows).map((r) => `${r.export}@${r.filePath}`)).toEqual([
      "Card@src/card.jsx",
      "Card@src/card.jsx",
      "Card@src/card.jsx",
    ]);
    expect(rows.map(chainOf).sort()).toEqual([
      "direct-import>hoc-wrapper",
      "local-component>lazy-import>hoc-wrapper",
      "local-component>lazy-import>hoc-wrapper",
    ]);
  });
});

describe("a lazy target that is a holder keeps its own identity", () => {
  const files = {
    "src/frame.jsx": "export const withFrame = (C) => (props) => <section><C {...props} /></section>;",
    "src/inner.jsx": "export const Inner = () => <div>inner</div>;",
    "src/panel.jsx": `
      import { withFrame } from "./frame.jsx";
      import { Inner } from "./inner.jsx";
      export const Panel = withFrame(Inner);
    `,
    "src/app.jsx": `
      import { lazy } from "react";
      import { Panel } from "./panel.jsx";
      const LazyPanel = lazy(() => import("./panel.jsx").then((mod) => mod.Panel));
      export const App = () => <div><Panel /><LazyPanel /></div>;
    `,
  };

  it("the lazy render credits exactly what the direct render credits", () => {
    const occs = inFile(scan(files, pathResolver(REPO), REPO), "src/app.jsx");
    const direct = occs.filter((o) => !hasLazyHop(o));
    const lazyRows = occs.filter(hasLazyHop);
    expect(direct).toHaveLength(1);
    expect(lazyRows).toHaveLength(1);
    expect(idsOf(direct)[0]).toEqual({
      export: "Panel",
      package: undefined,
      filePath: "src/panel.jsx",
      via: "direct-import",
    });
    expect(idsOf(lazyRows)[0]?.export).toBe(idsOf(direct)[0]?.export);
    expect(idsOf(lazyRows)[0]?.filePath).toBe(idsOf(direct)[0]?.filePath);
  });
});

describe("two components that lazily load each other", () => {
  const files = {
    "src/a.jsx": `
      import { lazy } from "react";
      const LazyB = lazy(() => import("./b.jsx"));
      const A = () => <div><LazyB /></div>;
      export default A;
    `,
    "src/b.jsx": `
      import { lazy } from "react";
      const LazyA = lazy(() => import("./a.jsx"));
      const B = () => <div><LazyA /></div>;
      export default B;
    `,
    "src/app.jsx": `
      import A from "./a.jsx";
      export const App = () => <A />;
    `,
  };

  it("terminates and credits each side once", () => {
    const occs = scan(files, pathResolver(REPO), REPO);
    expect(idsOf(inFile(occs, "src/a.jsx"))).toEqual([
      { export: "B", package: undefined, filePath: "src/b.jsx", via: "local-component" },
    ]);
    expect(idsOf(inFile(occs, "src/b.jsx"))).toEqual([
      { export: "A", package: undefined, filePath: "src/a.jsx", via: "local-component" },
    ]);
    for (const o of [...inFile(occs, "src/a.jsx"), ...inFile(occs, "src/b.jsx")]) {
      expect(o.viaChain.map((v) => v.kind)).toContain("lazy-import");
    }
  });
});

describe("two lazy wrappers that lazily load each other", () => {
  const files = {
    "src/a.jsx": `
      import { lazy } from "react";
      const A = lazy(() => import("./b.jsx"));
      export default A;
    `,
    "src/b.jsx": `
      import { lazy } from "react";
      const B = lazy(() => import("./a.jsx"));
      export default B;
    `,
    "src/app.jsx": `
      import A from "./a.jsx";
      export const App = () => <A />;
    `,
  };

  it("terminates on the import cycle key and emits one row", () => {
    const occs = scan(files, pathResolver(REPO), REPO);
    const rows = inFile(occs, "src/app.jsx");
    expect(rows).toHaveLength(1);
    expect(idsOf(rows)).toEqual([
      { export: "A", package: undefined, filePath: "src/a.jsx", via: "direct-import" },
    ]);
    expect(rows[0]?.viaChain.map((v) => v.kind)).toEqual(["direct-import", "lazy-import", "lazy-import"]);
  });
});

describe("a lazy import through a barrel re-export", () => {
  const files = {
    "src/view.jsx": "export const View = ({ t }) => <div>{t}</div>;",
    "src/view-enhanced.js": `
      import flow from "lodash/flow.js";
      import { connect } from "react-redux";
      import { withI18nStrings } from "@acme/l10n";
      import { View } from "./view.jsx";
      export const ViewEnhanced = flow(connect((s) => s), withI18nStrings("k"))(View);
    `,
    "src/index.js": `export { ViewEnhanced as View } from "./view-enhanced.js";`,
    "src/star.js": `export * from "./view-enhanced.js";`,
    "src/app.jsx": `
      import { lazy } from "react";
      const LazyDirect = lazy(() => import("./view-enhanced.js").then((m) => m.ViewEnhanced));
      const LazyRenamed = lazy(() => import("./index.js").then((m) => m.View));
      const LazyStar = lazy(() => import("./star.js").then((m) => m.ViewEnhanced));
      export const App = () => <div><LazyDirect /><LazyRenamed /><LazyStar /></div>;
    `,
  };

  it("a renaming barrel and a star barrel credit the wrapped view through the same hop as the defining file", () => {
    const occs = scan(files, pathResolver(REPO), REPO);
    const rows = inFile(occs, "src/app.jsx");
    expect(idsOf(rows).map((r) => `${r.export}@${r.filePath}`)).toEqual([
      "View@src/view.jsx",
      "View@src/view.jsx",
      "View@src/view.jsx",
    ]);
    expect(rows.map(chainOf)).toEqual([
      "local-component>lazy-import>hoc-wrapper",
      "local-component>lazy-import>hoc-wrapper",
      "local-component>lazy-import>hoc-wrapper",
    ]);
    expect(rows.map((o) => o.viaChain.at(-1))).toEqual([
      expect.objectContaining({ kind: "hoc-wrapper", hocCallee: "flow" }),
      expect.objectContaining({ kind: "hoc-wrapper", hocCallee: "flow" }),
      expect.objectContaining({ kind: "hoc-wrapper", hocCallee: "flow" }),
    ]);
  });
});

describe("a workspace package whose barrel renames the export", () => {
  const files = {
    "pages/error/error-page-impl.jsx": "export const ErrorPageImpl = () => <main />;",
    "pages/error/index.js": `export { ErrorPageImpl as ErrorPage } from "./error-page-impl.jsx";`,
    "pages/index.js": `export { ErrorPage } from "./error/index.js";`,
    "src/app.jsx": `
      import { lazy, memo } from "react";
      import { ErrorPage } from "@acme/pages";
      const LazyErrorPage = lazy(() => import("@acme/pages").then((mod) => ({ default: mod.ErrorPage })));
      const MemoErrorPage = memo(ErrorPage);
      export const App = () => <div><ErrorPage /><LazyErrorPage /><MemoErrorPage /></div>;
    `,
  };
  const resolver = (from: string, spec: string) =>
    spec === "@acme/pages" ? `${REPO}/pages/index.js` : pathResolver(REPO)(from, spec);

  it("a direct, a lazy and a wrapped render all credit the binding the chain lands on", () => {
    const rows = inFile(scan(files, resolver, REPO), "src/app.jsx");
    expect(idsOf(rows).map((r) => `${r.export}@${r.filePath}`)).toEqual([
      "ErrorPageImpl@pages/error/error-page-impl.jsx",
      "ErrorPageImpl@pages/error/error-page-impl.jsx",
      "ErrorPageImpl@pages/error/error-page-impl.jsx",
    ]);
    expect(rows.map(chainOf)).toEqual([
      "direct-import",
      "local-component>lazy-import",
      "local-component>hoc-wrapper",
    ]);
  });
});
