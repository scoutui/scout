/**
 * Argument-site seeding on real parser output. A holder (module-scope
 * registry member whose value is a call) seeds the arguments of the call its
 * fold identifies as a product: identifiers, and components reached through
 * a call-valued argument by following each wrapper to the argument it folds
 * to. A holder whose fold credits one of its arguments seeds nothing.
 */
import { describe, it, expect } from "vitest";
import { scan, relResolver, pathResolver, lineOf, columnOf } from "./shape-helpers.js";

type Occs = ReturnType<typeof scan>;
const seeded = (occs: Occs) => occs.filter((o) => o.via.kind === "passed-as-argument");
const exportOf = (o: Occs[number]) => (o.rawComponentId?.kind === "react-component" ? o.rawComponentId.export : "");
const ownerOf = (o: Occs[number]) => (o.rawOwnerComponentId?.kind === "react-component" ? o.rawOwnerComponentId.export : "");
/** One occurrence as `file export@source owner=<owner> <chain>`, sorted; a hop prints its callee. */
const rowsOf = (occs: Occs) =>
  occs
    .map((o) => {
      const id = o.rawComponentId as { export?: string; source?: { filePath?: string; package?: string } };
      const chain = o.viaChain
        .map((v) => (v.kind === "hoc-wrapper" ? `hoc-wrapper(${v.hocCallee})` : v.kind === "passed-as-argument" ? `passed-as-argument(${v.callee}#${v.index})` : v.kind))
        .join(">");
      return `${o.filePath} ${id.export}@${id.source?.filePath ?? id.source?.package} owner=${ownerOf(o) || null} ${chain}`;
    })
    .sort();


const FIELD_FILES = {
  "src/make-control.tsx": `
    export const makeControl = (Component, mapProps) => (props) => {
      const extra = mapProps ? mapProps(props) : null;
      return <Component {...props} {...extra} />;
    };
  `,
  "src/Dropdown.tsx": `
    import { Dropdown as DropdownBase } from "@example/design-system";
    import { makeControl } from "./make-control";
    export const Dropdown = makeControl(DropdownBase, (p) => ({ value: p.name }));
  `,
  "src/App.tsx": `
    import { Dropdown } from "./Dropdown";
    export const App = () => <Dropdown name="a" />;
  `,
};

