import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { createArgumentMap, createDiagnosticCollector, creditedTerminals, walkWithFolding } from "@scoutui/reference-graph";
import { buildGraph, pathResolver, scan, scanGraph } from "./shape-helpers.js";

const R = "/repo";
const ids = (occs: ReturnType<typeof scan>) =>
  occs
    .map((o) => {
      const id = o.rawComponentId as { export?: string; source: { type: string; package?: string; filePath?: string } };
      return `${id.source.type}:${id.source.filePath ?? id.source.package}:${id.export ?? ""}@${o.line}`;
    })
    .sort();

describe("a namespace import of a parsed file", () => {
  const ui = `import { forwardRef } from "react";
export function Plain() { return <div />; }
export const Fwd = forwardRef(function Fwd(props, ref) { return <div ref={ref} />; });
`;
  const run = (files: Record<string, string>, resolver = pathResolver(R)) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph(files, resolver, R, { collector });
    return {
      ids: ids(r.occurrences),
      viaChains: r.occurrences.map((o) => o.viaChain),
      diagnostics: collector.drain().map((d) => [d.code, "symbol" in d ? d.symbol : ""]),
    };
  };
  it("credits a rendered member as the named import does", () => {
    const r = run({
      "src/ui.tsx": ui,
      "src/App.tsx": `import * as UI from "./ui.tsx";
import { Plain, Fwd } from "./ui.tsx";
export function App() {
  return <><UI.Plain /><UI.Fwd /><Plain /><Fwd /></>;
}
`,
    });
    expect(r.ids).toEqual(["local:src/ui.tsx:Fwd@4", "local:src/ui.tsx:Fwd@4", "local:src/ui.tsx:Plain@4", "local:src/ui.tsx:Plain@4"]);
    const fwdHop = { kind: "hoc-wrapper", hocCallee: "forwardRef" };
    expect(r.viaChains).toEqual([
      [{ kind: "direct-import", specifier: "./ui.tsx", import: "*" }],
      [{ kind: "direct-import", specifier: "./ui.tsx", import: "*" }, fwdHop],
      [{ kind: "direct-import", specifier: "./ui.tsx", import: "Plain" }],
      [{ kind: "direct-import", specifier: "./ui.tsx", import: "Fwd" }, fwdHop],
    ]);
    expect(r.diagnostics).toEqual([]);
  });
  it("credits a rendered member through a workspace sibling's package specifier", () => {
    const resolver = (_from: string, spec: string) => (spec === "@ws/ui" ? `${R}/packages/ui/src/index.tsx` : null);
    const r = run(
      {
        "packages/ui/src/index.tsx": ui,
        "src/App.tsx": `import * as UI from "@ws/ui";\nexport function App() { return <><UI.Plain /><UI.Fwd /></>; }\n`,
      },
      resolver,
    );
    expect(r.ids).toEqual(["local:packages/ui/src/index.tsx:Fwd@2", "local:packages/ui/src/index.tsx:Plain@2"]);
    expect(r.viaChains).toEqual([
      [{ kind: "direct-import", specifier: "@ws/ui", import: "*" }],
      [
        { kind: "direct-import", specifier: "@ws/ui", import: "*" },
        { kind: "hoc-wrapper", hocCallee: "forwardRef" },
      ],
    ]);
  });
  it("credits a member held in an alias or wrapped in memo at module scope", () => {
    const r = run({
      "src/ui.tsx": ui,
      "src/App.tsx": `import { memo } from "react";
import * as UI from "./ui.tsx";
const P = UI.Plain;
const M = memo(UI.Plain);
export function App() { return <><P /><M /></>; }
`,
    });
    expect(r.ids).toEqual(["local:src/ui.tsx:Plain@5", "local:src/ui.tsx:Plain@5"]);
    expect(r.viaChains).toEqual([
      [{ kind: "local-component" }],
      [{ kind: "local-component" }, { kind: "hoc-wrapper", hocCallee: "memo", specifier: "./ui.tsx", import: "*" }],
    ]);
    expect(r.diagnostics).toEqual([]);
  });
  it("credits nothing for the namespace object rendered bare, and reports unresolved-reference", () => {
    const r = run({ "src/ui.tsx": ui, "src/App.tsx": `import * as UI from "./ui.tsx";\nexport function App() { return <UI />; }\n` });
    expect(r.ids).toEqual([]);
    expect(r.diagnostics).toEqual([["unresolved-reference", "UI"]]);
  });
  it("credits the same member imported by name, rendered bare and through an alias", () => {
    const occs = scan(
      {
        "src/ui.tsx": "export function Plain() { return <div />; }",
        "src/App.tsx": `import { Plain } from "./ui.tsx"; const P = Plain; export const App = () => <><Plain /><P /></>;`,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["local:src/ui.tsx:Plain@1", "local:src/ui.tsx:Plain@1"]);
    expect(occs.map((o) => o.viaChain)).toEqual([
      [{ kind: "direct-import", specifier: "./ui.tsx", import: "Plain" }],
      [{ kind: "local-component" }],
    ]);
  });
});

describe("a namespace re-exported by name from a barrel", () => {
  const files = {
    "packages/ui/src/list.tsx": "export function Button() { return <button />; }\n",
    "packages/ui/src/index.ts": `import * as List from "./list.tsx";\nexport { List };\n`,
  };
  const resolver = (from: string, spec: string) =>
    spec === "@ws/ui" ? `${R}/packages/ui/src/index.ts` : pathResolver(R)(from, spec);
  it.each([
    ["a package specifier", "@ws/ui"],
    ["a relative specifier", "../packages/ui/src/index.ts"],
  ])("credits the member's own declaration through %s", (_label, spec) => {
    const r = scanGraph(
      { ...files, "src/App.tsx": `import { List } from "${spec}";\nexport function App() { return <List.Button />; }\n` },
      resolver,
      R,
    );
    expect(ids(r.occurrences)).toEqual(["local:packages/ui/src/list.tsx:Button@2"]);
    expect(r.registry.localEntries().map((e) => `${e.filePath}#${e.exportName}`).sort()).toEqual([
      "packages/ui/src/list.tsx#Button",
      "src/App.tsx#App",
    ]);
  });
});

