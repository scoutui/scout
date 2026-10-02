/**
 * A function rendered as a JSX tag is a component whatever it returns:
 * the tag decides, not the function's body.
 */
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "@scoutui/reference-graph";
import { lineOf, scanGraph, pathResolver, relResolver } from "./shape-helpers.js";

type Resolver = (from: string, spec: string) => string | null;

function run(files: Record<string, string>, resolver: Resolver = pathResolver("/repo")) {
  const collector = createDiagnosticCollector();
  const { occurrences, registry } = scanGraph(files, resolver, "/repo", { collector });
  return { occurrences, registry, diagnostics: collector.drain() };
}
type Run = ReturnType<typeof run>;

const exportOf = (o: Run["occurrences"][number]) => (o.rawComponentId as { export?: string }).export;
const roster = (r: Run) => r.registry.localEntries().map((e) => `${e.filePath}#${e.exportName}`).sort();
const ownerOf = (o: Run["occurrences"][number]) => (o.rawOwnerComponentId as { export?: string } | undefined)?.export;

describe("the evaluator at a tag", () => {
  const PICK = "const Leaf = () => <i />;\nconst Pick = () => Leaf;";
  it.each([
    ["directly", { "src/App.tsx": `${PICK}\nexport function App() { return <Pick />; }` }],
    ["through an alias", { "src/App.tsx": `${PICK}\nconst Shown = Pick;\nexport function App() { return <Shown />; }` }],
    [
      "through memo",
      { "src/App.tsx": `import { memo } from "react";\n${PICK}\nconst Shown = memo(Pick);\nexport function App() { return <Shown />; }` },
    ],
    [
      "through an opaque wrapper",
      { "src/App.tsx": `import { withThing } from "kit";\n${PICK}\nconst Shown = withThing(Pick);\nexport function App() { return <Shown />; }` },
    ],
    [
      "through lazy",
      {
        "src/pick.tsx": `${PICK}\nexport default Pick;`,
        "src/App.tsx": `import { lazy } from "react";\nconst Shown = lazy(() => import("./pick.tsx"));\nexport function App() { return <Shown />; }`,
      },
    ],
    [
      "through a ternary with a host string",
      { "src/App.tsx": `${PICK}\nexport function App({ f }) { const Shown = f ? Pick : "div"; return <Shown />; }` },
    ],
    ["as a static member", { "src/App.tsx": `${PICK}\nconst NS = { Pick };\nexport function App() { return <NS.Pick />; }` }],
    [
      "through a dynamic map",
      { "src/App.tsx": `${PICK}\nconst MAP = { a: Pick };\nexport function App({ k }) { const Shown = MAP[k]; return <Shown />; }` },
    ],
    [
      "through a dispatcher",
      {
        "src/App.tsx": `${PICK}\nconst MAP = { a: Pick };\nfunction getMapped(k) { return MAP[k]; }\nexport function App({ k }) { const Shown = getMapped(k); return <Shown />; }`,
      },
    ],
  ])("a function that returns a component, rendered %s, never credits the component it returns", (_label, files) => {
    expect(run(files).occurrences.map(exportOf)).not.toContain("Leaf");
  });

  const PICK_MODULE = `${PICK}\nexport default Pick;`;
  const NOTICE_MODULE = `const Alpha = () => <b />;\nconst Beta = () => <i />;\nfunction pick(kind) { return kind === "a" ? Alpha : Beta; }\nexport default function Notice({ kind }) { const Shown = pick(kind); return Shown && <Shown />; }`;
  it.each([
    [
      "a lazy holder",
      {
        "src/pick.tsx": PICK_MODULE,
        "src/App.tsx": `import { lazy } from "react";\nimport { withThing } from "kit";\nconst LazyPick = lazy(() => import("./pick.tsx"));\nconst Shown = withThing(LazyPick);\nexport function App() { return <Shown />; }`,
      },
      ["Leaf"],
    ],
    [
      "a lazy holder of a component that renders a picked one",
      {
        "src/notice.tsx": NOTICE_MODULE,
        "src/App.tsx": `import { lazy } from "react";\nimport { withThing } from "kit";\nconst LazyNotice = lazy(() => import("./notice.tsx"));\nconst Shown = withThing(LazyNotice);\nexport function App() { return <Shown kind="a" />; }`,
      },
      ["Alpha", "Beta"],
    ],
    [
      "a member of an object that also holds a loader",
      {
        "src/App.tsx": `import { withThing } from "kit";\n${PICK}\nconst cfg = { loader: () => import("./x.tsx"), comp: Pick };\nconst Shown = withThing(cfg.comp);\nexport function App() { return <Shown />; }`,
      },
      ["Leaf"],
    ],
  ])("a component handed to an opaque wrapper as %s stays at the tag", (_label, files, never) => {
    const exports = run(files).occurrences.filter((o) => o.filePath === "src/App.tsx").map(exportOf);
    for (const name of never) expect(exports).not.toContain(name);
  });

  it("a callback handed to a data method, reached at a tag, is called, never credited", () => {
    const r = run({
      "src/App.tsx":
        "const Alpha = () => <b />;\nconst ALL = [Alpha];\nexport function App() { const Shown = ALL.find((c) => c.ok); return <Shown />; }",
    });
    expect(r.occurrences.map(exportOf)).not.toContain("Shown");
  });

  it("a member of an unseen hook's result stays late-bound at a tag when the hook is handed a function", () => {
    const r = run({
      "src/App.tsx": `import { useThing } from "kit";\nexport function App() { const { Icon } = useThing(() => null); return <Icon />; }`,
    });
    expect(r.occurrences).toEqual([]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["late-bound-render"]);
  });

  it.each([
    ["memo(() => null)", `import { memo } from "react";\nconst Q = memo(() => null);`, "Q"],
    ["forwardRef returning its children", `import { forwardRef } from "react";\nconst Q = forwardRef(({ children }, ref) => children);`, "Q"],
    ["memo(() => null) held by an object literal", `import { memo } from "react";\nconst Q = memo(() => null);\nconst NS = { Q };`, "NS.Q"],
  ])("a reference to %s at a tag names that reference, never the render site's binding", (_label, decls, ref) => {
    const r = run({
      "src/App.tsx": `${decls}\nconst Target = () => <b />;\nexport function App({ f }) { const W = f ? ${ref} : Target; return <W />; }`,
    });
    expect(r.occurrences.map(exportOf)).not.toContain("W");
    expect(r.occurrences.map(exportOf).sort()).toEqual(["Q", "Target"]);
  });

  it("a component whose body renders a picked component is credited only for itself at its own tag", () => {
    const source = `
        const Alpha = () => <b />;
        const Beta = () => <i />;
        function pick(kind) { return kind === "a" ? Alpha : Beta; }
        function Notice({ kind }) { const Shown = pick(kind); return Shown && <Shown />; }
        export function App() { return <Notice kind="a" />; }
      `;
    const r = run({ "src/App.tsx": source });
    const atNotice = r.occurrences.filter((o) => o.line === lineOf(source, "<Notice"));
    expect(atNotice.map(exportOf)).toEqual(["Notice"]);
  });

  it("a cyclic alias rendered as a tag terminates, credits nothing and reports unresolved-reference", () => {
    const source = `
        const A = B;
        const B = A;
        export function App() { return <A />; }
      `;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<A"))).toEqual([]);
    expect(r.diagnostics.filter((d) => d.code === "unresolved-reference").map((d) => ("symbol" in d ? d.symbol : ""))).toEqual(["A"]);
  });

  it("a JSX-returning component keeps its identity and chain through memo, lazy, an alias and a ternary", () => {
    const r = run(
      {
        "src/Card.tsx": "export const Card = () => <div />;\nexport default function Page() { return <main />; }",
        "src/App.tsx": `
          import { memo, lazy } from "react";
          import { Card } from "./Card";
          const MemoCard = memo(Card);
          const LazyPage = lazy(() => import("./Card"));
          const Alias = Card;
          export function App({ flat }) {
            const Tag = flat ? "div" : Card;
            return <section><MemoCard /><LazyPage /><Alias /><Tag /></section>;
          }
        `,
      },
      relResolver("/repo"),
    );
    const chains = r.occurrences
      .filter((o) => o.filePath === "src/App.tsx")
      .map((o) => `${exportOf(o)} ${o.viaChain.map((v) => v.kind).join(">")}`)
      .sort();
    expect(chains).toEqual([
      "Card local-component",
      "Card local-component",
      "Card local-component>hoc-wrapper",
      "Page local-component>lazy-import",
    ]);
  });

  it.each([
    ["<Ctx.Provider>", "<ThemeCtx.Provider value={1} />", true],
    ["React 19 <Ctx value>", "<ThemeCtx value={1} />", true],
    ["memo(Ctx)", "<Themed />", false],
  ])("a named function returning no JSX, used as a context default, is never credited at %s", (_label, jsx, reportsNothing) => {
    const r = run({
      "src/theme.tsx": `import { createContext, memo } from "react";\nconst Fallback = () => null;\nexport const ThemeCtx = createContext(Fallback);\nexport const Themed = memo(ThemeCtx);\nexport function App() { return ${jsx}; }`,
    });
    expect(r.occurrences).toEqual([]);
    expect(r.registry.localEntries().map((e) => e.exportName)).not.toContain("Fallback");
    if (reportsNothing) expect(r.diagnostics).toEqual([]);
  });
});