describe("argument-site seeding: a component passed to a local wrapper factory", () => {
  it("seeds the design-system component at its argument identifier, owned by the product", () => {
    const occs = scan(FIELD_FILES, relResolver("/repo"), "/repo");
    expect(occs).toHaveLength(2);

    const render = occs.find((o) => o.via.kind === "direct-import");
    expect(render?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Dropdown",
      source: { type: "local", filePath: "src/Dropdown.tsx" },
    });

    const [arg] = seeded(occs);
    expect(arg?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Dropdown",
      source: { type: "external", package: "@example/design-system" },
    });
    expect(arg?.rawOwnerComponentId).toMatchObject({
      kind: "react-component",
      export: "Dropdown",
      source: { type: "local", filePath: "src/Dropdown.tsx" },
    });
    const src = FIELD_FILES["src/Dropdown.tsx"];
    expect(arg?.filePath).toBe("src/Dropdown.tsx");
    expect(arg?.line).toBe(lineOf(src, "makeControl(DropdownBase"));
    expect(arg?.column).toBe(columnOf(src, "makeControl(DropdownBase", "DropdownBase"));
    expect(arg?.viaChain).toEqual([
      { kind: "passed-as-argument", callee: "makeControl", index: 0, specifier: "@example/design-system", import: "Dropdown" },
    ]);
    expect(arg?.props).toEqual({});

    // The mapProps arrow, the factory and the body's `<Component/>` are never identities.
    expect(occs.map(exportOf).filter((e) => ["makeControl", "Component", "mapProps"].includes(e))).toEqual([]);
  });

  it("seeds an exported product that nothing renders, so wrapper-only design-system usage is visible, and skips an unconsumed holder", () => {
    const occs = scan(
      {
        "src/make-control.tsx": `
          export const makeControl = (Component) => (props) => <Component {...props} />;
        `,
        "src/fields.tsx": `
          import { Input as InputBase, Select as SelectBase } from "@example/design-system";
          import { makeControl } from "./make-control";
          export const Input = makeControl(InputBase);
          const Select = makeControl(SelectBase);
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    // `Select` is neither exported, rendered nor passed on: not a registry
    // member, so its holder never seeds (no phantom owner by construction).
    expect(occs).toHaveLength(1);
    const [arg] = seeded(occs);
    expect(arg?.rawComponentId).toMatchObject({ export: "Input", source: { type: "external", package: "@example/design-system" } });
    expect(arg?.rawOwnerComponentId).toMatchObject({ export: "Input", source: { type: "local", filePath: "src/fields.tsx" } });
  });

  it("seeds through a local factory whose body wraps its parameter in forwardRef (the createIcon shape)", () => {
    const occs = scan({
      "src/icons.tsx": `
        import { forwardRef } from "react";
        import { ActivityIcon } from "lucide-react";
        const createIcon = (I) => forwardRef((props, ref) => <I ref={ref} {...props} />);
        export const Activity = createIcon(ActivityIcon);
        export const App = () => <Activity />;
      `,
    });
    const [arg, ...rest] = seeded(occs);
    expect(rest).toEqual([]);
    expect(arg?.rawComponentId).toMatchObject({ export: "ActivityIcon", source: { type: "external", package: "lucide-react" } });
    expect(arg?.rawOwnerComponentId).toMatchObject({ export: "Activity", source: { type: "local", filePath: "src/icons.tsx" } });
    expect(arg?.via).toMatchObject({ kind: "passed-as-argument", callee: "createIcon", index: 0, specifier: "lucide-react", import: "ActivityIcon" });
  });
});

describe("argument-site seeding: wrapped local views", () => {
  const LOADING_FILES = {
    "src/with-loading.tsx": `
      import { Spinner } from "ds-icons";
      export const withLoading = (C) => (props) => (props.loading ? <Spinner /> : <C {...props} />);
    `,
    "src/products.tsx": `
      import { withLoading } from "./with-loading";
      const FooView = () => <section>foo</section>;
      const BarView = () => <section>bar</section>;
      export const Foo = withLoading(FooView);
      export const Bar = withLoading(BarView);
    `,
    "src/App.tsx": `
      import { Foo, Bar } from "./products";
      export const App = () => <div><Foo /><Bar /></div>;
    `,
  };

  it("seeds each same-file view once, owned by its product, with a definition and no import in its provenance; attribution of the factory's JSX to its products is untouched", () => {
    const occs = scan(LOADING_FILES, relResolver("/repo"), "/repo");
    const args = seeded(occs);
    expect(args.map(exportOf).sort()).toEqual(["BarView", "FooView"]);

    const fooView = args.find((o) => exportOf(o) === "FooView");
    const src = LOADING_FILES["src/products.tsx"];
    expect(fooView?.rawComponentId?.source).toEqual({ type: "local", filePath: "src/products.tsx" });
    expect(fooView?.rawOwnerComponentId).toMatchObject({ export: "Foo", source: { type: "local", filePath: "src/products.tsx" } });
    expect(fooView?.line).toBe(lineOf(src, "withLoading(FooView)"));
    expect(fooView?.column).toBe(columnOf(src, "withLoading(FooView)", "FooView"));
    expect(fooView?.via).toEqual({ kind: "passed-as-argument", callee: "withLoading", index: 0 });
    expect(fooView?.definition).toEqual({
      line: lineOf(src, "const FooView"),
      column: columnOf(src, "const FooView", "FooView"),
    });

    // <Spinner/> inside withLoading still fans out to Foo and Bar via helper-call.
    const spinner = occs.filter((o) => exportOf(o) === "Spinner");
    expect(spinner.map((o) => o.viaChain[0]?.kind)).toEqual(["helper-call", "helper-call"]);
    expect(spinner.map((o) => (o.rawOwnerComponentId?.kind === "react-component" ? o.rawOwnerComponentId.export : "")).sort()).toEqual(["Bar", "Foo"]);
  });

  it("seeds the outermost call's argument of a curried decorator on a default export; the inner call's config argument never seeds", () => {
    const BOUNDARY_FILES = {
      "src/with-error-boundary.tsx": `
        export function withErrorBoundary(name) {
          return (Child) => (props) => <div><Child {...props} /></div>;
        }
      `,
      "src/signup-form.tsx": `
        import { withErrorBoundary } from "./with-error-boundary";
        const SignupForm = ({ title }) => <form>{title}</form>;
        export default withErrorBoundary('SignupForm')(SignupForm);
      `,
      "src/App.tsx": `
        import SignupForm from "./signup-form";
        export const App = () => <SignupForm title="t" />;
      `,
    };
    const occs = scan(BOUNDARY_FILES, relResolver("/repo"), "/repo");
    expect(occs).toHaveLength(2);
    const render = occs.find((o) => o.via.kind === "direct-import");
    expect(render?.rawComponentId).toMatchObject({ export: "default", source: { type: "local", filePath: "src/signup-form.tsx" } });

    const [arg] = seeded(occs);
    const src = BOUNDARY_FILES["src/signup-form.tsx"];
    expect(arg?.rawComponentId).toMatchObject({ export: "SignupForm", source: { type: "local", filePath: "src/signup-form.tsx" } });
    expect(arg?.rawOwnerComponentId).toMatchObject({ export: "default", source: { type: "local", filePath: "src/signup-form.tsx" } });
    expect(arg?.line).toBe(lineOf(src, "export default withErrorBoundary"));
    expect(arg?.column).toBe(columnOf(src, "export default withErrorBoundary", "SignupForm", true));
    expect(arg?.via).toMatchObject({ kind: "passed-as-argument", callee: "withErrorBoundary", index: 0 });
    // No occurrence names `Child`, the string literal, or the decorator.
    expect(occs.map(exportOf).filter((e) => ["Child", "withErrorBoundary"].includes(e))).toEqual([]);
  });

  it("seeds a forwardRef product passed as an argument, keeping the forwardRef hop after the argument-site hop", () => {
    const occs = scan(
      {
        "src/App.tsx": `
          import { forwardRef } from "react";
          import { makeControl } from "./make-control";
          const ButtonBase = forwardRef((props, ref) => <button ref={ref} {...props} />);
          export const Field = makeControl(ButtonBase);
          export const App = () => <Field />;
        `,
        "src/make-control.tsx": `
          export const makeControl = (C) => (props) => <C {...props} />;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    const [arg] = seeded(occs);
    expect(arg?.rawComponentId).toMatchObject({ export: "ButtonBase", source: { type: "local", filePath: "src/App.tsx" } });
    expect(arg?.rawOwnerComponentId).toMatchObject({ export: "Field", source: { type: "local", filePath: "src/App.tsx" } });
    expect(arg?.viaChain.map((v) => v.kind)).toEqual(["passed-as-argument", "hoc-wrapper"]);
  });

  it("seeds a cross-file wrapped view with the import specifier as provenance and its definition in the file that declares it", () => {
    const views = `
          export const FooView = () => <section>foo</section>;
        `;
    const occs = scan(
      {
        "src/views.tsx": views,
        "src/with-loading.tsx": `
          export const withLoading = (C) => (props) => <C {...props} />;
        `,
        "src/products.tsx": `
          import { withLoading } from "./with-loading";
          import { FooView } from "./views";
          export const Foo = withLoading(FooView);
        `,
        "src/App.tsx": `
          import { Foo } from "./products";
          export const App = () => <Foo />;
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    const [arg] = seeded(occs);
    expect(arg?.rawComponentId).toMatchObject({ export: "FooView", source: { type: "local", filePath: "src/views.tsx" } });
    expect(arg?.rawOwnerComponentId).toMatchObject({ export: "Foo", source: { type: "local", filePath: "src/products.tsx" } });
    expect(arg?.via).toMatchObject({ kind: "passed-as-argument", callee: "withLoading", index: 0, specifier: "./views", import: "FooView" });
    expect(arg?.definition).toEqual({ line: lineOf(views, "export const FooView"), column: columnOf(views, "export const FooView", "FooView") });
  });

  it("seeds a member destructured from an object declared in another file with its definition at the object's declaration in that file", () => {
    const ns = `
          export const NS = { Inline: () => <i /> };
        `;
    const occs = scan(
      {
        "src/ns.tsx": ns,
        "src/App.tsx": `
          import { useSlot } from "@example/ui";
          import { NS } from "./ns";
          const { Inline } = NS;
          export const App = () => { useSlot(Inline); return <main />; };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    const [arg, ...rest] = seeded(occs);
    expect(rest).toEqual([]);
    expect(arg?.rawComponentId).toEqual({ kind: "react-component", export: "NS.Inline", source: { type: "local", filePath: "src/ns.tsx" } });
    expect(arg?.definition).toEqual({ line: lineOf(ns, "export const NS"), column: columnOf(ns, "export const NS", "NS") });
  });

  it("seeds a same-file alias and a same-file destructure with their definitions at the declarations they name, not at the alias", () => {
    const src = `
          import { useSlot } from "@example/ui";
          const Base = () => <b />;
          const Alias = Base;
          const NS = { Inline: () => <i /> };
          const { Inline } = NS;
          export const App = () => { useSlot(Alias); useSlot(Inline); return <main />; };
        `;
    const occs = scan({ "src/App.tsx": src }, relResolver("/repo"), "/repo");
    expect(seeded(occs).map((o) => [exportOf(o), o.definition])).toEqual([
      ["Base", { line: lineOf(src, "const Base"), column: columnOf(src, "const Base", "Base") }],
      ["NS.Inline", { line: lineOf(src, "const NS"), column: columnOf(src, "const NS", "NS") }],
    ]);
  });
});

describe("argument-site seeding: what never seeds", () => {
  it("seeds nothing for wrappers that fold to their argument (library stubs, opaque wrappers, local pass-through)", () => {
    const occs = scan({
      "src/App.tsx": `
        import { memo } from "react";
        import { connect } from "react-redux";
        import styled from "styled-components";
        import { Foo, Bar, Baz, Qux } from "pkg";
        const identity = (c) => c;
        export const MemoFoo = memo(Foo);
        export const ConnectedBar = connect(() => ({}))(Bar);
        export const StyledBaz = styled(Baz);
        export const SameQux = identity(Qux);
        export const App = () => <div><MemoFoo /><ConnectedBar /><StyledBaz /><SameQux /></div>;
      `,
    });
    expect(seeded(occs)).toEqual([]);
    expect(occs.map(exportOf).sort()).toEqual(["Bar", "Baz", "Foo", "Qux"]);
    for (const o of occs) {
      expect(o.rawComponentId).toMatchObject({ source: { type: "external", package: "pkg" } });
      expect(o.viaChain.some((v) => v.kind === "hoc-wrapper")).toBe(true);
    }
  });

  it("seeds nothing when the wrapper folded to an anonymous argument: the hoc-wrapper hop is the fold's record, so a second argument is configuration, not a wrapped component", () => {
    const occs = scan({
      "src/App.tsx": `
        import { forwardRef, memo } from "react";
        const Other = () => <span />;
        const areEqual = () => true;
        export const FancyButton = forwardRef((props, ref) => <button ref={ref} />, Other);
        export const Memoed = memo(({ a }) => <div>{a}</div>, areEqual);
        export const App = () => <div><FancyButton /><Memoed /></div>;
      `,
    });
    expect(seeded(occs)).toEqual([]);
    expect(occs.map(exportOf).sort()).toEqual(["FancyButton", "Memoed"]);
  });

  it("never seeds a HOC composer's arguments: inner-call arguments configure the wrapper, so an external HOC is never a phantom row", () => {
    const occs = scan({
      "src/App.tsx": `
        import { withRouter } from "react-router";
        import { withTheme } from "theme-kit";
        import { Foo } from "pkg";
        const compose = (...fns) => (C) => fns.reduceRight((acc, f) => f(acc), C);
        export const Enhanced = compose(withRouter, withTheme)(Foo);
        export const App = () => <Enhanced />;
      `,
    });
    expect(seeded(occs)).toEqual([]);
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({ export: "Foo", source: { type: "external", package: "pkg" } });
    expect(occs.map(exportOf).filter((e) => ["withRouter", "withTheme", "compose"].includes(e))).toEqual([]);
  });

  // Known gap: the body states the correct answer.
  it.fails.each([
    ["a default import", `import D from "pkg";`, "default.Other"],
    ["a named import", `import { D } from "pkg";`, "D.Other"],
  ])("a member argument read through %s seeds as the component its render credits", (_, imp, exportName) => {
    const occs = scan({
      "src/App.tsx": `
        ${imp}
        const wrap = (C) => (props) => <C {...props} />;
        export const B = wrap(D.Other);
        export const App = () => <B />;
      `,
    });
    expect(rowsOf(seeded(occs))).toEqual([`src/App.tsx ${exportName}@pkg owner=B passed-as-argument(wrap#0)`]);
  });

  it("a namespace member argument seeds as the same component imported by name", () => {
    const app = (imp: string, arg: string) => ({
      "src/App.tsx": `
        ${imp}
        const wrap = (C) => (props) => <C {...props} />;
        export const B = wrap(${arg});
        export const App = () => <B />;
      `,
    });
    const viaNamespace = scan(app(`import * as NS from "pkg";`, "NS.Other"));
    const viaNamed = scan(app(`import { Other } from "pkg";`, "Other"));
    expect(rowsOf(viaNamespace)).toEqual([
      "src/App.tsx B@src/App.tsx owner=App local-component",
      "src/App.tsx Other@pkg owner=B passed-as-argument(wrap#0)",
    ]);
    expect(rowsOf(viaNamespace)).toEqual(rowsOf(viaNamed));
  });

  it("a call-valued argument whose fold reaches no JSX is configuration and seeds nothing", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Icon } from "pkg";
        const wrap = (C) => (props) => <C {...props} />;
        const makeConfig = (I) => ({ icon: I, size: 1 });
        export const Configured = wrap(makeConfig(Icon));
        export const App = () => <Configured />;
      `,
    });
    expect(seeded(occs)).toEqual([]);
    expect(occs.map(exportOf)).not.toContain("Icon");
  });

  it("descends two calls below the outermost call and no further", () => {
    const occs = scan({
      "src/App.tsx": `
        import { memo, forwardRef } from "react";
        import { Two, Three } from "pkg";
        const wrap = (C) => (props) => <C {...props} />;
        export const TwoDeep = wrap(memo(forwardRef(Two)));
        export const ThreeDeep = wrap(memo(forwardRef(memo(Three))));
        export const App = () => <div><TwoDeep /><ThreeDeep /></div>;
      `,
    });
    expect(rowsOf(seeded(occs))).toEqual([
      "src/App.tsx Two@pkg owner=TwoDeep passed-as-argument(wrap#0)>hoc-wrapper(memo)>hoc-wrapper(forwardRef)",
    ]);
    expect(occs.map(exportOf)).not.toContain("Three");
  });

  it("a wrapper of a wrapper credits the view at the render and seeds nothing, so a site is never counted twice", () => {
    const occs = scan({
      "src/App.tsx": `
        import { memo } from "react";
        import { connect } from "react-redux";
        import { Bar } from "pkg";
        export const Both = memo(connect(() => ({}))(Bar));
        export const App = () => <Both />;
      `,
    });
    expect(rowsOf(occs)).toEqual(["src/App.tsx Bar@pkg owner=App local-component>hoc-wrapper(memo)>hoc-wrapper(connect)"]);
  });

  it("a call-valued argument whose fold credits a component other than its argument seeds nothing", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Picked, Offered } from "pkg";
        const wrap = (C) => (props) => <C {...props} />;
        const select = (candidate) => Picked;
        export const Chosen = wrap(select(Offered));
        export const App = () => <Chosen />;
      `,
    });
    expect(seeded(occs)).toEqual([]);
    expect(occs.map(exportOf)).not.toContain("Offered");
  });

  it("inside a product, a wrapper that folded to an anonymous argument still treats its other arguments as configuration", () => {
    const occs = scan({
      "src/App.tsx": `
        import { forwardRef } from "react";
        import { Base } from "pkg";
        const wrap = (C) => (props) => <C {...props} />;
        export const Anon = wrap(forwardRef((props, ref) => <b ref={ref} />, Base));
        export const App = () => <Anon />;
      `,
    });
    expect(seeded(occs)).toEqual([]);
    expect(occs.map(exportOf)).not.toContain("Base");
  });
});