describe("a namespace import of a package", () => {
  it("credits a member held in an alias as the package's component, as the rendered member is", () => {
    const occs = scan(
      {
        "src/App.tsx": `import * as DS from "@ds/react";
const B = DS.Button;
export function App() { return <><B /><DS.Button /></>; }
`,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["external:@ds/react:Button@3", "external:@ds/react:Button@3"]);
  });
});

describe("a parsed barrel re-exporting a package", () => {
  for (const [label, barrel] of [
    ["export from", `export { Button } from "@ds/react";`],
    ["an imported local", `import { Button } from "@ds/react"; export { Button };`],
    ["export star", `export * from "@ds/react";`],
  ] as const) {
    describe(`through ${label}`, () => {
      const run = (app: string) => {
        const collector = createDiagnosticCollector();
        const r = scanGraph({ "src/ds.tsx": barrel, "src/App.tsx": app }, pathResolver(R), R, { collector });
        return { occs: r.occurrences, diagnostics: collector.drain().map((d) => d.code) };
      };
      it("credits <Button/> as the package's component", () => {
        const { occs, diagnostics } = run(`import { Button } from "./ds.tsx"; export const App = () => <Button />;`);
        expect(ids(occs)).toEqual(["external:@ds/react:Button@1"]);
        expect(occs.map((o) => o.viaChain)).toEqual([[{ kind: "direct-import", specifier: "./ds.tsx", import: "Button" }]]);
        expect(diagnostics).toEqual([]);
      });
      it("credits Button passed to a hook in a component body as the package's component", () => {
        const { occs } = run(`
          import { useModal } from "modal-lib";
          import { Button } from "./ds.tsx";
          export function App() { useModal(Button); return <div />; }
        `);
        expect(ids(occs)).toEqual(["external:@ds/react:Button@4"]);
        expect(occs.map((o) => o.viaChain)).toEqual([
          [{ kind: "passed-as-argument", callee: "useModal", index: 0, specifier: "./ds.tsx", import: "Button" }],
        ]);
      });
      it("credits memo(Button) rendered as a tag as the package's component under a memo hop", () => {
        const { occs } = run(`
          import { memo } from "react";
          import { Button } from "./ds.tsx";
          const M = memo(Button);
          export const App = () => <M />;
        `);
        expect(ids(occs)).toEqual(["external:@ds/react:Button@5"]);
        expect(occs.map((o) => o.viaChain)).toEqual([
          [{ kind: "local-component" }, { kind: "hoc-wrapper", hocCallee: "memo", specifier: "./ds.tsx", import: "Button" }],
        ]);
      });
      it("credits a lazy import of Button rendered as a tag as the package's component", () => {
        const { occs } = run(`
          import { lazy } from "react";
          const M = lazy(() => import("./ds.tsx").then((m) => ({ default: m.Button })));
          export const App = () => <M />;
        `);
        expect(ids(occs)).toEqual(["external:@ds/react:Button@4"]);
        expect(occs.map((o) => o.viaChain)).toEqual([
          [{ kind: "local-component" }, { kind: "lazy-import", wrapperCallee: "lazy", specifier: "./ds.tsx", import: "Button" }],
        ]);
      });
    });
  }
  it("credits nothing through `export *` beside an `export *` of a file the scan did not parse", () => {
    const occs = scan(
      {
        "src/ds.tsx": `export * from "./skip.tsx";\nexport * from "@ds/react";`,
        "src/App.tsx": `import { Button } from "./ds.tsx"; export const App = () => <Button />;`,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual([]);
  });
  it("credits nothing for a default import or a lazy default through `export *`", () => {
    const ds = { "src/ds.tsx": `export * from "@ds/react";` };
    const rendered = scan(
      { ...ds, "src/App.tsx": `import D from "./ds.tsx"; export const App = () => <D />;` },
      pathResolver(R),
      R,
    );
    const lazyDefault = scan(
      {
        ...ds,
        "src/App.tsx": `import { lazy } from "react";\nconst M = lazy(() => import("./ds.tsx"));\nexport const App = () => <M />;`,
      },
      pathResolver(R),
      R,
    );
    expect(ids(rendered)).toEqual([]);
    expect(ids(lazyDefault)).toEqual([]);
  });
  it("credits a component the same barrel declares itself", () => {
    const occs = scan(
      {
        "src/ds.tsx": "export function Button() { return <button />; }",
        "src/App.tsx": `import { Button } from "./ds.tsx"; export const App = () => <Button />;`,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["local:src/ds.tsx:Button@1"]);
  });
  it("credits the same component imported from the package directly", () => {
    const occs = scan(
      { "src/App.tsx": `import { Button } from "@ds/react"; export const App = () => <Button />;` },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["external:@ds/react:Button@1"]);
  });
});

/** `@/x` resolves under `src/`, a relative specifier against the importing
 *  file; an extensionless target gains `.tsx`. `./missing` does not resolve. */
const resolver = (from: string, spec: string): string | null => {
  if (spec.includes("missing")) return null;
  const target = spec.startsWith("@/")
    ? `${R}/src/${spec.slice(2)}`
    : spec.startsWith(".")
      ? posix.resolve(R, posix.dirname(from), spec)
      : null;
  if (target === null) return null;
  return /\.[a-z]+$/.test(target) ? target : `${target}.tsx`;
};

describe("an import of a first-party file the scan did not parse", () => {
  const firstParty = (abs: string) => abs.startsWith(`${R}/`) && !abs.includes("/node_modules/");
  const run = (
    files: Record<string, string>,
    hooks: { resolveLocalDefinition?: (abs: string, imported: string) => { absFile: string; exportName: string } | null } = {},
  ) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph(files, resolver, R, { collector }, { firstParty, ...hooks });
    return {
      ids: ids(r.occurrences),
      viaChains: r.occurrences.map((o) => o.viaChain),
      diagnostics: collector.drain().map((d) => [d.code, "specifier" in d ? d.specifier : "symbol" in d ? d.symbol : ""]),
    };
  };
  /** Pins every unparsed file to `<file>.impl.tsx`, recording each question. */
  const pinning = (asked: string[]) => ({
    resolveLocalDefinition: (abs: string, imported: string) => {
      asked.push(`${abs}#${imported}`);
      return { absFile: abs.replace(/\.tsx$/, ".impl.tsx"), exportName: imported };
    },
  });

  it("credits an alias import local, pinned to its definition, under a direct-import hop", () => {
    const asked: string[] = [];
    const app = `import { Drawer } from "@/skip/Drawer";\nexport function App() { return <Drawer />; }\n`;
    const r = run({ "src/App.tsx": app }, pinning(asked));
    expect(r.ids).toEqual(["local:/repo/src/skip/Drawer.impl.tsx:Drawer@2"]);
    expect(r.viaChains).toEqual([[{ kind: "direct-import", specifier: "@/skip/Drawer", import: "Drawer" }]]);
    expect(r.diagnostics).toEqual([]);
    expect(asked).toEqual(["/repo/src/skip/Drawer.tsx#Drawer"]);
    expect(run({ "src/App.tsx": app }).ids).toEqual(["local:/repo/src/skip/Drawer.tsx:Drawer@2"]);
  });

  it("credits a relative import local, pinned to its definition, under a direct-import hop", () => {
    const r = run(
      { "src/App.tsx": `import { Panel } from "./skip/Panel";\nexport function App() { return <Panel />; }\n` },
      pinning([]),
    );
    expect(r.ids).toEqual(["local:/repo/src/skip/Panel.impl.tsx:Panel@2"]);
    expect(r.viaChains).toEqual([[{ kind: "direct-import", specifier: "./skip/Panel", import: "Panel" }]]);
    expect(r.diagnostics).toEqual([]);
  });

  it("credits the pinned file where the import is wrapped in memo, passed to a hook or loaded lazily", () => {
    const r = run(
      {
        "src/App.tsx": `import { lazy, memo } from "react";
import { useModal } from "modal-lib";
import { Panel } from "./skip/Panel";
const M = memo(Panel);
const L = lazy(() => import("./skip/Panel"));
export function App() { useModal(Panel); return <><M /><L /></>; }
`,
      },
      pinning([]),
    );
    expect(r.ids).toEqual([
      "local:/repo/src/skip/Panel.impl.tsx:Panel@6",
      "local:/repo/src/skip/Panel.impl.tsx:Panel@6",
      "local:/repo/src/skip/Panel.impl.tsx:default@6",
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it("credits nothing for an alias import of a stylesheet or image, and reports unresolved-reference", () => {
    const r = run({ "src/App.tsx": `import Logo from "@/logo.svg";\nexport function App() { return <Logo />; }\n` });
    expect(r.ids).toEqual([]);
    expect(r.diagnostics).toEqual([["unresolved-reference", "Logo"]]);
  });

  it("credits a workspace member reached through a package specifier, pinned", () => {
    const occs = scanGraph(
      { "src/App.tsx": `import { Card } from "@ws/card"; export const App = () => <Card />;` },
      (_f, s) => (s === "@ws/card" ? "/repo/packages/card/src/index.ts" : null),
      R,
      undefined,
      {
        firstParty: (abs) => abs.startsWith("/repo/packages/"),
        resolveLocalDefinition: () => ({ absFile: "/repo/packages/card/src/Card.tsx", exportName: "Card" }),
      },
    ).occurrences;
    expect(ids(occs)).toEqual(["local:/repo/packages/card/src/Card.tsx:Card@1"]);
  });

  describe("reached through a parsed barrel", () => {
    it.each([
      ["an imported local", `import { Panel } from "./skip/Panel";\nexport { Panel };\n`],
      ["an imported local through an alias", `import { Panel } from "@/skip/Panel";\nexport { Panel };\n`],
      ["`export … from`", `export { Panel } from "./skip/Panel";\n`],
    ])("credits the pinned file at the render through %s, under the barrel import's direct-import hop", (_label, ds) => {
      const r = run(
        { "src/ds.tsx": ds, "src/App.tsx": `import { Panel } from "./ds.tsx";\nexport function App() { return <Panel />; }\n` },
        pinning([]),
      );
      expect(r.ids).toEqual(["local:/repo/src/skip/Panel.impl.tsx:Panel@2"]);
      expect(r.viaChains).toEqual([[{ kind: "direct-import", specifier: "./ds.tsx", import: "Panel" }]]);
      expect(r.diagnostics).toEqual([]);
    });
  });
});

describe("an import that does not resolve", () => {
  const run = (app: string) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph({ "src/App.tsx": app }, resolver, R, { collector });
    return {
      ids: ids(r.occurrences),
      diagnostics: collector.drain().map((d) => [d.code, "specifier" in d ? d.specifier : "symbol" in d ? d.symbol : ""]),
    };
  };
  it("is observed as module-not-found, with no diagnostic, where it is rendered directly", () => {
    const collector = createDiagnosticCollector();
    const r = scanGraph({ "src/App.tsx": `import { X } from "./missing";\nexport const App = () => <X />;\n` }, resolver, R, { collector });
    expect(r.occurrences.map((o) => o.unresolved)).toEqual([{ kind: "module-not-found" }]);
    expect(collector.drain()).toEqual([]);
  });
  it.each([
    ["wrapped in memo", `import { memo } from "react";\nimport { X } from "./missing";\nconst Y = memo(X);\nexport const App = () => <Y />;\n`],
    ["wrapped in an opaque HOC", `import { withThing } from "hoc-lib";\nimport { X } from "./missing";\nconst Y = withThing(X);\nexport const App = () => <Y />;\n`],
    ["held through a namespace import", `import * as NS from "./missing";\nconst Y = NS.Foo;\nexport const App = () => <Y />;\n`],
    ["held through a namespace import in memo", `import { memo } from "react";\nimport * as NS from "./missing";\nconst Y = memo(NS.Foo);\nexport const App = () => <Y />;\n`],
  ])("names nothing %s, and reports unresolved-reference at the holder", (_label, app) => {
    expect(run(app)).toEqual({ ids: [], diagnostics: [["unresolved-reference", "Y"]] });
  });
  it("names nothing passed to a hook", () => {
    const r = run(`import { useModal } from "modal-lib";\nimport { X } from "./missing";\nexport function App() { useModal(X); return null; }\n`);
    expect(r).toEqual({ ids: [], diagnostics: [] });
  });
  it("names nothing loaded lazily, and reports lazy-import-unsupported", () => {
    const r = run(`import { lazy } from "react";\nconst Y = lazy(() => import("./missing"));\nexport const App = () => <Y />;\n`);
    expect(r).toEqual({ ids: [], diagnostics: [["lazy-import-unsupported", "./missing"]] });
  });
  it.each(["tag", "value"] as const)("walked through an alias in %s position, carries no identity, not even the alias's", (position) => {
    const graph = buildGraph({ "src/App.tsx": `import { X } from "./missing";\nconst A = X;\nexport const App = () => <A />;\n` }, resolver, R);
    const fg = graph.files.get("src/App.tsx");
    const usage = fg?.jsxUsages.find((u) => u.ref.symbol === "A");
    if (!fg || !usage) throw new Error("no <A /> usage");
    const evaluation = walkWithFolding(graph, fg, { kind: "TypeOf", ref: usage.ref }, createArgumentMap(), undefined, undefined, position);
    expect(evaluation.map((t) => [t.denotation.kind, t.identity])).toEqual([["indeterminate", null]]);
    expect(creditedTerminals(evaluation)).toEqual([]);
  });
});

describe("a React wrapper called through a cast namespace member", () => {
  it.each([
    ["forwardRef", "(React.forwardRef as <T>(c: T) => T)(Inner)"],
    ["memo", "React.memo!(Inner)"],
  ])("folds %s to the wrapped component with a hop named for the wrapper", (hook, call) => {
    const occs = scan(
      {
        "src/App.tsx": `import * as React from "react";\nfunction Inner() { return <i />; }\nconst M = ${call};\nexport function App() { return <M />; }\n`,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["local:src/App.tsx:Inner@4"]);
    expect(occs.map((o) => o.viaChain)).toEqual([
      [{ kind: "local-component" }, expect.objectContaining({ kind: "hoc-wrapper", hocCallee: hook })],
    ]);
  });
});

describe("a React memo reached through the default or namespace import", () => {
  const button = "export function Button() { return <button />; }";
  for (const [label, app] of [
    ["React.memo", `import React from "react"; import { Button } from "./button.tsx"; const M = React.memo(Button); export const App = () => <M />;`],
    ["R.memo", `import * as R from "react"; import { Button } from "./button.tsx"; const M = R.memo(Button); export const App = () => <M />;`],
  ] as const) {
    it(`folds ${label}(Button) to Button with a memo hop`, () => {
      const occs = scan({ "src/button.tsx": button, "src/App.tsx": app }, pathResolver(R), R);
      const buttons = occs.filter((o) => ids([o])[0]?.startsWith("local:src/button.tsx:Button@"));
      expect(buttons.map((o) => o.viaChain)).toEqual([[{ kind: "local-component" }, expect.objectContaining({ kind: "hoc-wrapper", hocCallee: "memo" })]]);
    });
  }
});

describe("a name bound only in a scope that does not enclose the reference", () => {
  it("is not the declaration another function holds", () => {
    const collector = createDiagnosticCollector();
    const r = scanGraph(
      {
        "src/App.tsx": `import { memo } from "react";
function Other() { const Button = () => <b />; return <Button />; }
const M = memo(Button);
export function App() { return <div><M /><Other /></div>; }
`,
      },
      pathResolver(R),
      R,
      { collector },
    );
    expect(ids(r.occurrences)).toEqual(["local:src/App.tsx:Button@2", "local:src/App.tsx:Other@4"]);
    expect(collector.drain().map((d) => [d.code, "symbol" in d ? d.symbol : ""])).toEqual([["unresolved-reference", "M"]]);
  });
});

describe("an `export *` branch the re-export chain has already sought", () => {
  it("is skipped, and the next branch binds the name", () => {
    const occs = scan(
      {
        "src/a.tsx": `export { X } from "./b.tsx";`,
        "src/b.tsx": `export * from "./a.tsx";\nexport * from "./c.tsx";`,
        "src/c.tsx": "export function X() { return <i />; }",
        "src/App.tsx": `import { memo } from "react";\nimport { X } from "./a.tsx";\nconst M = memo(X);\nexport const App = () => <M />;`,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["local:src/c.tsx:X@4"]);
    expect(occs.map((o) => o.viaChain)).toEqual([
      [{ kind: "local-component" }, { kind: "hoc-wrapper", hocCallee: "memo", specifier: "./a.tsx", import: "X" }],
    ]);
  });
  it("is skipped where the name is rendered directly", () => {
    const occs = scan(
      {
        "src/a.tsx": `export { X } from "./b.tsx";`,
        "src/b.tsx": `export * from "./a.tsx";\nexport * from "./c.tsx";`,
        "src/c.tsx": "export function X() { return <i />; }",
        "src/App.tsx": `import { X } from "./a.tsx";\nexport const App = () => <X />;`,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["local:src/c.tsx:X@2"]);
    expect(occs.map((o) => o.viaChain)).toEqual([[{ kind: "direct-import", specifier: "./a.tsx", import: "X" }]]);
  });
});


describe("a nested declaration that shadows an import", () => {
  const x = "export function Item() { return <div />; }";
  it("credits the imported component where nothing shadows it", () => {
    const occs = scan(
      {
        "src/x.tsx": x,
        "src/App.tsx": `
          import { Item } from "./x.tsx";
          export function App() { const A = Item; return <><Item /><A /></>; }
        `,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["local:src/x.tsx:Item@3", "local:src/x.tsx:Item@3"]);
    expect(occs.map((o) => o.viaChain)).toEqual([
      [{ kind: "direct-import", specifier: "./x.tsx", import: "Item" }],
      [{ kind: "local-component" }],
    ]);
  });
  it("is the declaration, at the tag and in an alias", () => {
    const occs = scan(
      {
        "src/x.tsx": x,
        "src/App.tsx": `
          import { Item } from "./x.tsx";
          export function App() { const Item = () => <span />; const A = Item; return <><Item /><A /></>; }
        `,
      },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["local:src/App.tsx:Item@3", "local:src/App.tsx:Item@3"]);
    expect(occs.map((o) => o.viaChain)).toEqual([[{ kind: "local-component" }], [{ kind: "local-component" }]]);
    expect(occs.map((o) => o.definition)).toEqual([
      { line: 3, column: 40 },
      undefined,
    ]);
  });
  it.each([
    ["a React namespace member", `import React from "react";`, "const React = new Kit(); const M = React.memo(Button); return <M />;"],
    ["a React export", `import { createContext } from "react";`, "const createContext = new Kit(); const C = createContext(Button); return <C />;"],
    ["a package namespace member", `import * as api from "api";`, "const api = new Kit(); const M = api.wrap(Button); return <M />;"],
  ])("with no inferable value, shadowing %s, is read as the declaration, as if nothing were imported", (_label, shadowed, body) => {
    const app = (imports: string) => ({
      "src/App.tsx": `
        ${imports}
        import { Button } from "pkg";
        export function App() { ${body} }
      `,
    });
    expect(scan(app(shadowed))).toEqual(scan(app("")));
  });
});

describe("a barrel exporting a name it never binds", () => {
  const run = (barrel: Record<string, string>, app: string) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph({ ...barrel, "src/App.tsx": app }, pathResolver(R), R, { collector });
    return {
      ids: ids(r.occurrences),
      viaChains: r.occurrences.map((o) => o.viaChain),
      roster: r.registry.localEntries().map((e) => `${e.filePath}#${e.exportName}`).sort(),
      diagnostics: collector.drain().map((d) => [d.code, "specifier" in d ? d.specifier : "symbol" in d ? d.symbol : ""]),
    };
  };
  const lazyThen = `
    import { lazy } from "react";
    const M = lazy(() => import("./barrel.tsx").then((m) => ({ default: m.Ghost })));
    export function App() { return <M />; }
  `;
  const lazyDefault = `
    import { lazy } from "react";
    const M = lazy(() => import("./barrel.tsx"));
    export function App() { return <M />; }
  `;
  const opaque = `
    import { withThing } from "hoc-lib";
    import { Ghost } from "./barrel.tsx";
    const M = withThing(Ghost);
    export function App() { return <M />; }
  `;
  it("credits the declared component where the barrel binds it", () => {
    const declared = { "src/barrel.tsx": "export function Ghost() { return <i />; }\nexport default Ghost;\n" };
    const then = run(declared, lazyThen);
    expect(then.ids).toEqual(["local:src/barrel.tsx:Ghost@4"]);
    expect(then.viaChains).toEqual([
      [{ kind: "local-component" }, { kind: "lazy-import", wrapperCallee: "lazy", specifier: "./barrel.tsx", import: "Ghost" }],
    ]);
    expect(then.roster).not.toContain("src/App.tsx#M");
    expect(run(declared, lazyDefault).ids).toEqual(["local:src/barrel.tsx:Ghost@4"]);
  });
  it("under a lazy import's then, credits no holder and reports lazy-import-unsupported", () => {
    const r = run({ "src/barrel.tsx": "export { Ghost };\n" }, lazyThen);
    expect(r.ids).toEqual([]);
    expect(r.roster).toEqual(["src/App.tsx#App", "src/App.tsx#M"]);
    expect(r.diagnostics).toEqual([["lazy-import-unsupported", "./barrel.tsx"]]);
  });
  it("as a lazy import's default, credits no holder and reports lazy-import-unsupported", () => {
    const r = run({ "src/barrel.tsx": "export default Ghost;\n" }, lazyDefault);
    expect(r.ids).toEqual([]);
    expect(r.roster).toEqual(["src/App.tsx#App", "src/App.tsx#M"]);
    expect(r.diagnostics).toEqual([["lazy-import-unsupported", "./barrel.tsx"]]);
  });
  it("under an opaque HOC, credits no holder and reports unresolved-reference", () => {
    const r = run({ "src/barrel.tsx": "export { Ghost };\n" }, opaque);
    expect(r.ids).toEqual([]);
    expect(r.roster).toEqual(["src/App.tsx#App", "src/App.tsx#M"]);
    expect(r.diagnostics).toEqual([["unresolved-reference", "M"]]);
  });
});

describe("a namespace import of a file that exports a string-literal \"*\" name", () => {
  const x = "export function X() { return <b />; }\n";
  const starFile = 'function X() { return <b />; }\nexport { X as "*" };\n';
  const run = (files: Record<string, string>, app: string) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph({ ...files, "src/App.tsx": app }, pathResolver(R), R, { collector });
    return {
      ids: ids(r.occurrences),
      diagnostics: collector.drain().map((d) => [d.code, "symbol" in d ? d.symbol : ""]),
    };
  };
  const memoOfNamespace = (spec: string) =>
    `import { memo } from "react";\nimport * as ns from "${spec}";\nconst M = memo(ns);\nexport function App() { return <M />; }\n`;
  it.each([
    ["declared in the file", "./b.tsx", { "src/b.tsx": starFile }],
    ["re-exported with export … from", "./barrel.ts", { "src/barrel.ts": 'export { X as "*" } from "./x.tsx";\n', "src/x.tsx": x }],
    ["re-exported as an imported local", "./barrel.ts", { "src/barrel.ts": 'import { X } from "./x.tsx";\nexport { X as "*" };\n', "src/x.tsx": x }],
    ["reached through export *", "./barrel.ts", { "src/barrel.ts": 'export * from "./b.tsx";\n', "src/b.tsx": starFile }],
    ["exporting no such name", "./x.tsx", { "src/x.tsx": x }],
  ] as const)("credits nothing for the namespace object wrapped in memo, %s", (_label, spec, files) => {
    expect(run(files, memoOfNamespace(spec))).toEqual({ ids: [], diagnostics: [["unresolved-reference", "M"]] });
  });
  it("credits the component wrapped in memo when it is imported by name", () => {
    const app = `import { memo } from "react";\nimport { X } from "./x.tsx";\nconst M = memo(X);\nexport function App() { return <M />; }\n`;
    expect(run({ "src/x.tsx": x }, app)).toEqual({ ids: ["local:src/x.tsx:X@4"], diagnostics: [] });
  });
});

describe("a module-scope declaration sharing its name with a type-only import", () => {
  const x = "export function Foo() { return <i />; }\n";
  it.each([
    ["import type { Foo }", 'import type { Foo } from "./x.tsx";'],
    ["import { type Foo }", 'import { type Foo } from "./x.tsx";'],
  ])("is the tag's binding under `%s`", (_label, imp) => {
    const occs = scan(
      { "src/x.tsx": x, "src/App.tsx": `${imp}\nconst Foo = () => <b />;\nexport function App() { return <Foo />; }\n` },
      pathResolver(R),
      R,
    );
    expect(ids(occs)).toEqual(["local:src/App.tsx:Foo@3"]);
    expect(occs.map((o) => o.viaChain)).toEqual([[{ kind: "local-component" }]]);
    expect(occs.map((o) => o.definition)).toEqual([{ line: 2, column: 6 }]);
  });
});

describe("a barrel re-exporting a component of a parsed workspace package", () => {
  const card = "export function X() { return <b />; }\n";
  const wsResolver = (from: string, spec: string): string | null =>
    spec === "@ws/card" ? `${R}/packages/card/src/index.tsx` : pathResolver(R)(from, spec);
  const app = `import { memo } from "react";
import { useModal } from "modal-lib";
import { X } from "./barrel.tsx";
const M = memo(X);
export function App() {
  useModal(X);
  return <><X /><M /></>;
}
`;
  it.each([
    ["an imported local", 'import { X } from "@ws/card";\nexport { X };\n'],
    ["`export … from`", 'export { X } from "@ws/card";\n'],
  ])("credits the package's component at the render, in memo and passed to a hook, through %s", (_label, barrel) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph(
      { "packages/card/src/index.tsx": card, "src/barrel.tsx": barrel, "src/App.tsx": app },
      wsResolver,
      R,
      { collector },
    );
    const rows = r.occurrences.map((o) => ({ id: ids([o])[0], viaChain: o.viaChain }));
    expect(rows).toEqual([
      { id: "local:packages/card/src/index.tsx:X@7", viaChain: [{ kind: "direct-import", specifier: "./barrel.tsx", import: "X" }] },
      {
        id: "local:packages/card/src/index.tsx:X@7",
        viaChain: [{ kind: "local-component" }, { kind: "hoc-wrapper", hocCallee: "memo", specifier: "./barrel.tsx", import: "X" }],
      },
      { id: "local:packages/card/src/index.tsx:X@6", viaChain: [{ kind: "passed-as-argument", callee: "useModal", index: 0, specifier: "./barrel.tsx", import: "X" }] },
    ]);
    expect(collector.drain()).toEqual([]);
  });
});

describe("a walk through a parsed file that does not bind the name", () => {
  const x = "export function Other() { return <i />; }\n";
  const run = (files: Record<string, string>, app: string) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph({ ...files, "src/App.tsx": app }, resolver, R, { collector });
    return {
      ids: ids(r.occurrences),
      roster: r.registry.localEntries().map((e) => `${e.filePath}#${e.exportName}`).sort(),
      diagnostics: collector.drain().map((d) => [d.code, "specifier" in d ? d.specifier : "symbol" in d ? d.symbol : ""]),
    };
  };
  const memoOf = (spec: string) =>
    `import { memo } from "react";\nimport { X } from "${spec}";\nconst Y = memo(X);\nexport function App() { return <Y />; }\n`;
  const bare = (spec: string) => `import { X } from "${spec}";\nexport function App() { return <X />; }\n`;
  const notExported = ["a barrel that does not export it", "./barrel.tsx", { "src/barrel.tsx": 'export { Other } from "./x.tsx";\n', "src/x.tsx": x }] as const;
  const cycle = ["a mutual `export *` cycle", "./a.tsx", { "src/a.tsx": 'export * from "./b.tsx";\n', "src/b.tsx": 'export * from "./a.tsx";\n' }] as const;
  const neverBinds = ["a barrel exporting a name it never binds", "./barrel.tsx", { "src/barrel.tsx": "export { X };\n" }] as const;
  const failedImport = ["a barrel whose import of it does not resolve", "./barrel.tsx", { "src/barrel.tsx": 'import { X } from "./missing";\nexport { X };\n' }] as const;
  it.each([notExported, failedImport])("credits nothing wrapped in memo through %s, and reports unresolved-reference at the holder", (_label, spec, files) => {
    const r = run(files, memoOf(spec));
    expect(r.ids).toEqual([]);
    expect(r.roster).not.toContain("src/App.tsx#Y");
    expect(r.diagnostics).toEqual([["unresolved-reference", "Y"]]);
  });
  it.each([cycle, failedImport])("credits nothing loaded lazily through %s, and reports lazy-import-unsupported", (_label, spec, files) => {
    const app = `import { lazy } from "react";\nconst Y = lazy(() => import("${spec}").then((m) => ({ default: m.X })));\nexport function App() { return <Y />; }\n`;
    const r = run(files, app);
    expect(r.ids).toEqual([]);
    expect(r.diagnostics).toEqual([["lazy-import-unsupported", spec]]);
  });
  // Rendered directly, a failed import through a barrel is an unresolved occurrence
  // (engine-shapes-unresolved.test.ts).
  it.each([notExported, cycle, neverBinds])("credits nothing rendered directly through %s, and reports unresolved-reference", (_label, spec, files) => {
    const r = run(files, bare(spec));
    expect(r.ids).toEqual([]);
    expect(r.diagnostics).toEqual([["unresolved-reference", "X"]]);
  });
  it("credits the declared component wrapped in memo where the barrel exports it", () => {
    const r = run({ "src/barrel.tsx": 'export { Other as X } from "./x.tsx";\n', "src/x.tsx": x }, memoOf("./barrel.tsx"));
    expect(r.ids).toEqual(["local:src/x.tsx:Other@4"]);
    expect(r.diagnostics).toEqual([]);
  });
});

describe("a lazy component whose import names nothing", () => {
  const holders = [
    ["memo", "const M = memo(L);"],
    ["an opaque HOC", "const M = withThing(L);"],
    ["memo over an alias", "const A = L;\nconst M = memo(A);"],
    ["memo over memo", "const N = memo(L);\nconst M = memo(N);"],
  ] as const;
  const run = (files: Record<string, string>, lazy: string, body: string) => {
    const app = `import { lazy, memo } from "react";\nimport { withThing } from "hoc-lib";\nconst L = ${lazy};\n${body}\n`;
    const collector = createDiagnosticCollector();
    const r = scanGraph({ ...files, "src/App.tsx": app }, resolver, R, { collector });
    return {
      ids: ids(r.occurrences),
      diagnostics: collector.drain().map((d) => [d.code, "specifier" in d ? d.specifier : "symbol" in d ? d.symbol : ""]),
    };
  };
  it.each(holders)("credits nothing through a failed import, neither the lazy holder nor the outer one, wrapped in %s, and reports unresolved-reference at the outer one", (_holder, decl) => {
    const r = run({}, 'lazy(() => import("./missing"))', `${decl}\nexport function App() { return <M />; }`);
    expect(r).toEqual({ ids: [], diagnostics: [["unresolved-reference", "M"]] });
  });
  it("credits nothing rendered directly from a file with no default export, and reports lazy-import-unsupported", () => {
    const files = { "src/x.tsx": "export function Other() { return <i />; }\n" };
    expect(run(files, 'lazy(() => import("./x.tsx"))', "export function App() { return <L />; }")).toEqual({
      ids: [],
      diagnostics: [["lazy-import-unsupported", "./x.tsx"]],
    });
  });
  it("credits nothing for a `.then` that picks a name the file does not export, and credits the file's default loaded without it", () => {
    const files = { "src/x.tsx": "export default function Other() { return <i />; }\n" };
    const render = "export function App() { return <L />; }";
    expect(run(files, 'lazy(() => import("./x.tsx").then((m) => ({ default: m.X })))', render)).toEqual({
      ids: [],
      diagnostics: [["lazy-import-unsupported", "./x.tsx"]],
    });
    expect(run(files, 'lazy(() => import("./x.tsx"))', render)).toEqual({ ids: ["local:src/x.tsx:Other@4"], diagnostics: [] });
  });
  it("credits nothing where the lazy target is a wrapper over an import that does not resolve", () => {
    const files = {
      "src/a.tsx": 'import { memo } from "react";\nimport { X } from "./missing";\nconst Y = memo(X);\nexport default Y;\n',
    };
    const lazy = 'lazy(() => import("./a.tsx"))';
    expect(run(files, lazy, "export function App() { return <L />; }").ids).toEqual([]);
    expect(run(files, lazy, "const M = memo(L);\nexport function App() { return <M />; }").ids).toEqual([]);
  });
  it("rosters the holders of a lazy default that aliases an import that does not resolve as it rosters those of a missing default", () => {
    const app = (spec: string) =>
      `import { lazy, memo } from "react";\nconst L = lazy(() => import("${spec}"));\nconst M = memo(L);\nexport function App() { return <M />; }\n`;
    const roster = (files: Record<string, string>, spec: string) =>
      scanGraph({ ...files, "src/App.tsx": app(spec) }, resolver, R)
        .registry.localEntries()
        .filter((e) => e.filePath === "src/App.tsx")
        .map((e) => e.exportName)
        .sort();
    const missingDefault = roster({ "src/x.tsx": "export function Other() { return <i />; }\n" }, "./x.tsx");
    expect(missingDefault).toEqual(["App", "L", "M"]);
    expect(roster({ "src/a.tsx": 'import { X } from "./missing";\nconst Y = X;\nexport default Y;\n' }, "./a.tsx")).toEqual(missingDefault);
  });
});

describe("a destructure from a name", () => {
  const run = (files: Record<string, string>) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph(files, pathResolver(R), R, { collector });
    return {
      ids: ids(r.occurrences),
      viaChains: r.occurrences.map((o) => o.viaChain),
      diagnostics: collector.drain().map((d) => [d.code, "symbol" in d ? d.symbol : ""]),
    };
  };

  it("credits a package compound's member as the inline member is credited", () => {
    const r = run({
      "src/App.tsx": `import { Table } from "@acme/ui";
const { Cell, Row } = Table;
export function Users() {
  return <Row><Cell /><Table.Cell /></Row>;
}
`,
    });
    expect(r.ids).toEqual(["external:@acme/ui:Table.Cell@4", "external:@acme/ui:Table.Cell@4", "external:@acme/ui:Table.Row@4"]);
    expect(r.viaChains).toEqual([
      [{ kind: "local-component" }],
      [{ kind: "local-component" }],
      [{ kind: "direct-import", specifier: "@acme/ui", import: "Table" }],
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it("credits a local object compound's member as the inline member is credited", () => {
    const r = run({
      "src/table.tsx": "function Cell() { return <td />; }\nexport const Table = { Cell };\n",
      "src/App.tsx": `import { Table } from "./table.tsx";
export function App() {
  const { Cell } = Table;
  return <><Cell /><Table.Cell /></>;
}
`,
    });
    expect(r.ids).toEqual(["local:src/table.tsx:Cell@4", "local:src/table.tsx:Cell@4"]);
    expect(r.viaChains).toEqual([
      [{ kind: "local-component" }],
      [{ kind: "direct-import", specifier: "./table.tsx", import: "Table" }],
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it("credits nothing for a prop destructured in the body, and reports what the destructured parameter reports", () => {
    const r = run({
      "src/F.tsx": "export function F({ component: C }) { return <C />; }\n",
      "src/G.tsx": "export function G(props) { const { component: C } = props; return <C />; }\n",
    });
    expect(r.ids).toEqual([]);
    expect(r.diagnostics).toEqual([
      ["late-bound-render", "C"],
      ["late-bound-render", "C"],
    ]);
  });

  it("credits a namespace member's member as the inline member is credited", () => {
    const r = run({
      "src/ui.tsx": "function Cell() { return <td />; }\nexport const Table = { Cell };\n",
      "src/App.tsx": `import * as UI from "./ui.tsx";
const { Cell } = UI.Table;
export function App() { return <><Cell /><UI.Table.Cell /></>; }
`,
    });
    expect(r.ids).toEqual(["local:src/ui.tsx:Cell@3", "local:src/ui.tsx:Cell@3"]);
    expect(r.viaChains).toEqual([
      [{ kind: "local-component" }],
      [{ kind: "direct-import", specifier: "./ui.tsx", import: "*" }],
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it("in a component body, is the binding the render names, not a same-named import", () => {
    const r = run({
      "src/other.tsx": "export function Cell() { return <td />; }\n",
      "src/table.tsx": "function Cell() { return <th />; }\nexport const Table = { Cell };\n",
      "src/App.tsx": `import { Cell } from "./other.tsx";
import { Table } from "./table.tsx";
export function App() {
  const { Cell } = Table;
  return <Cell />;
}
`,
    });
    expect(r.ids).toEqual(["local:src/table.tsx:Cell@5"]);
    expect(r.viaChains).toEqual([[{ kind: "local-component" }]]);
  });

  it("in a for-of head, credits no same-named import, and reports what the identifier head reports", () => {
    const other = "export function Cell() { return <td />; }\n";
    const r = run({
      "src/other.tsx": other,
      "src/A.tsx": `import { Cell } from "./other.tsx";\nexport function A({ rows }) { for (const { Cell } of rows) { return <Cell />; } return null; }\n`,
      "src/B.tsx": `import { Cell } from "./other.tsx";\nexport function B({ rows }) { for (const Cell of rows) { return <Cell />; } return null; }\n`,
    });
    expect(r.ids).toEqual([]);
    expect(r.diagnostics).toEqual([
      ["unresolved-reference", "Cell"],
      ["unresolved-reference", "Cell"],
    ]);
  });
});

describe("a static-assignment compound member", () => {
  const run = (files: Record<string, string>) => {
    const collector = createDiagnosticCollector();
    const r = scanGraph(files, pathResolver(R), R, { collector });
    return {
      ids: ids(r.occurrences),
      viaChains: r.occurrences.map((o) => o.viaChain),
      diagnostics: collector.drain().map((d) => [d.code, "symbol" in d ? d.symbol : ""]),
    };
  };

  it("credits each assigned member and the `Object.assign` product at the render, with the object-literal controls unchanged", () => {
    const r = run({
      "src/card.jsx": `const CardHeader = () => <header />;
const CardFooter = () => <footer />;
export const Card = ({ children }) => <section>{children}</section>;
Card.Header = CardHeader;
Card.Footer = CardFooter;
`,
      "src/panel.jsx": `const PanelHeader = () => <header />;
const PanelBody = ({ children }) => <div>{children}</div>;
export const Panel = Object.assign(PanelBody, { Header: PanelHeader });
`,
      "src/sidebar.jsx": `const Root = () => <aside />;
const Item = () => <li />;
export const Sidebar = { Root, Item };
`,
      "src/app.jsx": `import { Card } from './card.jsx';
import { Panel } from './panel.jsx';
import { Sidebar } from './sidebar.jsx';
export const App = () => (
  <main>
    <Card>
      <Card.Header />
      <Card.Footer />
    </Card>
    <Panel>
      <Panel.Header />
    </Panel>
    <Sidebar.Root />
    <Sidebar.Item />
  </main>
);
`,
    });
    expect(r.ids).toEqual([
      "local:src/card.jsx:Card@6",
      "local:src/card.jsx:CardFooter@8",
      "local:src/card.jsx:CardHeader@7",
      "local:src/panel.jsx:PanelBody@10",
      "local:src/panel.jsx:PanelHeader@11",
      "local:src/sidebar.jsx:Item@14",
      "local:src/sidebar.jsx:Root@13",
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it("credits a default-exported holder's member where the holder renders nothing", () => {
    const r = run({
      "src/stub.jsx": "const Top = () => <b />;\nconst Stub = () => null;\nStub.Top = Top;\nexport default Stub;\n",
      "src/app.jsx": `import Stub from "./stub.jsx";\nexport const App = () => <Stub.Top />;\n`,
    });
    expect(r.ids).toEqual(["local:src/stub.jsx:Top@2"]);
    expect(r.viaChains).toEqual([[{ kind: "direct-import", specifier: "./stub.jsx", import: "default" }]]);
    expect(r.diagnostics).toEqual([]);
  });

  it("credits an inline member as the compound it is assigned under", () => {
    const r = run({
      "src/card.jsx": "export const Card = () => <section />;\nCard.Inline = () => <i />;\n",
      "src/app.jsx": `import { Card } from "./card.jsx";\nexport const App = () => <Card.Inline />;\n`,
    });
    expect(r.ids).toEqual(["local:src/card.jsx:Card.Inline@2"]);
    expect(r.diagnostics).toEqual([]);
  });

  it("defines an imported inline member at its assignment, and an assigned component by its own identity", () => {
    const r = scanGraph(
      {
        "src/card.jsx": "const CardHeader = () => <header />;\nexport const Card = () => <section />;\nCard.Header = CardHeader;\nCard.Inline = () => <i />;\n",
        "src/app.jsx": 'import { Card } from "./card.jsx";\nexport const App = () => <><Card.Header /><Card.Inline /></>;\n',
      },
      pathResolver(R),
      R,
    );
    expect(r.occurrences.map((o) => [(o.rawComponentId as { export?: string }).export, o.definition])).toEqual([
      ["CardHeader", undefined],
      ["Card.Inline", { line: 4, column: 0 }],
    ]);
  });

  it("credits the member of a holder built with forwardRef", () => {
    const r = run({
      "src/card.jsx": `import { forwardRef } from "react";
const CardHeader = () => <header />;
const Impl = (props, ref) => <section ref={ref} />;
export const Card = forwardRef(Impl);
Card.Header = CardHeader;
`,
      "src/app.jsx": `import { Card } from "./card.jsx";\nexport const App = () => <Card.Header />;\n`,
    });
    expect(r.ids).toEqual(["local:src/card.jsx:CardHeader@2"]);
  });

  it("credits the member through an alias and under memo", () => {
    const card = "const CardHeader = () => <header />;\nexport const Card = () => <section />;\nCard.Header = CardHeader;\n";
    const r = run({
      "src/card.jsx": card,
      "src/app.jsx": `import { memo } from "react";
import { Card } from "./card.jsx";
const H = Card.Header;
const M = memo(Card.Header);
export const App = () => <><H /><M /></>;
`,
    });
    expect(r.ids).toEqual(["local:src/card.jsx:CardHeader@5", "local:src/card.jsx:CardHeader@5"]);
    expect(r.viaChains.map((chain) => chain.map((v) => v.kind))).toEqual([["local-component"], ["local-component", "hoc-wrapper"]]);
  });

  it("credits a member of an object-literal static member at the tag and through an alias", () => {
    const r = run({
      "src/card.jsx": "const Item = () => <li />;\nexport const Card = () => <section />;\nCard.Group = { Item };\n",
      "src/app.jsx": `import { Card } from "./card.jsx";
const T = Card.Group.Item;
export const App = () => <><Card.Group.Item /><T /></>;
`,
    });
    expect(r.ids).toEqual(["local:src/card.jsx:Item@3", "local:src/card.jsx:Item@3"]);
  });

  describe("reached through an alias, a nested member or an object-literal member, credits in value position what the tag credits", () => {
    const card = `import { memo } from "react";
export const Title = () => <h3 />;
export const CardHeader = () => <header />;
CardHeader.Title = Title;
export const Card = () => <section />;
Card.Header = CardHeader;
export const Alias = Card;
export const Nav = { Card };
`;
    const forms = (spelling: string) => `import { memo } from "react";
import { Card, Alias, Nav } from "./card.jsx";
const C = Card;
const A = ${spelling};
const M = memo(${spelling});
export const App = () => <><${spelling} /><A /><M /></>;
`;
    it.each([
      ["a local alias", "C.Header", "CardHeader"],
      ["an imported alias", "Alias.Header", "CardHeader"],
      ["a nested member", "Card.Header.Title", "Title"],
      ["an alias's nested member", "C.Header.Title", "Title"],
      ["an object-literal member", "Nav.Card.Header", "CardHeader"],
    ])("%s", (_label, spelling, credited) => {
      const r = run({ "src/card.jsx": card, "src/app.jsx": forms(spelling) });
      expect(r.ids).toEqual([`local:src/card.jsx:${credited}@6`, `local:src/card.jsx:${credited}@6`, `local:src/card.jsx:${credited}@6`]);
      expect(r.diagnostics).toEqual([]);
    });

    it("a destructure from a local alias", () => {
      const r = run({
        "src/card.jsx": card,
        "src/app.jsx": `import { Card } from "./card.jsx";
const C = Card;
const { Header } = C;
export const App = () => <><Header /><C.Header /></>;
`,
      });
      expect(r.ids).toEqual(["local:src/card.jsx:CardHeader@4", "local:src/card.jsx:CardHeader@4"]);
    });
  });

  it.each([
    ["at the tag", "<Card.Inline />"],
    ["through an alias", "<A />"],
    ["under memo", "<M />"],
  ])("rendering a member %s marks nothing on its holder", (_label, render) => {
    const holder = "export function Card(p) { return p.x; }\nCard.Inline = (p) => p.y;\n";
    const app = (imp: string) => `import { memo } from "react";\n${imp}const A = Card.Inline;\nconst M = memo(Card.Inline);\nexport const App = () => ${render};\n`;
    const r = scanGraph(
      { "src/card.jsx": holder, "src/app.jsx": app('import { Card } from "./card.jsx";\n'), "src/same.jsx": `${holder}${app("")}` },
      pathResolver(R),
      R,
    );
    expect(ids(r.occurrences)).toEqual(["local:src/card.jsx:Card.Inline@5", "local:src/same.jsx:Card.Inline@6"]);
    const roster = r.registry.localEntries().map((e) => `${e.filePath}#${e.exportName}`);
    expect(roster.filter((e) => e.endsWith("#Card"))).toEqual([]);
  });

  it("returned from a factory, or aliased, credits and rosters what an object-literal member does", () => {
    const file = (holder: string, spelling: string) => `import { memo } from "react";
const Header = () => <header />;
${holder}
const make = () => ${spelling};
const X = make();
const M = memo(make());
const A = ${spelling};
export const App = () => <><X /><M /><A /></>;
`;
    const r = scanGraph(
      {
        "src/static.jsx": file("const Card = () => <section />; Card.Header = Header;", "Card.Header"),
        "src/literal.jsx": file("const Card = { Header };", "Card.Header"),
      },
      pathResolver(R),
      R,
    );
    const credited = (file: string) =>
      ids(r.occurrences)
        .filter((id) => id.startsWith(`local:${file}:`))
        .map((id) => id.slice(`local:${file}:`.length));
    expect(credited("src/literal.jsx")).toEqual(["Header@8", "M@8", "X@8"]);
    expect(credited("src/static.jsx")).toEqual(credited("src/literal.jsx"));
    const roster = (file: string) =>
      r.registry
        .localEntries()
        .filter((e) => e.filePath === file)
        .map((e) => e.exportName)
        .sort();
    expect(roster("src/literal.jsx")).toEqual(expect.arrayContaining(["A", "M", "X"]));
    expect(roster("src/static.jsx")).toEqual(roster("src/literal.jsx"));
  });

  it("returned from a factory through an aliased or nested holder, credits and rosters what the direct holder does", () => {
    const file = (holder: string, spelling: string) => `import { memo } from "react";
const Header = () => <header />;
const Card = () => <section />;
${holder}
const make = () => ${spelling};
const X = make();
const M = memo(make());
const A = ${spelling};
export const App = () => <><X /><M /><A /></>;
`;
    const r = scanGraph(
      {
        "src/direct.jsx": file("Card.Header = Header;", "Card.Header"),
        "src/alias.jsx": file("Card.Header = Header; const C = Card;", "C.Header"),
        "src/nested.jsx": file("const Group = () => <div />; Group.Header = Header; Card.Group = Group;", "Card.Group.Header"),
      },
      pathResolver(R),
      R,
    );
    const credited = (file: string) =>
      ids(r.occurrences)
        .filter((id) => id.startsWith(`local:${file}:`))
        .map((id) => id.slice(`local:${file}:`.length));
    const roster = (file: string) =>
      r.registry
        .localEntries()
        .filter((e) => e.filePath === file)
        .map((e) => e.exportName)
        .sort();
    expect(credited("src/direct.jsx")).toEqual(["Header@9", "M@9", "X@9"]);
    expect(roster("src/direct.jsx")).toEqual(expect.arrayContaining(["A", "M", "X"]));
    for (const file of ["src/alias.jsx", "src/nested.jsx"]) {
      expect(credited(file)).toEqual(credited("src/direct.jsx"));
      expect(roster(file).filter((name) => name !== "Group")).toEqual(roster("src/direct.jsx"));
    }
  });

  it("resolves a deep member chain in time linear in its depth", () => {
    const keys = Array.from({ length: 26 }, (_, i) => `k${i}`);
    const nested = keys.reduceRight((inner, key) => `{ ${key}: ${inner} }`, "Leaf");
    const started = performance.now();
    const r = run({
      "src/app.jsx": `const Leaf = () => <i />;\nconst icons = ${nested};\nconst Icon = icons.${keys.join(".")};\nexport const App = () => <Icon />;\n`,
    });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(r.ids).toEqual(["local:src/app.jsx:Leaf@4"]);
  });

  it("is not the member of a same-named declaration in a nested scope", () => {
    const r = run({
      "src/app.jsx": `const CardHeader = () => <header />;
const Card = () => <section />;
Card.Header = CardHeader;
export function App({ Other }) {
  const Card = Other;
  return <Card.Header />;
}
`,
    });
    expect(r.ids).toEqual([]);
  });

  it("terminates on members assigned to each other", () => {
    const r = run({
      "src/app.jsx": `const Card = () => <section />;
Card.Self = Card.Self;
Card.A = Card.B;
Card.B = Card.A;
const S = Card.Self;
export const App = () => <><Card.Self /><Card.A /><S /></>;
`,
    });
    expect(r.ids).toEqual([]);
  });

  it("ignores an assignment made from another function's body", () => {
    const r = run({
      "src/setter.jsx": `const FallbackGlyph = () => <svg />;
const parts = { Glyph: FallbackGlyph };
export function setGlyph(C) { parts.Glyph = C; }
export function App() { return <parts.Glyph />; }
`,
      "src/clear.jsx": `const FallbackGlyph = () => <svg />;
const parts = { Glyph: FallbackGlyph };
export function resetParts() { parts.Glyph = null; }
export function App() { return <parts.Glyph />; }
`,
      "src/holder.jsx": `const FallbackGlyph = () => <svg />;
const Card = () => <section />;
Card.Glyph = FallbackGlyph;
export function setGlyph(C) { Card.Glyph = C; }
export function setup() { Card.Other = FallbackGlyph; }
export function App() { return <><Card.Glyph /><Card.Other /></>; }
`,
    });
    expect(r.ids).toEqual(["local:src/clear.jsx:FallbackGlyph@4", "local:src/holder.jsx:FallbackGlyph@6", "local:src/setter.jsx:FallbackGlyph@4"]);
    expect(r.diagnostics).toEqual([["unresolved-reference", "Card"]]);
  });

  it("credits a member assigned in the body that declares the holder", () => {
    const r = run({
      "src/app.jsx": `const CardHeader = () => <header />;
export function App() {
  const Card = () => <section />;
  Card.Header = CardHeader;
  return <Card.Header />;
}
`,
    });
    expect(r.ids).toEqual(["local:src/app.jsx:CardHeader@5"]);
  });

  it("keeps the last assignment where a member is assigned twice", () => {
    const r = run({
      "src/app.jsx": `const First = () => <b />;
const Second = () => <i />;
const Card = () => <section />;
Card.Header = First;
Card.Header = Second;
export const App = () => <Card.Header />;
`,
    });
    expect(r.ids).toEqual(["local:src/app.jsx:Second@6"]);
  });
});