describe("a declaration a tag lands on as a function is a member", () => {
  it("a component returning a portal is a member and owns the JSX inside it", () => {
    const r = run(
      {
        "src/leaves.tsx": "export const Dialog = () => <dialog />;",
        "src/owners.tsx": `
          import { createPortal } from "react-dom";
          import { Dialog } from "./leaves";
          export const PortalModal = () => createPortal(<Dialog />, document.body);
        `,
        "src/app.tsx": `import { PortalModal } from "./owners";\nexport const App = () => <main><PortalModal /></main>;`,
      },
      relResolver("/repo"),
    );
    expect(roster(r)).toContain("src/owners.tsx#PortalModal");
    const dialog = r.occurrences.filter((o) => exportOf(o) === "Dialog");
    expect(dialog.map((o) => `${ownerOf(o)} ${o.viaChain.map((v) => v.kind).join(">")}`)).toEqual(["PortalModal direct-import"]);
  });

  it("a function reached only through memo is a member and owns its JSX", () => {
    const r = run(
      {
        "src/leaf.tsx": "export const Leaf = () => <i />;",
        "src/panel.tsx": `
          import { memo } from "react";
          import { createPortal } from "react-dom";
          import { Leaf } from "./leaf";
          function Panel() { return createPortal(<Leaf />, document.body); }
          export default memo(Panel);
        `,
        "src/app.tsx": `import Panel from "./panel";\nexport const App = () => <Panel />;`,
      },
      relResolver("/repo"),
    );
    expect(roster(r)).toContain("src/panel.tsx#Panel");
    expect(r.occurrences.filter((o) => exportOf(o) === "Leaf").map(ownerOf)).toEqual(["Panel"]);
  });

  it("a function reached only through lazy is a member and owns its JSX", () => {
    const r = run(
      {
        "src/leaf.tsx": "export const Leaf = () => <i />;",
        "src/view.tsx": `
          import { createPortal } from "react-dom";
          import { Leaf } from "./leaf";
          export default function View() { return createPortal(<Leaf />, document.body); }
        `,
        "src/app.tsx": `
          import { lazy } from "react";
          const LazyView = lazy(() => import("./view"));
          export const App = () => <LazyView />;
        `,
      },
      relResolver("/repo"),
    );
    expect(roster(r)).toContain("src/view.tsx#View");
    expect(r.occurrences.filter((o) => exportOf(o) === "Leaf").map(ownerOf)).toEqual(["View"]);
  });

  it("an alias names the function it refers to: the function is the member, the alias is not", () => {
    const r = run({
      "src/App.tsx": `
        import { createPortal } from "react-dom";
        const Base = () => createPortal(<b />, document.body);
        const Alias = Base;
        export function App() { return <Alias />; }
      `,
    });
    expect(roster(r)).toContain("src/App.tsx#Base");
    expect(roster(r)).not.toContain("src/App.tsx#Alias");
  });

  it.each([
    ["alone", "memo(() => null)"],
    ["next to a component argument", "memo(() => null, Leaf)"],
  ])("a wrapped anonymous function is a member under its holder's name (%s)", (_label, call) => {
    const r = run({
      "src/App.tsx": `
        import { memo } from "react";
        const Leaf = () => <i />;
        const Quiet = ${call};
        export function App() { return <Quiet />; }
      `,
    });
    expect(roster(r)).toContain("src/App.tsx#Quiet");
    expect(r.occurrences.filter((o) => o.viaChain.some((v) => v.kind === "passed-as-argument"))).toEqual([]);
  });

  it.each([
    ["memo", "memo((p) => createElement(Leaf, p))"],
    ["forwardRef", "forwardRef((p, ref) => createElement(Leaf, p))"],
  ])("a %s holder of an inline function whose body credits only another component is credited at its tag and stays a member", (_label, call) => {
    const source = `import { memo, forwardRef, createElement } from "react";\nconst Leaf = () => <i />;\nconst Shown = ${call};\nexport function App() { return <Shown />; }`;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<Shown")).map(exportOf)).toEqual(["Shown"]);
    expect(roster(r)).toContain("src/App.tsx#Shown");
  });

  it("a default-exported memo of an inline function whose body credits only another component stays the default member", () => {
    const r = run(
      {
        "src/shown.tsx": `import { memo, createElement } from "react";\nconst Leaf = () => <i />;\nexport default memo((p) => createElement(Leaf, p));`,
        "src/app.tsx": `import Shown from "./shown";\nexport const App = () => <Shown />;`,
      },
      relResolver("/repo"),
    );
    expect(r.occurrences.filter((o) => o.filePath === "src/app.tsx").map(exportOf)).toEqual(["default"]);
    const entries = r.registry.localEntries().filter((e) => e.filePath === "src/shown.tsx");
    expect(entries.map((e) => [e.exportName, e.isDefault]).sort()).toEqual([
      ["Leaf", false],
      ["default", true],
    ]);
  });

  it("a class component whose render returns null is a member", () => {
    const r = run({
      "src/App.tsx": `
        import { Component } from "react";
        class Quiet extends Component { render() { return null; } }
        export function App() { return <Quiet />; }
      `,
    });
    expect(roster(r)).toContain("src/App.tsx#Quiet");
  });

  it("an anonymous default export returning null, rendered through a default import, is a default member", () => {
    const r = run(
      {
        "src/empty.tsx": "export default () => null;",
        "src/app.tsx": `import Empty from "./empty";\nexport const App = () => <Empty />;`,
      },
      relResolver("/repo"),
    );
    const entry = r.registry.localEntries().find((e) => e.filePath === "src/empty.tsx");
    expect(entry).toMatchObject({ exportName: "default", isDefault: true });
  });

  it("a nested function rendered as a tag is the member, not a module-scope string sharing its name", () => {
    const source = `
        export const Tile = "x";
        export function Gallery() {
          const Tile = () => null;
          return <Tile />;
        }
      `;
    const r = run({ "src/App.tsx": source });
    const tiles = r.registry.localEntries().filter((e) => e.exportName === "Tile");
    expect(tiles.map((e) => e.loc.line)).toEqual([lineOf(source, "const Tile = () => null")]);
  });

  it.each([
    [
      "an alias of it",
      `
        export const Row = "x";
        export function A() { const Row = () => null; const R = Row; return <R />; }
      `,
    ],
    [
      "a union with it",
      `
        export const Row = "x";
        export function A({ f }) { const Row = () => null; const Other = () => null; const R = f ? Row : Other; return <R />; }
      `,
    ],
    [
      "an alias of it, next to a sibling scope's string of the same name",
      `
        export function A() { const Row = "x"; return <p>{Row}</p>; }
        export function B() { const Row = () => null; const R = Row; return <R />; }
      `,
    ],
  ])("a nested function reached at a tag through %s is the member, not a string sharing its name", (_label, source) => {
    const r = run({ "src/App.tsx": source });
    const rows = r.registry.localEntries().filter((e) => e.exportName === "Row");
    expect(rows.map((e) => e.loc.line)).toEqual([lineOf(source, "const Row = () => null")]);
  });

  it("a nested function shadowing an imported string, rendered through an alias, is the nested function: credited and a member, and the string never a member", () => {
    const source = `import { Row } from "./row";\nexport function A() { const Row = () => null; const R = Row; return <R />; }`;
    const r = run({ "src/row.tsx": `export const Row = "x";`, "src/App.tsx": source }, relResolver("/repo"));
    expect(r.occurrences.map((o) => `${(o.rawComponentId as { source?: { filePath?: string } }).source?.filePath}#${exportOf(o)}`)).toEqual([
      "src/App.tsx#Row",
    ]);
    expect(r.occurrences.map((o) => o.viaChain)).toEqual([[{ kind: "local-component" }]]);
    expect(r.diagnostics).toEqual([]);
    expect(roster(r)).toContain("src/App.tsx#Row");
    expect(roster(r)).not.toContain("src/row.tsx#Row");
  });

  it("a nested component shadowing an imported one, wrapped in memo, is the nested component under a hoc-wrapper hop naming no import", () => {
    const r = run(
      {
        "src/row.tsx": "export function Row() { return <tr />; }",
        "src/App.tsx": `import { memo } from "react";\nimport { Row } from "./row";\nexport function A() { const Row = () => <td />; const M = memo(Row); return <M />; }`,
      },
      relResolver("/repo"),
    );
    const rows = r.occurrences.filter((o) => exportOf(o) === "Row");
    expect(rows.map((o) => (o.rawComponentId as { source?: { filePath?: string } }).source?.filePath)).toEqual(["src/App.tsx"]);
    expect(rows.map((o) => o.viaChain)).toEqual([
      [{ kind: "local-component" }, { kind: "hoc-wrapper", hocCallee: "memo" }],
    ]);
  });

  it("a nested function shadowing an imported string, rendered directly, is the nested function: credited and a member, and the string never a member", () => {
    const r = run(
      {
        "src/row.tsx": `export const Row = "x";`,
        "src/App.tsx": `import { Row } from "./row";\nexport function A() { const Row = () => null; return <Row />; }`,
      },
      relResolver("/repo"),
    );
    expect(r.occurrences.map((o) => `${(o.rawComponentId as { source?: { filePath?: string } }).source?.filePath}#${exportOf(o)}`)).toEqual([
      "src/App.tsx#Row",
    ]);
    expect(r.occurrences.map((o) => o.viaChain)).toEqual([[{ kind: "local-component" }]]);
    expect(r.diagnostics).toEqual([]);
    expect(roster(r)).toContain("src/App.tsx#Row");
    expect(roster(r)).not.toContain("src/row.tsx#Row");
  });

  it.each([
    ["a string", 'export const Row = "x";'],
    ["an object", "export const Row = { a: 1 };"],
    ["an array", "export const Row = [1];"],
    ["a JSX value", "export const Row = <b />;"],
    ["an unknown value", "export const Row = 42;"],
    ["a parameter", "export function f(Row) { return Row; }"],
    ["a function", "export const Row = () => null;"],
    ["a call", 'import { memo } from "react";\nexport const Row = memo(() => null);'],
  ])("an imported name a nested function shadows at a tag, declared as %s, is the nested function: credited and a member, and the import never marked", (_label, decl) => {
    const r = run(
      {
        "src/row.tsx": decl,
        "src/App.tsx": `import { Row } from "./row";\nexport function A() { const Row = () => null; return <Row />; }`,
      },
      relResolver("/repo"),
    );
    const credited = r.occurrences.map((o) => `${(o.rawComponentId as { source?: { filePath?: string } }).source?.filePath}#${exportOf(o)}`);
    expect(credited).toEqual(["src/App.tsx#Row"]);
    expect(roster(r)).toContain("src/App.tsx#Row");
    expect(roster(r)).not.toContain("src/row.tsx#Row");
  });

  it("a function held by an object literal and rendered as its member makes no row, not even the holder", () => {
    const r = run({
      "src/App.tsx": `
        const NS = { Quiet: () => null };
        export function App() { return <NS.Quiet />; }
      `,
    });
    expect(roster(r)).toEqual(["src/App.tsx#App"]);
  });

  it("a JSX value rendered as a tag is not a member", () => {
    const r = run({
      "src/App.tsx": `
        const Shown = <b />;
        export function App() { return <Shown />; }
      `,
    });
    expect(roster(r)).toEqual(["src/App.tsx#App"]);
  });

  it("a function only called, or only handed to a hook, is not a member", () => {
    const r = run({
      "src/App.tsx": `
        import { useReducer } from "react";
        function Reducer(state) { return state; }
        function Helper() { return null; }
        export function App() { const [s] = useReducer(Reducer, 0); Helper(); return <div>{s}</div>; }
      `,
    });
    expect(roster(r)).not.toContain("src/App.tsx#Reducer");
    expect(roster(r)).not.toContain("src/App.tsx#Helper");
  });
});