describe("argument-site seeding: through call-valued arguments", () => {
  const REPO = "/repo";

  it("a wrapper inside a product and a product inside a wrapper both seed the component, owned by the holder", () => {
    const src = `
        import { memo } from "react";
        import { Base } from "pkg";
        const wrap = (C) => (props) => <C {...props} />;
        export const A = wrap(memo(Base));
        export const M = memo(wrap(Base));
        export const App = () => <div><A /><M /></div>;
      `;
    const occs = scan({ "src/App.tsx": src });
    expect(rowsOf(occs)).toEqual([
      "src/App.tsx A@src/App.tsx owner=App local-component",
      "src/App.tsx Base@pkg owner=A passed-as-argument(wrap#0)>hoc-wrapper(memo)",
      "src/App.tsx Base@pkg owner=M passed-as-argument(wrap#0)",
      "src/App.tsx M@src/App.tsx owner=App local-component>hoc-wrapper(memo)",
    ]);
    const [inA, inM] = seeded(occs);
    expect([inA?.line, inA?.column]).toEqual([lineOf(src, "wrap(memo(Base))"), columnOf(src, "wrap(memo(Base))", "Base")]);
    expect([inM?.line, inM?.column]).toEqual([lineOf(src, "memo(wrap(Base))"), columnOf(src, "memo(wrap(Base))", "Base")]);
    expect(inA?.viaChain).toEqual([
      { kind: "passed-as-argument", callee: "wrap", index: 0, specifier: "pkg", import: "Base" },
      { kind: "hoc-wrapper", hocCallee: "memo", specifier: "pkg", import: "Base" },
    ]);
  });

  it("a pass-through chain inside a local factory credits the view once, through the same hop the bare chain records", () => {
    const files = {
      "src/error-boundary.jsx": "export const ErrorBoundary = ({ children }) => <div>{children}</div>;",
      "src/with-error-boundary.jsx": `
import { ErrorBoundary } from './error-boundary.jsx';

export const withErrorBoundary = (name) => (Child) => (props) => (
  <ErrorBoundary name={name}>
    <Child {...props} />
  </ErrorBoundary>
);
`,
      "src/direct-view.jsx": "export const DirectView = ({ label }) => <span>{label}</span>;",
      "src/chain-view.jsx": "export const ChainView = ({ label }) => <span>{label}</span>;",
      "src/nested-view.jsx": "export const NestedView = ({ label }) => <span>{label}</span>;",
      "src/enhanced.js": `
import flow from 'lodash/flow';
import { connect } from 'react-redux';
import { withErrorBoundary } from './with-error-boundary.jsx';
import { DirectView } from './direct-view.jsx';
import { ChainView } from './chain-view.jsx';
import { NestedView } from './nested-view.jsx';

const mapStateToProps = (state) => ({ label: state.label });

// identifier argument
export const DirectEnhanced = withErrorBoundary('Direct')(DirectView);

// pass-through chain, no outer factory
export const ChainEnhanced = flow(connect(mapStateToProps))(ChainView);

// pass-through chain as the argument of a local factory
export const NestedEnhanced = withErrorBoundary('Nested')(flow(connect(mapStateToProps))(NestedView));
`,
      "src/app.jsx": `
import { DirectEnhanced, ChainEnhanced, NestedEnhanced } from './enhanced.js';

export const App = () => (
  <main>
    <DirectEnhanced />
    <ChainEnhanced />
    <NestedEnhanced />
  </main>
);
`,
    };
    const occs = scan(files, pathResolver(REPO), REPO);
    expect(rowsOf(occs)).toEqual([
      "src/app.jsx ChainView@src/chain-view.jsx owner=App direct-import>hoc-wrapper(flow)",
      "src/app.jsx DirectEnhanced@src/enhanced.js owner=App direct-import",
      "src/app.jsx NestedEnhanced@src/enhanced.js owner=App direct-import",
      "src/enhanced.js DirectView@src/direct-view.jsx owner=DirectEnhanced passed-as-argument(withErrorBoundary#0)",
      "src/enhanced.js NestedView@src/nested-view.jsx owner=NestedEnhanced passed-as-argument(withErrorBoundary#0)>hoc-wrapper(flow)",
      "src/with-error-boundary.jsx ErrorBoundary@src/error-boundary.jsx owner=DirectEnhanced helper-call>direct-import",
      "src/with-error-boundary.jsx ErrorBoundary@src/error-boundary.jsx owner=NestedEnhanced helper-call>direct-import",
    ]);
    const nested = occs.find((o) => exportOf(o) === "NestedView");
    const chain = occs.find((o) => exportOf(o) === "ChainView");
    const src = files["src/enhanced.js"];
    expect([nested?.line, nested?.column]).toEqual([lineOf(src, "export const NestedEnhanced"), columnOf(src, "export const NestedEnhanced", "NestedView")]);
    expect(nested?.viaChain.at(-1)).toEqual({ ...chain?.viaChain.at(-1), specifier: "./nested-view.jsx", import: "NestedView" });
    expect(nested?.viaChain[0]).toEqual({ kind: "passed-as-argument", callee: "withErrorBoundary", index: 0, specifier: "./nested-view.jsx", import: "NestedView" });
  });

  it("a factory product wrapped in memo or forwardRef seeds the wrapped component at the factory call, with no hop of the holder's own", () => {
    const files = {
      "src/make-control.tsx": "export const makeControl = (Component) => (props) => <Component {...props} />;",
      "src/fields.tsx": `
        import { memo, forwardRef } from "react";
        import { Input as InputBase, Select as SelectBase } from "@example/design-system";
        import { makeControl } from "./make-control.tsx";
        export const Input = memo(makeControl(InputBase));
        export const Select = forwardRef(makeControl(SelectBase));
      `,
      "src/app.tsx": `
        import { Input, Select } from "./fields.tsx";
        export const App = () => <div><Input /><Select /></div>;
      `,
    };
    const occs = scan(files, pathResolver(REPO), REPO);
    expect(rowsOf(occs)).toEqual([
      "src/app.tsx Input@src/fields.tsx owner=App direct-import>hoc-wrapper(memo)",
      "src/app.tsx Select@src/fields.tsx owner=App direct-import>hoc-wrapper(forwardRef)",
      "src/fields.tsx Input@@example/design-system owner=Input passed-as-argument(makeControl#0)",
      "src/fields.tsx Select@@example/design-system owner=Select passed-as-argument(makeControl#0)",
    ]);
    const [input] = seeded(occs);
    expect(input?.viaChain).toEqual([
      { kind: "passed-as-argument", callee: "makeControl", index: 0, specifier: "@example/design-system", import: "Input" },
    ]);
  });

  const EMPTY_STATE_FILES = {
    "src/empty-state.jsx": "const EmptyState = () => <div>empty</div>;\nexport { EmptyState };",
    "src/grid-empty.jsx": "export const GridEmpty = () => <div>none</div>;",
    "src/with-empty-state.jsx": `
import React from 'react';
import { EmptyState as DefaultEmpty } from './empty-state.jsx';

function WithEmptyState(Component, Empty = DefaultEmpty) {
  return function WithEmptyStateComponent({ isEmpty, ...props }) {
    if (isEmpty) {
      return <Empty />;
    }
    return <Component {...props} />;
  };
}

export { WithEmptyState };
`,
    "src/list-view.jsx": "const ListView = () => <section />;\nexport { ListView };",
    "src/grid-view.jsx": "const GridView = () => <section />;\nexport { GridView };",
    "src/enhanced.js": `
import { connect } from 'react-redux';
import { ListView } from './list-view.jsx';
import { GridView } from './grid-view.jsx';
import { GridEmpty } from './grid-empty.jsx';
import { WithEmptyState } from './with-empty-state.jsx';

const mapStateToProps = (state) => ({ isEmpty: state.items.length === 0 });

const ListViewEnhanced = connect(mapStateToProps)(WithEmptyState(ListView));
const GridViewEnhanced = connect(mapStateToProps)(
  WithEmptyState(GridView, GridEmpty),
);

export { ListViewEnhanced, GridViewEnhanced };
`,
    "src/app.jsx": `
import { ListViewEnhanced, GridViewEnhanced } from './enhanced.js';
export const App = () => <div><ListViewEnhanced /><GridViewEnhanced /></div>;
`,
  };

  it("a function-declaration factory product wrapped in connect()() seeds every component argument, owned by the holder", () => {
    const occs = scan(EMPTY_STATE_FILES, pathResolver(REPO), REPO);
    expect(rowsOf(occs)).toEqual([
      "src/app.jsx GridViewEnhanced@src/enhanced.js owner=App direct-import>hoc-wrapper(connect)",
      "src/app.jsx ListViewEnhanced@src/enhanced.js owner=App direct-import>hoc-wrapper(connect)",
      "src/enhanced.js GridEmpty@src/grid-empty.jsx owner=GridViewEnhanced passed-as-argument(WithEmptyState#1)",
      "src/enhanced.js GridView@src/grid-view.jsx owner=GridViewEnhanced passed-as-argument(WithEmptyState#0)",
      "src/enhanced.js ListView@src/list-view.jsx owner=ListViewEnhanced passed-as-argument(WithEmptyState#0)",
    ]);
  });

  // Known gap: the body states the correct answer.
  it.fails("credits a parameter default the product renders to the product that omits the argument", () => {
    const occs = scan(EMPTY_STATE_FILES, pathResolver(REPO), REPO);
    expect(occs.filter((o) => exportOf(o) === "EmptyState").map((o) => [o.rawComponentId, ownerOf(o)])).toEqual([
      [{ kind: "react-component", export: "EmptyState", source: { type: "local", filePath: "src/empty-state.jsx" } }, "ListViewEnhanced"],
    ]);
  });

  it("a factory that returns a locally bound wrapper, and a named function expression factory, seed the view through the chain", () => {
    const files = {
      "src/boundary.jsx": "export const BoundaryBase = ({ children }) => <div>{children}</div>;",
      "src/with-boundary.jsx": `
import React from 'react';
import { BoundaryBase as Boundary } from './boundary.jsx';

function withBoundary(label, { level = 1, placeholder = null } = {}) {
  const wrap = (Child) => (props) => (
    <Boundary label={label} level={level} placeholder={placeholder}>
      <Child {...props} />
    </Boundary>
  );

  return wrap;
}

export { withBoundary };
`,
      "src/with-guard.jsx": `
import React from 'react';
import { Spinner } from '@example/ui';

export const withGuard = function WithGuard(Wrapped) {
  return function Guarded(props) {
    const { status } = props;

    if (status === 'pending') {
      return <Spinner />;
    }

    return <Wrapped {...props} />;
  };
};
`,
      "src/view-a.jsx": "export const ViewA = () => <span />;",
      "src/view-b.jsx": "export const ViewB = () => <span />;",
      "src/boundaries.js": `
import flow from 'lodash/flow';
import { connect } from 'react-redux';
import { withBoundary } from './with-boundary.jsx';
import { withGuard } from './with-guard.jsx';
import { ViewA } from './view-a.jsx';
import { ViewB } from './view-b.jsx';
const mapStateToProps = (state) => state;
export const ViewAEnhanced = withBoundary('ViewA', { level: 2 })(flow(connect(mapStateToProps))(ViewA));
export const ViewBEnhanced = withGuard(flow(connect(mapStateToProps))(ViewB));
`,
      "src/app.jsx": `
import { ViewAEnhanced, ViewBEnhanced } from './boundaries.js';
export const App = () => <div><ViewAEnhanced /><ViewBEnhanced /></div>;
`,
    };
    const occs = scan(files, pathResolver(REPO), REPO);
    expect(rowsOf(seeded(occs))).toEqual([
      "src/boundaries.js ViewA@src/view-a.jsx owner=ViewAEnhanced passed-as-argument(withBoundary#0)>hoc-wrapper(flow)",
      "src/boundaries.js ViewB@src/view-b.jsx owner=ViewBEnhanced passed-as-argument(withGuard#0)>hoc-wrapper(flow)",
    ]);
    expect(rowsOf(occs.filter((o) => o.filePath === "src/app.jsx"))).toEqual([
      "src/app.jsx ViewAEnhanced@src/boundaries.js owner=App direct-import",
      "src/app.jsx ViewBEnhanced@src/boundaries.js owner=App direct-import",
    ]);
  });

  const WITH_PAGE_FILES = {
    "src/chrome.jsx": "export const Chrome = ({ children }) => <div>{children}</div>;",
    "src/with-page.jsx": `
        import { Chrome } from './chrome.jsx';
        export const withPage = (Component) => (props) => <Chrome><Component {...props} /></Chrome>;
    `,
    "src/view.jsx": "export const View = () => <span />;",
    "src/enhanced.js": `
        import { connect } from 'react-redux';
        import { withPage } from './with-page.jsx';
        import { View } from './view.jsx';
        export const ViewEnhanced = connect((state) => state)(withPage(View));
    `,
    "src/app.jsx": `
        import { ViewEnhanced } from './enhanced.js';
        export const App = () => <ViewEnhanced />;
    `,
  };

  it("a factory called inside a call-valued argument seeds its view argument, owned by the holder", () => {
    const occs = scan(WITH_PAGE_FILES, pathResolver(REPO), REPO);
    expect(rowsOf(seeded(occs))).toEqual([
      "src/enhanced.js View@src/view.jsx owner=ViewEnhanced passed-as-argument(withPage#0)",
    ]);
  });

  // Known gap: the body states the correct answer.
  it.fails("a factory called inside a call-valued argument owns what its product renders", () => {
    const occs = scan(WITH_PAGE_FILES, pathResolver(REPO), REPO);
    expect(rowsOf(occs.filter((o) => exportOf(o) === "Chrome"))).toEqual([
      "src/with-page.jsx Chrome@src/chrome.jsx owner=ViewEnhanced helper-call>direct-import",
    ]);
  });
});

