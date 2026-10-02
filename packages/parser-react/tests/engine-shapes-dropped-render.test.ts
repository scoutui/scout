/**
 * A React JSX render that produces no occurrence reports exactly one
 * of lazy-import-unsupported / unresolved-reference / late-bound-render at
 * its position; a render that produces an occurrence, resolved or not,
 * reports none of them, and so does a tag whose value is a string.
 */
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector, type EngineDiagnostic } from "@scoutui/reference-graph";
import { scanGraph, pathResolver, relResolver } from "./shape-helpers.js";

const DROP_CODES = new Set([
  "lazy-import-unsupported",
  "unresolved-reference",
  "late-bound-render",
]);

type Resolver = (from: string, spec: string) => string | null;

function run(files: Record<string, string>, resolver: Resolver = pathResolver("/repo")) {
  const collector = createDiagnosticCollector();
  const firstParty = (abs: string) => abs.startsWith("/repo/");
  const { occurrences, registry } = scanGraph(files, resolver, "/repo", { collector }, { firstParty });
  return { occurrences, registry, diagnostics: collector.drain().filter((d) => DROP_CODES.has(d.code)) };
}

type Run = ReturnType<typeof run>;

/** The local roster, sorted: the `components[]` side of the payload. */
function roster(r: Run): string[] {
  return r.registry
    .localEntries()
    .map((e) => `${e.filePath}#${e.exportName}`)
    .sort();
}
type Positioned = Extract<EngineDiagnostic, { line: number }>;

function dropFor(r: Run, symbol: string, memberChain: string[] = []): Positioned {
  const hits = r.diagnostics.filter(
    (d): d is Positioned =>
      "symbol" in d && d.symbol === symbol && d.memberChain.join(".") === memberChain.join("."),
  );
  expect(hits).toHaveLength(1);
  const d = hits[0] as Positioned;
  expect(r.occurrences.filter((o) => o.filePath === d.filePath && o.line === d.line && o.column === d.column)).toEqual([]);
  expect(r.diagnostics.filter((x) => "line" in x && x.filePath === d.filePath && x.line === d.line && x.column === d.column)).toHaveLength(1);
  return d;
}

function creditedWithoutDiagnostic(r: Run, exportName: string): void {
  const occ = r.occurrences.find((o) => (o.rawComponentId as { export?: string }).export === exportName);
  expect(occ).toBeDefined();
  expect(
    r.diagnostics.filter((d) => "line" in d && d.filePath === occ?.filePath && d.line === occ?.line && d.column === occ?.column),
  ).toEqual([]);
}