describe("values that are not components stay uncredited", () => {
  it("a JSX value handed to a hook is not credited as a component", () => {
    const r = run({
      "src/App.tsx": `
        import { useSlot } from "kit";
        const Placeholder = <span />;
        export function App() { useSlot(Placeholder); return <div />; }
      `,
    });
    expect(r.occurrences.filter((o) => o.viaChain.some((v) => v.kind === "passed-as-argument"))).toEqual([]);
  });

  it("a member rendered off a map lookup has no name: nothing is credited and the render reports", () => {
    const source = `
        const FIELDS = { text: { factory: () => null }, date: { factory: () => null } };
        export function Field({ type }) { const cfg = FIELDS[type]; return <cfg.factory />; }
      `;
    const r = run({ "src/Field.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<cfg.factory"))).toEqual([]);
    expect(r.diagnostics.filter((d) => d.code === "unresolved-reference")).toHaveLength(1);
  });

  it("a component read from a context with a null default credits nothing at its tag", () => {
    const r = run({
      "src/App.tsx": `
        import { createContext, useContext } from "react";
        const Slot = createContext(null);
        export function Host() { const Impl = useContext(Slot); return <Impl />; }
      `,
    });
    expect(r.occurrences).toEqual([]);
  });

  it("memo of a context with a null default credits nothing", () => {
    const r = run({
      "src/App.tsx": `
        import { createContext, memo } from "react";
        const Slot = createContext(null);
        const Held = memo(Slot);
        export function App() { return <Held />; }
      `,
    });
    expect(r.occurrences).toEqual([]);
  });

  it("a lazy import of a module whose default is not a function credits nothing", () => {
    const r = run(
      {
        "src/card.tsx": "export default 42;",
        "src/app.tsx": `import { lazy } from "react";\nconst Card = lazy(() => import("./card"));\nexport function App() { return <Card />; }`,
      },
      relResolver("/repo"),
    );
    expect(r.occurrences.filter((o) => o.filePath === "src/app.tsx")).toEqual([]);
  });

  it("a JSX value handed to a hook is not credited when another function declares a component of the same name", () => {
    const r = run({
      "src/App.tsx": `
        import { useSlot } from "kit";
        export function A() { const Icon = <b />; useSlot(Icon); return <div />; }
        export function B() { const Icon = () => <i />; return <Icon />; }
      `,
    });
    expect(r.occurrences.filter((o) => o.viaChain.some((v) => v.kind === "passed-as-argument"))).toEqual([]);
  });

  it("a context under memo credits nothing when a function declares a component of the same name", () => {
    const source = `
        import { createContext, memo } from "react";
        const Slot = createContext(null);
        const Held = memo(Slot);
        export function A() { return <Held />; }
        export function B() { const Slot = () => <i />; return <Slot />; }
      `;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<Held"))).toEqual([]);
  });

  it("a lazy import of a constant credits nothing when the target file declares a component of the same name in a function", () => {
    const r = run(
      {
        "src/card.tsx": "export const Thing = 42;\nexport function Other() { const Thing = () => null; return <Thing />; }",
        "src/app.tsx": `import { lazy } from "react";\nconst Card = lazy(() => import("./card").then((m) => ({ default: m.Thing })));\nexport function App() { return <Card />; }`,
      },
      relResolver("/repo"),
    );
    expect(r.occurrences.filter((o) => o.filePath === "src/app.tsx")).toEqual([]);
  });

  it("a member rendered off an imported map lookup has no name: nothing is credited and the render reports", () => {
    const r = run(
      {
        "src/fields.tsx": `
          const FIELDS = { text: { factory: () => null }, date: { factory: () => null } };
          const key = globalThis.kind;
          export const cfg = FIELDS[key];
        `,
        "src/App.tsx": `import { cfg } from "./fields";\nexport function App() { return <cfg.factory />; }`,
      },
      relResolver("/repo"),
    );
    expect(r.occurrences.filter((o) => o.filePath === "src/App.tsx")).toEqual([]);
    expect(r.diagnostics.filter((d) => d.code === "unresolved-reference")).toHaveLength(1);
  });

  it("a member rendered off a workspace sibling's call result has no name: nothing is credited and the render reports", () => {
    const r = run(
      {
        "packages/kit/src/index.tsx": "const makeApi = () => ({ View: () => null });\nexport const api = makeApi();",
        "apps/web/src/App.tsx": `import { api } from "@ws/kit";\nexport function App() { return <api.View />; }`,
      },
      (_from, spec) => (spec === "@ws/kit" ? "/repo/packages/kit/src/index.tsx" : null),
    );
    expect(r.occurrences.filter((o) => o.filePath === "apps/web/src/App.tsx")).toEqual([]);
    expect(r.diagnostics.filter((d) => d.code === "unresolved-reference")).toHaveLength(1);
  });

  it("a member rendered off a body-local call result that shadows a module-scope object has no name: nothing is credited and the render reports", () => {
    const source = `
        const NS = { Item: () => <i /> };
        function make() { return { Item: () => <b /> }; }
        export function App() { const NS = make(); return <NS.Item />; }
      `;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<NS.Item"))).toEqual([]);
    expect(r.diagnostics.filter((d) => d.code === "unresolved-reference")).toHaveLength(1);
  });

  it("a JSX value handed to an opaque wrapper credits nothing at the wrapper's tag", () => {
    const source = `
        import { withSlot } from "kit";
        const Placeholder = <span />;
        export const Slotted = withSlot(Placeholder);
        export function App() { return <Slotted />; }
      `;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<Slotted"))).toEqual([]);
  });

  it("a JSX value rendered as a tag credits nothing when it shadows a module-scope component of the same name", () => {
    const source = `
        export const Banner = () => <b />;
        export function App() { const Banner = <i />; return <Banner />; }
      `;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<Banner"))).toEqual([]);
  });

  it("a JSX value held by an object literal and rendered as its member credits nothing", () => {
    const source = "const NS = { Item: <b /> };\nexport function App() { return <NS.Item />; }";
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<NS.Item"))).toEqual([]);
  });
});