describe("argument-site seeding: a component passed to a hook inside a body", () => {
  it("M is seeded at the hook argument, owned by the page that calls the hook; Modal stays owned by M", () => {
    const src = `
      import { Modal, useModalHolder } from "@example/ui";
      const M = () => <Modal />;
      export const useM = () => useModalHolder(M);
      export const Page = () => { const [modal] = useM(); return <div>{modal}</div>; };
    `;
    const occs = scan({ "src/Page.tsx": src });
    const m = occs.filter((o) => exportOf(o) === "M");
    expect(m).toHaveLength(1);
    expect(m[0]?.rawComponentId).toMatchObject({ source: { type: "local", filePath: "src/Page.tsx" } });
    expect(ownerOf(m[0] as Occs[number])).toBe("Page");
    expect(m[0]?.viaChain).toEqual([
      { kind: "helper-call", callee: "useM", calleeFile: "src/Page.tsx" },
      { kind: "passed-as-argument", callee: "useModalHolder", index: 0 },
    ]);
    expect(m[0]?.line).toBe(lineOf(src, "useModalHolder(M)"));
    expect(m[0]?.column).toBe(columnOf(src, "useModalHolder(M)", "M", true));
    expect(m[0]?.definition).toEqual({ line: lineOf(src, "const M"), column: columnOf(src, "const M", "M") });

    const modal = occs.filter((o) => exportOf(o) === "Modal");
    expect(modal.map(ownerOf)).toEqual(["M"]);
    expect(occs.map(exportOf).filter((e) => ["useM", "useModalHolder", "modal"].includes(e))).toEqual([]);
  });

  it("the tuple shape: a destructured hook product returned from a helper hook fans the seed out to every caller through helper-call", () => {
    const occs = scan(
      {
        "src/useConfirm.tsx": `
          import { Modal, useModalHolder } from "@example/ui";
          const ConfirmModal = ({ onClose }) => <Modal onClose={onClose} />;
          export const useConfirmModal = () => {
            const [modal, showModal] = useModalHolder(ConfirmModal);
            return [modal, showModal];
          };
        `,
        "src/Header.tsx": `
          import { useConfirmModal } from "./useConfirm";
          export const Header = () => { const [modal, show] = useConfirmModal(); return <header onClick={show}>{modal}</header>; };
        `,
        "src/Sidebar.tsx": `
          import { useConfirmModal } from "./useConfirm";
          export const Sidebar = () => { const [modal] = useConfirmModal(); return <aside>{modal}</aside>; };
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    const seeds = occs.filter((o) => exportOf(o) === "ConfirmModal");
    expect(seeds.map(ownerOf).sort()).toEqual(["Header", "Sidebar"]);
    for (const s of seeds) {
      expect(s.filePath).toBe("src/useConfirm.tsx");
      expect(s.viaChain.map((v) => v.kind)).toEqual(["helper-call", "passed-as-argument"]);
    }
    // The modal's own render is owned by the modal, not fanned out to the callers.
    expect(occs.filter((o) => exportOf(o) === "Modal").map(ownerOf)).toEqual(["ConfirmModal"]);
  });

  it("a hook called directly in a component body seeds with the component as owner and no helper hop", () => {
    const occs = scan({
      "src/Page.tsx": `
        import { Modal, useModalHolder } from "@example/ui";
        const M = () => <Modal />;
        export const Page = () => { const [modal] = useModalHolder(M); return <div>{modal}</div>; };
      `,
    });
    const [seed, ...rest] = seeded(occs);
    expect(rest).toEqual([]);
    expect(exportOf(seed as Occs[number])).toBe("M");
    expect(ownerOf(seed as Occs[number])).toBe("Page");
    expect(seed?.viaChain).toHaveLength(1);
  });

  it("never seeds: a non-hook body call, a hook whose local argument is not a component, and a lowercase external argument (`useSelector(pick, shallowEqual)`) that React could never render", () => {
    const occs = scan({
      "src/Page.tsx": `
        import { Modal, registerThing, useThing } from "@example/ui";
        import { useSelector, shallowEqual } from "react-redux";
        const M = () => <Modal />;
        const config = { a: 1 };
        const pick = (s) => s.user;
        export const Page = () => {
          registerThing(M);
          useThing(config);
          const user = useSelector(pick, shallowEqual);
          return <div>{user}</div>;
        };
      `,
    });
    expect(seeded(occs)).toEqual([]);
    expect(occs.map(exportOf).filter((e) => ["M", "shallowEqual", "pick", "config"].includes(e))).toEqual([]);
  });
});

describe("argument-site seeding: hook arguments resolve in the function's scope; the host-element name rule reaches the holder loop; a rendered hook product is credited once", () => {
  it("a body-local component shadowing an imported name is the argument's identity, and its definition", () => {
    // The argument reference carries the function's scope, so both the
    // identity and `definition` resolve to the body-local declaration.
    const src = `
        import { Modal, Banner, useModalHolder } from "@example/ui";
        export const Page = () => {
          const Modal = () => <Banner />;
          const [modal] = useModalHolder(Modal);
          return <div>{modal}</div>;
        };
      `;
    const occs = scan({ "src/Page.tsx": src });
    const [seed, ...rest] = seeded(occs);
    expect(rest).toEqual([]);
    expect(seed?.rawComponentId).toEqual({ kind: "react-component", export: "Modal", source: { type: "local", filePath: "src/Page.tsx" } });
    expect(seed?.viaChain).toEqual([
      { kind: "passed-as-argument", index: 0, callee: "useModalHolder" },
    ]);
    expect(seed?.definition).toEqual({ line: lineOf(src, "const Modal"), column: columnOf(src, "const Modal", "Modal") });
  });

  it("the host-element name rule in the seam: a visible factory handed a lowercase external value at module scope seeds nothing either", () => {
    const occs = scan({
      "src/App.tsx": `
        import { shallowEqual } from "react-redux";
        const createThing = (compare) => (props) => <div data-compare={compare} {...props} />;
        export const Thing = createThing(shallowEqual);
        export const App = () => <Thing />;
      `,
    });
    expect(seeded(occs)).toEqual([]);
    expect(occs.map(exportOf)).not.toContain("shallowEqual");
  });

  it("a hook product rendered as a tag credits the argument once, at the render", () => {
    // `const C = useStyled(M); <C/>`: the render resolves `C` to `M` through
    // the hoc-wrapper fold, so the argument site seeds nothing.
    const occs = scan({
      "src/Page.tsx": `
        import { Modal, useStyled } from "@example/ui";
        const M = () => <Modal />;
        export const Page = () => { const C = useStyled(M); return <C />; };
      `,
    });
    const m = occs.filter((o) => exportOf(o) === "M");
    expect(m.map((o) => o.viaChain.map((v) => v.kind).join(">"))).toEqual(["local-component>hoc-wrapper"]);
    expect(m.map(ownerOf)).toEqual(["Page"]);
  });
});