describe("dropped renders", () => {
  it("an unbound root is an unresolved occurrence and reports nothing", () => {
    const r = run({ "src/App.tsx": "export function App() { return <Ghost />; }" });
    expect(r.occurrences.map((o) => o.unresolved)).toEqual([{ kind: "unbound-name", name: "Ghost" }]);
    expect(r.diagnostics).toEqual([]);
  });

  it.each([
    ["`this`", "export class App { render() { return <this.props.icon />; } }", "this", ["props", "icon"]],
    ["a catch-clause parameter", "export function App() { try { return null; } catch (Err) { return <Err />; } }", "Err", []],
  ])("a render rooted in %s is never an unbound name and reports unresolved-reference", (_label, app, symbol, memberChain) => {
    const r = run({ "src/App.tsx": app });
    expect(dropFor(r, symbol, memberChain).code).toBe("unresolved-reference");
    expect(r.occurrences).toEqual([]);
  });

  it("an import the resolver cannot resolve is an unresolved occurrence and reports nothing", () => {
    const r = run(
      { "src/App.tsx": `import { Card } from "./card";\nexport function App() { return <Card />; }` },
      () => null,
    );
    expect(r.occurrences.map((o) => o.unresolved)).toEqual([{ kind: "module-not-found" }]);
    expect(r.diagnostics).toEqual([]);
  });

  it("a relative import of a non-component export reports unresolved-reference", () => {
    const r = run(
      {
        "src/util.tsx": "export const Config = { a: 1 };",
        "src/App.tsx": `import { Config } from "./util";\nexport function App() { return <Config />; }`,
      },
      relResolver("/repo"),
    );
    expect(dropFor(r, "Config").code).toBe("unresolved-reference");
  });

  it("a relative import of a file outside the graph reports unresolved-reference", () => {
    const r = run({ "src/App.tsx": `import Logo from "./logo.svg";\nexport function App() { return <Logo />; }` });
    expect(dropFor(r, "Logo").code).toBe("unresolved-reference");
  });

  it("a workspace-sibling import with a missing member reports unresolved-reference", () => {
    const r = run(
      {
        "packages/ui/src/index.tsx": "export function Card() { return <div />; }",
        "src/App.tsx": `import { Card } from "@acme/ui";\nexport function App() { return <Card.Header />; }`,
      },
      (_from, spec) => (spec === "@acme/ui" ? "/repo/packages/ui/src/index.tsx" : null),
    );
    expect(dropFor(r, "Card", ["Header"]).code).toBe("unresolved-reference");
  });

  it("a namespace import's member its module does not export reports unresolved-reference", () => {
    const r = run(
      {
        "src/ui.tsx": "export function Button() { return <button />; }",
        "src/App.tsx": `import * as UI from "./ui";\nexport function App() { return <UI.Missing />; }`,
      },
      relResolver("/repo"),
    );
    expect(dropFor(r, "UI", ["Missing"]).code).toBe("unresolved-reference");
  });

  it("a prop rendered by the receiver reports late-bound-render; the receiver is credited", () => {
    const r = run({
      "src/App.tsx": `
        function Star() { return <svg />; }
        function Frame({ component: Component }) { return <Component />; }
        export function App() { return <Frame component={Star} />; }
      `,
    });
    expect(dropFor(r, "Component").code).toBe("late-bound-render");
    creditedWithoutDiagnostic(r, "Frame");
  });

  it("a static-assignment compound member is credited", () => {
    const r = run({
      "src/App.tsx": `
        function CardHeader() { return <h2 />; }
        function Card({ children }) { return <div>{children}</div>; }
        Card.Header = CardHeader;
        export function App() { return <Card><Card.Header /></Card>; }
      `,
    });
    expect(r.diagnostics).toEqual([]);
    creditedWithoutDiagnostic(r, "CardHeader");
    creditedWithoutDiagnostic(r, "Card");
  });

  it("a component read from a local context reports unresolved-reference", () => {
    const r = run({
      "src/App.tsx": `
        import { createContext, useContext } from "react";
        const Ctx = createContext(null);
        export function Btn() { const Impl = useContext(Ctx); return <Impl />; }
      `,
    });
    expect(dropFor(r, "Impl").code).toBe("unresolved-reference");
  });

  it("a component whose body returns a call around its JSX is credited", () => {
    const r = run({
      "src/App.tsx": `
        import { createPortal } from "react-dom";
        function Dialog() { return <dialog />; }
        function PortalModal() { return createPortal(<Dialog />, document.body); }
        export function App() { return <PortalModal />; }
      `,
    });
    creditedWithoutDiagnostic(r, "PortalModal");
  });

  it("a parameter rendered in a wrapper factory reports, though the argument is credited (known over-count)", () => {
    const r = run({
      "src/App.tsx": `
        import { Button } from "ds";
        function withTheme(Component) { return function Themed(props) { return <Component {...props} />; }; }
        export const ThemedButton = withTheme(Button);
      `,
    });
    expect(dropFor(r, "Component").code).toBe("late-bound-render");
    expect(
      r.occurrences.some(
        (o) =>
          (o.rawComponentId as { export?: string }).export === "Button" &&
          o.viaChain.some((v) => v.kind === "passed-as-argument"),
      ),
    ).toBe(true);
  });

  it("a lazy import of a non-code file reports only lazy-import-unsupported", () => {
    const r = run({
      "src/App.tsx": `
        import { lazy } from "react";
        const Logo = lazy(() => import("./logo.svg"));
        export function App() { return <Logo />; }
      `,
    });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["lazy-import-unsupported"]);
    expect(r.occurrences.filter((o) => o.filePath === "src/App.tsx")).toEqual([]);
  });

  it("a lazy import whose target renders nothing reports only lazy-import-unsupported", () => {
    const r = run({
      "src/card.tsx": "export default 42;",
      "src/App.tsx": `
        import { lazy } from "react";
        const Card = lazy(() => import("./card.tsx"));
        export function App() { return <Card />; }
      `,
    });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["lazy-import-unsupported"]);
  });

  it("a credited render and a host element report nothing", () => {
    const r = run({
      "src/App.tsx": `
        function Local() { return <span />; }
        export function App() { return <div><Local /></div>; }
      `,
    });
    creditedWithoutDiagnostic(r, "Local");
    expect(r.diagnostics).toEqual([]);
  });

  it("a host-element root over a failed import reports nothing", () => {
    const r = run(
      { "src/App.tsx": `import { select } from "./missing";\nexport function App() { return <select />; }` },
      () => null,
    );
    expect(r.diagnostics).toEqual([]);
  });

  it("a string-valued tag reports nothing and credits nothing", () => {
    const r = run({ "src/App.tsx": `const Tag = "section";\nexport function App() { return <Tag />; }` });
    expect(r.diagnostics).toEqual([]);
    expect(r.occurrences).toEqual([]);
  });

  it("a polymorphic tag defaulting to a string reports nothing", () => {
    const r = run({ "src/Box.tsx": `export function Box({ as }) { const Tag = as ?? "span"; return <Tag />; }` });
    expect(r.diagnostics).toEqual([]);
    expect(r.occurrences).toEqual([]);
  });

  it("a destructured prop rendered as a tag reports late-bound-render", () => {
    const r = run({ "src/Slot.tsx": "export function Slot({ Icon }) { return <Icon />; }" });
    expect(dropFor(r, "Icon").code).toBe("late-bound-render");
  });

  it("a member of a parameter rendered as a tag reports late-bound-render", () => {
    const r = run({ "src/Slot.tsx": "export function Slot(props) { return <props.Icon />; }" });
    expect(dropFor(r, "props", ["Icon"]).code).toBe("late-bound-render");
  });

  it("a destructured hook result rendered as a tag reports late-bound-render", () => {
    const r = run({
      "src/Page.tsx": `import { useDrawer } from "kit";\nexport function Page() { const [Drawer] = useDrawer(); return <Drawer />; }`,
    });
    expect(dropFor(r, "Drawer").code).toBe("late-bound-render");
  });

  it("a component whose body returns a string literal is credited", () => {
    const r = run({ "src/App.tsx": `const Masked = () => "*****";\nexport function App() { return <Masked />; }` });
    creditedWithoutDiagnostic(r, "Masked");
  });

  it("a component returning a string on one branch is credited", () => {
    const r = run({
      "src/App.tsx": `
        function Label({ tight, children }) { return tight ? "compact" : children; }
        export function App() { return <Label />; }
      `,
    });
    creditedWithoutDiagnostic(r, "Label");
  });

  it("a component that returns one of its own props is credited", () => {
    const r = run({
      "src/App.tsx": `
        const Pass = ({ children }) => children;
        export function App() { return <Pass />; }
      `,
    });
    creditedWithoutDiagnostic(r, "Pass");
  });

  it("a component returning a call whose last argument is a string is credited", () => {
    const r = run({
      "src/App.tsx": `
        import { attach } from "kit";
        function Slotted({ children }) { return attach(children, "slot-key"); }
        export function App() { return <Slotted />; }
      `,
    });
    creditedWithoutDiagnostic(r, "Slotted");
  });

  it("a string read from an object literal reports nothing", () => {
    const r = run({ "src/App.tsx": `const TAGS = { a: "section" };\nexport function App() { return <TAGS.a />; }` });
    expect(r.diagnostics).toEqual([]);
    expect(r.occurrences).toEqual([]);
  });

  it("an object literal rendered as a tag still reports unresolved-reference", () => {
    const r = run({ "src/App.tsx": "const Bag = { a: 1 };\nexport function App() { return <Bag />; }" });
    expect(dropFor(r, "Bag").code).toBe("unresolved-reference");
  });

  it("a ternary of a component and a string credits the component", () => {
    const r = run(
      {
        "src/Card.tsx": "export const Card = () => <div />;",
        "src/App.tsx": `import { Card } from "./Card";\nexport function App({ flat }) { const Tag = flat ? "div" : Card; return <Tag />; }`,
      },
      relResolver("/repo"),
    );
    creditedWithoutDiagnostic(r, "Card");
  });

  const CTX = `import { createContext } from "react";\nexport const ThemeCtx = createContext(null);\n`;

  it.each([
    ["<Ctx.Provider>", "<ThemeCtx.Provider value={1}><div /></ThemeCtx.Provider>"],
    ["<Ctx.Consumer>", "<ThemeCtx.Consumer>{() => null}</ThemeCtx.Consumer>"],
    ["React 19 <Ctx value>", "<ThemeCtx value={1}><div /></ThemeCtx>"],
  ])("%s on a createContext product reports nothing and credits nothing", (_label, jsx) => {
    const r = run({ "src/theme.tsx": `${CTX}export function App() { return ${jsx}; }` });
    expect(r.diagnostics).toEqual([]);
    expect(r.occurrences).toEqual([]);
    expect(roster(r)).toEqual(["src/theme.tsx#App"]);
  });

  it("a context imported from another file is opaque too", () => {
    const r = run(
      { "src/theme.tsx": CTX, "src/App.tsx": `import { ThemeCtx } from "./theme";\nexport function App() { return <ThemeCtx.Provider value={1} />; }` },
      relResolver("/repo"),
    );
    expect(r.diagnostics).toEqual([]);
  });

  it("a context read from an object literal reports nothing", () => {
    const r = run({
      "src/theme.tsx": `${CTX}const ctxs = { theme: ThemeCtx };\nexport function App() { return <ctxs.theme.Provider value={1} />; }`,
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.occurrences).toEqual([]);
  });

  it("a user function named createContext from a local file is not a context", () => {
    const r = run(
      {
        "src/make.tsx": "export function createContext() { return { Provider: 1 }; }",
        "src/App.tsx": `import { createContext } from "./make";\nconst C = createContext();\nexport function App() { return <C.Provider />; }`,
      },
      relResolver("/repo"),
    );
    expect(dropFor(r, "C", ["Provider"]).code).toBe("unresolved-reference");
  });

  it("a createContext imported from another package is not a context", () => {
    const r = run({
      "src/App.tsx": `import { createContext } from "state-kit";\nconst Store = createContext(null);\nexport function App() { return <Store.Provider value={1} />; }`,
    });
    expect(dropFor(r, "Store", ["Provider"]).code).toBe("unresolved-reference");
  });

  it("a component whose body returns a context is credited", () => {
    const r = run({
      "src/theme.tsx": `${CTX}function Wrap() { return ThemeCtx; }\nexport function App() { return <Wrap />; }`,
    });
    creditedWithoutDiagnostic(r, "Wrap");
  });

  it("memo of a context whose last argument is configuration credits nothing and mints no row", () => {
    const r = run({
      "src/theme.tsx": `import { createContext, memo } from "react";\nimport { defaults } from "cfg";\nexport const ThemeCtx = createContext(defaults, { tone: 1 });\nexport const Themed = memo(ThemeCtx);\nexport function App() { return <Themed />; }`,
    });
    expect(r.occurrences).toEqual([]);
    expect(roster(r)).toEqual(["src/theme.tsx#App"]);
    expect(dropFor(r, "Themed").code).toBe("unresolved-reference");
  });

  // The third column is the default's own row: a component the code holds is a
  // roster member whether or not anything renders it.
  const DEFAULTS: [string, string, string[]][] = [
    ["a component", "const Fallback = () => <div />;\nexport const ThemeCtx = createContext(Fallback);", ["src/theme.tsx#Fallback"]],
    ["an imported function", `import { noop } from "fn-kit";\nexport const ThemeCtx = createContext(noop);`, []],
    ["an imported constant", `import { DEFAULT_TONE } from "tone-kit";\nexport const ThemeCtx = createContext(DEFAULT_TONE);`, []],
    ["an async arrow", "export const ThemeCtx = createContext(async () => {});", []],
  ];

  it.each(DEFAULTS)("a context with %s default: React 19 <Ctx value> reports nothing and credits nothing", (_label, decl, held) => {
    const r = run({
      "src/theme.tsx": `import { createContext } from "react";\n${decl}\nexport function App() { return <ThemeCtx value={1} />; }`,
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.occurrences).toEqual([]);
    expect(roster(r)).toEqual(["src/theme.tsx#App", ...held]);
  });

  it.each([
    ["a default import", `import React from "react";\nconst Fallback = () => <div />;\nexport const ThemeCtx = React.createContext(Fallback);`],
    ["a namespace import", `import * as R from "react";\nconst Fallback = () => <div />;\nexport const ThemeCtx = R.createContext(Fallback);`],
    ["preact", `import { createContext } from "preact";\nconst Fallback = () => <div />;\nexport const ThemeCtx = createContext(Fallback);`],
  ])("a context created through %s with a component default: <Ctx.Provider> reports nothing and credits nothing", (_label, decl) => {
    const r = run({ "src/theme.tsx": `${decl}\nexport function App() { return <ThemeCtx.Provider value={1} />; }` });
    expect(r.diagnostics).toEqual([]);
    expect(r.occurrences).toEqual([]);
    expect(roster(r)).toEqual(["src/theme.tsx#App", "src/theme.tsx#Fallback"]);
  });

  it("a context with a component default passed to a hook seeds nothing", () => {
    const r = run({
      "src/theme.tsx": `import { createContext } from "react";\nimport { useThing } from "state-kit";\nconst Fallback = () => <div />;\nexport const ThemeCtx = createContext(Fallback);\nexport function App() { useThing(ThemeCtx); return <div />; }`,
    });
    expect(r.occurrences).toEqual([]);
  });

  it("a default-exported context does not make its component default the default export", () => {
    const r = run({
      "src/theme.tsx": `import { createContext } from "react";\nconst Fallback = () => <div />;\nexport default createContext(Fallback);`,
    });
    expect(r.registry.localEntries().filter((e) => e.isDefault)).toEqual([]);
  });

  it("an opaque wrapper over an inline context call credits nothing and mints no row", () => {
    const r = run({
      "src/theme.tsx": `import { createContext } from "react";\nimport { withTheme } from "theme-kit";\nconst Fallback = () => <div />;\nexport const Themed = withTheme(createContext(Fallback));\nexport function App() { return <Themed />; }`,
    });
    expect(r.occurrences).toEqual([]);
    expect(roster(r)).toEqual(["src/theme.tsx#App", "src/theme.tsx#Fallback"]);
    expect(dropFor(r, "Themed").code).toBe("unresolved-reference");
  });

  it("memo of a context with a component default credits nothing and mints no row", () => {
    const r = run(
      {
        "src/theme.tsx": `import { createContext, memo } from "react";\nconst Fallback = () => <div />;\nexport const ThemeCtx = createContext(Fallback);\nexport const Themed = memo(ThemeCtx);`,
        "src/App.tsx": `import { Themed } from "./theme";\nexport function App() { return <Themed />; }`,
      },
      relResolver("/repo"),
    );
    expect(r.occurrences).toEqual([]);
    expect(roster(r)).toEqual(["src/App.tsx#App", "src/theme.tsx#Fallback"]);
    expect(dropFor(r, "Themed").code).toBe("unresolved-reference");
  });

  it("a ternary of a context and a component credits the component", () => {
    const r = run({
      "src/theme.tsx": `${CTX}const Card = () => <div />;\nexport function App({ flat }) { const Tag = flat ? ThemeCtx : Card; return <Tag />; }`,
    });
    creditedWithoutDiagnostic(r, "Card");
  });

  it("a host-element root over a lazy non-code import reports nothing", () => {
    const r = run({
      "src/App.tsx": `
        import { lazy } from "react";
        const dialog = lazy(() => import("./frame.svg"));
        export function App() { return <dialog />; }
      `,
    });
    expect(r.diagnostics).toEqual([]);
  });

  it("a lowercase tag is the host element even when a same-named function is in scope", () => {
    const r = run({
      "src/App.tsx": `
        function label() { return <span />; }
        export function App() { return <label htmlFor="name">Name</label>; }
      `,
    });
    expect(r.occurrences).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it("a lowercase tag is the host element even when a nested function of that name is in scope", () => {
    const r = run({
      "src/Field.tsx": `
        export function Field() {
          const label = () => <span />;
          return <label htmlFor="name">{label()}</label>;
        }
      `,
    });
    expect(r.occurrences).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it("a lowercase tag is the host element even when a package import of that name is in scope", () => {
    const r = run({
      "src/App.tsx": `
        import { dialog } from "some-ui";
        export function App() { return <dialog />; }
      `,
    });
    expect(r.occurrences).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });
});