describe("components reached through an alias or a factory stay credited", () => {
  const passedAsArgument = (r: Run) => r.occurrences.filter((o) => o.viaChain.some((v) => v.kind === "passed-as-argument"));

  it("a component reached only through an alias and handed to a hook is credited at the argument", () => {
    const r = run({
      "src/App.tsx": `
        import { useModal } from "kit";
        function Impl() { return <b />; }
        const Alias = Impl;
        export function App() { useModal(Alias); return <div />; }
      `,
    });
    expect(passedAsArgument(r).map((o) => [exportOf(o), ownerOf(o)])).toEqual([["Impl", "App"]]);
  });

  it("a component reached only through an alias and handed to a local factory is credited at the argument, owned by the product", () => {
    const r = run({
      "src/App.tsx": `
        function Impl() { return <i />; }
        const Alias = Impl;
        function createSlot(C) { return () => <div><C /></div>; }
        export const Slot = createSlot(Alias);
        export function App() { return <Slot />; }
      `,
    });
    expect(passedAsArgument(r).map((o) => [exportOf(o), ownerOf(o)])).toEqual([["Impl", "Slot"]]);
  });

  it("a function returning null that a tag renders through memo is a component at an argument site: its memo handed to a local factory credits it there", () => {
    const r = run({
      "src/App.tsx": `
        import { memo } from "react";
        const Quiet = () => null;
        const Held = memo(Quiet);
        function createSlot(C) { return () => <div><C /></div>; }
        export const Slot = createSlot(Held);
        export function App() { return <div><Slot /><Held /></div>; }
      `,
    });
    expect(passedAsArgument(r).map((o) => [exportOf(o), ownerOf(o)])).toEqual([["Quiet", "Slot"]]);
  });

  it("a factory product rendered as a tag is credited", () => {
    const source = `
        function Base() { return <input />; }
        function makeControl(C) { return (props) => <C {...props} />; }
        const Field = makeControl(Base);
        export function App() { return <Field />; }
      `;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<Field")).map(exportOf)).toEqual(["Field"]);
  });
});

describe("a function rendered as a tag is credited whatever it returns", () => {
  it("a portal, a formatted call and an invoked useCallback each render a component", () => {
    const r = run(
      {
        "src/leaves.jsx": `
          export const Dialog = () => <dialog />;
          export const HelpLink = () => <a>help</a>;
          export const TabStrip = () => <ul />;
          export const Plain = () => <p />;
        `,
        "src/owners.jsx": `
          import { createPortal } from 'react-dom';
          import { useCallback } from 'react';
          import { Dialog, HelpLink, TabStrip, Plain } from './leaves.jsx';
          const format = (key, values) => values.link;
          export const PortalModal = () => createPortal(<Dialog />, document.body);
          export const Notice = () => format('notice', { link: <HelpLink /> });
          export const Tabs = ({ items }) => useCallback(() => <TabStrip items={items} />, [items])();
          export const Control = () => <Plain />;
        `,
        "src/app.jsx": `
          import { PortalModal, Notice, Tabs, Control } from './owners.jsx';
          export const App = () => <main><PortalModal /><Notice /><Tabs items={[]} /><Control /></main>;
        `,
      },
      pathResolver("/repo"),
    );
    const rows = r.occurrences
      .map((o) => `${o.filePath} ${exportOf(o)} owner=${ownerOf(o)} ${o.viaChain.map((v) => v.kind).join(">")}`)
      .sort();
    expect(rows).toEqual([
      "src/app.jsx Control owner=App direct-import",
      "src/app.jsx Notice owner=App direct-import",
      "src/app.jsx PortalModal owner=App direct-import",
      "src/app.jsx Tabs owner=App direct-import",
      "src/owners.jsx Dialog owner=PortalModal direct-import",
      "src/owners.jsx HelpLink owner=Notice direct-import",
      "src/owners.jsx Plain owner=Control direct-import",
      "src/owners.jsx TabStrip owner=Tabs direct-import",
    ]);
    expect(r.diagnostics.filter((d) => d.code === "unresolved-reference")).toEqual([]);
  });

  it("a component returning useMemo is credited directly and lazily, and owns its JSX", () => {
    const r = run(
      {
        "src/header.jsx": "export const ModalHeader = () => <header />;",
        "src/content.jsx": `
          import { useMemo } from "react";
          import { ModalHeader } from "./header.jsx";
          const Content = (props) => {
            const { onClose } = props;
            return useMemo(() => (<><ModalHeader onClose={onClose} /></>), [onClose]);
          };
          export { Content };
        `,
        "src/app.jsx": `
          import { lazy } from "react";
          import { Content } from "./content.jsx";
          const LazyContent = lazy(() => import("./content.jsx").then((m) => m.Content));
          export const App = () => <div><Content /><LazyContent /></div>;
        `,
      },
      pathResolver("/repo"),
    );
    expect(roster(r)).toContain("src/content.jsx#Content");
    const content = r.occurrences
      .filter((o) => exportOf(o) === "Content")
      .map((o) => o.viaChain.map((v) => v.kind).join(">"))
      .sort();
    expect(content).toEqual(["direct-import", "local-component>lazy-import"]);
    expect(r.occurrences.filter((o) => exportOf(o) === "ModalHeader").map(ownerOf)).toEqual(["Content"]);
    expect(r.diagnostics.filter((d) => d.code === "lazy-import-unsupported" || d.code === "unresolved-reference")).toEqual([]);
  });

  it.each([
    ["null", "const Quiet = () => null;"],
    ["its children", "const Quiet = ({ children }) => children;"],
    ["a string", 'const Quiet = () => "*****";'],
    ["createElement", 'import { createElement } from "react";\nconst Quiet = (p) => createElement("b", p);'],
    ["a class render of null", 'import { Component } from "react";\nclass Quiet extends Component { render() { return null; } }'],
  ])("a component returning %s is credited at its tag", (_label, decl) => {
    const source = `${decl}\nexport function App() { return <Quiet />; }`;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<Quiet")).map(exportOf)).toEqual(["Quiet"]);
    expect(r.diagnostics.filter((d) => d.code === "unresolved-reference")).toEqual([]);
  });

  it.each([
    ["a relative import", "./quiet", relResolver("/repo")],
    ["a workspace sibling's import", "@ws/quiet", (_from: string, spec: string) => (spec === "@ws/quiet" ? "/repo/src/quiet.tsx" : null)],
  ])("a component returning null, rendered through %s, is credited and a member at its source file", (_label, specifier, resolver) => {
    const r = run(
      {
        "src/quiet.tsx": "export const Quiet = () => null;",
        "src/app.tsx": `import { Quiet } from "${specifier}";\nexport const App = () => <Quiet />;`,
      },
      resolver,
    );
    const quiet = r.occurrences.filter((o) => o.filePath === "src/app.tsx");
    expect(
      quiet.map((o) => `${exportOf(o)} ${(o.rawComponentId as { source?: { filePath?: string } }).source?.filePath}`),
    ).toEqual(["Quiet src/quiet.tsx"]);
    expect(roster(r)).toContain("src/quiet.tsx#Quiet");
  });

  it("an anonymous default export returning null is credited through a default import", () => {
    const r = run(
      { "src/empty.tsx": "export default () => null;", "src/app.tsx": `import Empty from "./empty";\nexport const App = () => <Empty />;` },
      relResolver("/repo"),
    );
    expect(r.occurrences.filter((o) => o.filePath === "src/app.tsx").map(exportOf)).toEqual(["default"]);
  });

  it("a ternary of a string and a function returning null credits the function", () => {
    const source = `const Card = () => null;\nexport function App({ flat }) { const Tag = flat ? "div" : Card; return <Tag />; }`;
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<Tag")).map(exportOf)).toEqual(["Card"]);
  });

  it("a function that returns a component is credited for itself", () => {
    const source = "const Leaf = () => <i />;\nconst Pick = () => Leaf;\nexport function App() { return <Pick />; }";
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<Pick")).map(exportOf)).toEqual(["Pick"]);
  });

  it("a self-rendering component is credited at both tags", () => {
    const source =
      "function Tree({ depth }) { return depth ? <Tree depth={depth - 1} /> : null; }\nexport function App() { return <Tree depth={2} />; }";
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.map(exportOf).sort()).toEqual(["Tree", "Tree"]);
  });

  it("a component that returns no JSX is credited at its tag, and an argument site still judges it by shape", () => {
    const r = run({
      "src/App.tsx": `
        import { createPortal } from "react-dom";
        import { useModal } from "kit";
        const Modal = () => createPortal(<b />, document.body);
        export function App() { const open = useModal(Modal); return <div onClick={open}><Modal /></div>; }
      `,
    });
    const modal = r.occurrences.filter((o) => exportOf(o) === "Modal").map((o) => o.viaChain[0]?.kind);
    expect(modal).toEqual(["local-component"]);
  });

  it("a component returning null imported through a barrel is credited and a member at its source file", () => {
    const r = run(
      {
        "src/quiet.tsx": "export const Quiet = () => null;",
        "src/index.tsx": 'export { Quiet } from "./quiet";',
        "src/app.tsx": `import { Quiet } from "./index";\nexport const App = () => <Quiet />;`,
      },
      relResolver("/repo"),
    );
    const quiet = r.occurrences.filter((o) => o.filePath === "src/app.tsx");
    expect(
      quiet.map((o) => `${exportOf(o)} ${(o.rawComponentId as { source?: { filePath?: string } }).source?.filePath}`),
    ).toEqual(["Quiet src/quiet.tsx"]);
    expect(roster(r)).toContain("src/quiet.tsx#Quiet");
    expect(roster(r)).not.toContain("src/index.tsx#Quiet");
  });

  it("an inline member of an object literal is credited under its compound name", () => {
    const source = "const NS = { Inline: () => null };\nexport function App() { return <NS.Inline />; }";
    const r = run({ "src/App.tsx": source });
    expect(r.occurrences.filter((o) => o.line === lineOf(source, "<NS.Inline")).map(exportOf)).toEqual(["NS.Inline"]);
  });
});
