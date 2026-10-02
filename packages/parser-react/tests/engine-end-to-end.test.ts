/**
 * End-to-end behavioral tests for parser-react + reference-graph engine.
 *
 * Each test exercises the full pipeline:
 *   emitReact (structural AST → graph) → resolve (graph → occurrences)
 * and asserts only behaviour: "given source X, the engine produces
 * occurrences Y".
 */

import { describe, it, expect } from "vitest";
import { createDiagnosticCollector, resolve, MODULE_SCOPE, evalKind } from "@scoutui/reference-graph";
import { buildGraph, scan, scanGraph } from "./shape-helpers.js";

// ---------------------------------------------------------------------------
// Imports from a package
// ---------------------------------------------------------------------------

describe("parser-react + engine: imports from a package", () => {
  it("credits named, default, subpath and namespace imports to the package's export, with the import as written", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        import Bar from "pkg";
        import { Baz } from "@scope/pkg/dist/index";
        import * as UI from "pkg";
        export function App() { return <><Foo /><Bar /><Baz /><UI.Button /><UI /></>; }
      `,
    });
    const pkg = { type: "external", package: "pkg" };
    expect(occs.map((o) => ({ id: o.rawComponentId, via: o.via }))).toEqual([
      { id: { kind: "react-component", export: "Foo", source: pkg }, via: { kind: "direct-import", specifier: "pkg", import: "Foo" } },
      { id: { kind: "react-component", export: "default", source: pkg }, via: { kind: "direct-import", specifier: "pkg", import: "default" } },
      {
        id: { kind: "react-component", export: "Baz", source: { type: "external", package: "@scope/pkg", publicEntry: "dist/index" } },
        via: { kind: "direct-import", specifier: "@scope/pkg/dist/index", import: "Baz" },
      },
      { id: { kind: "react-component", export: "Button", source: pkg }, via: { kind: "direct-import", specifier: "pkg", import: "*" } },
      { id: { kind: "react-component", export: "*", source: pkg }, via: { kind: "direct-import", specifier: "pkg", import: "*" } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Cross-file local imports (relative specifiers)
// ---------------------------------------------------------------------------

describe("parser-react + engine: cross-file local imports", () => {
  it("emits local occurrence for `import { Foo } from './Foo'` when target is in graph", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/Foo.tsx": "export function Foo() { return <div/>; }",
        "src/App.tsx": `import { Foo } from "./Foo"; export function App() { return <Foo />; }`,
      },
      (from, spec) => {
        if (spec === "./Foo" && from === "/repo/src/App.tsx") return "/repo/src/Foo.tsx";
        return null;
      },
      repoRoot,
    );
    // One occurrence for <Foo /> in App.tsx; Foo's own <div/> yields none
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      source: { type: "local", filePath: "src/Foo.tsx" },
    });
    expect(occs[0]?.filePath).toBe("src/App.tsx");
  });
});

// ---------------------------------------------------------------------------
// Owner attribution
// ---------------------------------------------------------------------------

describe("parser-react + engine: owner attribution", () => {
  it("JSX inside a named function component: rawOwnerComponentId set to that function", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Button } from "pkg";
        export function Page() { return <Button />; }
      `,
    });
    expect(occs).toHaveLength(1);
    const owner = occs[0]?.rawOwnerComponentId;
    expect(owner).toBeDefined();
    expect(owner?.kind).toBe("react-component");
    expect((owner as { export: string } | undefined)?.export).toBe("Page");
  });

  it("JSX at module scope (not inside a function): rawOwnerComponentId is absent", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Button } from "pkg";
        const x = <Button />;
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawOwnerComponentId).toBeUndefined();
  });

  it("JSX inside arrow function assigned to const: owner is that const's name", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Button } from "pkg";
        export const Page = () => <Button />;
      `,
    });
    expect(occs).toHaveLength(1);
    const owner = occs[0]?.rawOwnerComponentId;
    expect(owner).toBeDefined();
    expect((owner as { export: string } | undefined)?.export).toBe("Page");
  });

  it("two components each render Button: each occurrence has its own owner", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Button } from "pkg";
        export function Alpha() { return <Button />; }
        export function Beta() { return <Button />; }
      `,
    });
    expect(occs).toHaveLength(2);
    const owners = occs.map((o) => (o.rawOwnerComponentId as { export: string } | undefined)?.export).sort();
    expect(owners).toEqual(["Alpha", "Beta"]);
  });
});

// ---------------------------------------------------------------------------
// Unbound roots (dynamic bindings, emitting nothing)
// ---------------------------------------------------------------------------

describe("parser-react + engine: JSX rooted in an unbound binding emits nothing", () => {
  // A runtime-determined root has no identity to report, so it reports none.
  it("_app.tsx-shaped `<Component {...pageProps} />` emits no occurrence", () => {
    const occs = scan({
      "src/_app.tsx": `
        export default function App({ Component, pageProps }) {
          return <Component {...pageProps} />;
        }
      `,
    });
    expect(occs).toEqual([]);
  });

  it("hook-return destructure `const { Modal } = useModal(); <Modal />` emits no occurrence", () => {
    const occs = scan({
      "src/App.tsx": `
        export function App() {
          const { Modal } = useModal();
          return <Modal />;
        }
      `,
    });
    expect(occs).toEqual([]);
  });

  it("array destructure `const [Tab] = useState(InitialTab); <Tab />` emits no occurrence", () => {
    const occs = scan({
      "src/App.tsx": `
        export function App() {
          const [Tab] = useState(InitialTab);
          return <Tab />;
        }
      `,
    });
    expect(occs).toEqual([]);
  });

  it("compound dynamic root `<Item.Foo />` over a render-prop param invents no `Item` component", () => {
    const occs = scan({
      "src/App.tsx": `
        export function App() {
          return <DataLoader>{(Item) => <Item.Foo />}</DataLoader>;
        }
      `,
    });
    expect(
      occs.some((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Item"),
    ).toBe(false);
  });

  it("no occurrence anywhere carries an `unknown` component source", () => {
    const occs = scan({
      "src/App.tsx": `
        export function App({ Component }) {
          const { Modal } = useModal();
          return <><Component /><Modal /></>;
        }
      `,
    });
    expect(occs.filter((o) => o.rawComponentId?.source.type === "unknown")).toEqual([]);
  });

  it("intrinsic roots over parameter and hook-return bindings stay silent", () => {
    // Models auto-generated icons, which destructure `title` and render
    // `<title>{title}</title>` inside an `<svg>`.
    const occs = scan({
      "src/Icon.tsx": `
        export function Icon({ title }) {
          return <svg><title>{title}</title></svg>;
        }
      `,
      "src/Label.tsx": `
        export function Label() {
          const { label } = useLabel();
          return <label />;
        }
      `,
    });
    expect(occs).toEqual([]);
  });

  it("negative: object-literal destructure is unaffected and never a phantom", () => {
    const occs = scan({
      "src/App.tsx": `
        export function App() {
          const { Foo } = { Foo: Bar };
          return <Foo />;
        }
      `,
    });
    expect(occs.filter((o) => o.rawComponentId?.source.type === "unknown")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Prop-forward attribution
// ---------------------------------------------------------------------------

describe("parser-react + engine: prop-forward attribution", () => {
  it("module-scope const = <X/> read in one function: X.renderedBy includes that function", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const slot = <Notification />;
        export function Consumer() {
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification' && from === '/repo/src/consumer.jsx') return '/repo/src/notification.jsx';
      if (spec === './page' && from === '/repo/src/consumer.jsx') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.via).toMatchObject({
      kind: "prop-forward",
      bindingName: "slot",
    });
    expect((notiOccurrences[0]?.via as { constructionSite: { line: number } }).constructionSite.line).toBeGreaterThan(0);
    expect(notiOccurrences[0]?.viaChain.map((v) => v.kind)).toEqual(["prop-forward"]);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toMatchObject({
      kind: "react-component",
      export: "Consumer",
    });
  });

  it("module-scope const = <X/> never read: preserves the orphan", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        const unused = <Notification />;
        export function Consumer() {
          return <div />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification' && from === '/repo/src/consumer.jsx') return '/repo/src/notification.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toBeUndefined();
    expect(notiOccurrences[0]?.via.kind).toBe("direct-import");
  });

  it("module-scope const = <X/> read in two functions: X has two occurrences (one per owner)", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const slot = <Notification />;
        export function Alpha() { return <Page slot={slot} />; }
        export function Beta() { return <Page slot={slot} />; }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(2);
    const owners = notiOccurrences.map((o) => (o.rawOwnerComponentId as { export: string }).export).sort();
    expect(owners).toEqual(["Alpha", "Beta"]);
    expect(notiOccurrences.every((o) => o.via.kind === "prop-forward")).toBe(true);
  });

  it("module-scope const = <X/> read twice in same function: X has one occurrence and nothing is reported", () => {
    const collector = createDiagnosticCollector();
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const slot = <Notification />;
        export function App() { return <><Page slot={slot}/><Page slot={slot}/></>; }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo", { collector });

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toMatchObject({ export: "App" });
    expect(notiOccurrences[0]?.via.kind).toBe("prop-forward");
    expect(collector.drain()).toEqual([]);
  });

  it("inner-scope shadowing: outer const slot is not read when inner const slot exists", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const slot = <Notification />;
        export function App() {
          const slot = "shadowed";
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toBeUndefined();
    expect(notiOccurrences[0]?.via.kind).toBe("direct-import");
  });

  it("param shadowing via shorthand destructure with default ({ slot = fallback }): outer slot is not read", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const fallback = null;
        const slot = <Notification />;
        export function App({ slot = fallback }) {
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toBeUndefined();
    expect(notiOccurrences[0]?.via.kind).toBe("direct-import");
  });

  it("keyed destructure with default ({ slot: renamed = fallback }) does not shadow: outer slot is read", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const fallback = null;
        const slot = <Notification />;
        export function App({ slot: renamed = fallback }) {
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toMatchObject({ export: "App" });
    expect(notiOccurrences[0]?.via.kind).toBe("prop-forward");
  });

  it("param shadowing via object-rest destructure ({ ...slot }): outer slot is not read", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const slot = <Notification />;
        export function App({ ...slot }) {
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toBeUndefined();
    expect(notiOccurrences[0]?.via.kind).toBe("direct-import");
  });

  it("param shadowing via bare default param (slot = fallback): outer slot is not read", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const fallback = null;
        const slot = <Notification />;
        export function App(slot = fallback) {
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toBeUndefined();
    expect(notiOccurrences[0]?.via.kind).toBe("direct-import");
  });

  it("a function-local `const slot = <X/>` is not prop-forwarded: via stays direct-import and the function owns it", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        export function App() {
          const slot = <Notification />;
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.rawOwnerComponentId).toMatchObject({ export: "App" });
    expect(notiOccurrences[0]?.via.kind).toBe("direct-import");
  });

  // ---------------------------------------------------------------------------
  // Parenthesised JSX const
  // ---------------------------------------------------------------------------

  it("a parenthesised module-scope JSX const is prop-forwarded", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const slot = (<Notification />);
        export function Consumer() {
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.via).toMatchObject({
      kind: "prop-forward",
      bindingName: "slot",
    });
    expect(notiOccurrences[0]?.rawOwnerComponentId).toMatchObject({
      kind: "react-component",
      export: "Consumer",
    });
  });

  it("a multi-line parenthesised module-scope JSX const is prop-forwarded", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/provider.jsx": "export function Provider({ children }) { return <div>{children}</div>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Provider } from './provider';
        import { Page } from './page';
        const slot = (
          <Provider>
            <Notification />
          </Provider>
        );
        export function Consumer() {
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './provider') return '/repo/src/provider.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.via.kind).toBe("prop-forward");
    expect(notiOccurrences[0]?.rawOwnerComponentId).toMatchObject({ export: "Consumer" });
  });

  // ---------------------------------------------------------------------------
  // JSX nested inside a JSX const
  // ---------------------------------------------------------------------------

  it("JSX nested inside a module-scope JSX const is prop-forwarded too", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ slot }) { return <div>{slot}</div>; }",
      "src/consumer.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const Outer = { Inner: ({ children }) => <div>{children}</div> };
        const slot = (<Outer.Inner><Notification /></Outer.Inner>);
        export function Consumer() {
          return <Page slot={slot} />;
        }
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.via).toMatchObject({
      kind: "prop-forward",
      bindingName: "slot",
    });
    expect(notiOccurrences[0]?.rawOwnerComponentId).toMatchObject({
      kind: "react-component",
      export: "Consumer",
    });
  });

  it("a module-scope const that wraps <Notification/> in a context provider forwards the inner usage", () => {
    const occs = scan({
      "src/notification.jsx": "export function Notification() { return <span/>; }",
      "src/page.jsx": "export function Page({ notification }) { return <div>{notification}</div>; }",
      "src/page-layout.jsx": `
        import { Notification } from './notification';
        import { Page } from './page';
        const DomainContext = { Provider: ({ children }) => <div>{children}</div> };
        const commonContext = {};
        const homeContext = {};
        const notification = (
          <DomainContext.Provider value={commonContext}>
            <Notification />
          </DomainContext.Provider>
        );
        const PageLayout = () => (
          <DomainContext.Provider value={homeContext}>
            <Page notification={notification} />
          </DomainContext.Provider>
        );
        export default PageLayout;
      `,
    }, (from, spec) => {
      if (spec === './notification') return '/repo/src/notification.jsx';
      if (spec === './page') return '/repo/src/page.jsx';
      return null;
    }, "/repo");

    const notiOccurrences = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Notification"
    );
    expect(notiOccurrences).toHaveLength(1);
    expect(notiOccurrences[0]?.via).toMatchObject({
      kind: "prop-forward",
      bindingName: "notification",
    });
    expect(notiOccurrences[0]?.rawOwnerComponentId).toMatchObject({
      kind: "react-component",
      export: "PageLayout",
    });
  });
});

// ---------------------------------------------------------------------------
// Lexical scoping: shadowed destructured IIFE (scope-id agreement between
// inferValue refs and walker-registered declarations)
// ---------------------------------------------------------------------------

describe("parser-react + engine: shadowed destructured IIFE", () => {
  it("resolves the return-object shorthand to the IIFE-local binding, not the outer destructure", () => {
    // The IIFE-local `Comp` shadows the destructure target, so the shorthand
    // in `return { Comp }` resolves to the local component instead of looping
    // back to the outer declaration (a reference cycle). The
    // external-import-leaf variant is in the "unresolvable external-import
    // leaves" block below.
    const occs = scan({
      "src/App.tsx": `
        export function App() {
          const { Comp } = (() => {
            const Comp = () => <span />;
            return { Comp };
          })();
          return <Comp />;
        }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Comp",
      source: { type: "local", filePath: "src/App.tsx" },
    });
    expect(occs[0]?.via).toMatchObject({ kind: "local-component" });
  });
});

// ---------------------------------------------------------------------------
// Unreducible-leaf identity synthesis
// ---------------------------------------------------------------------------

describe("parser-react + engine: unresolvable external-import leaves", () => {
  it("plain alias to an external import emits an occurrence with the imported identity", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Button } from "pkg";
        const AliasedButton = Button;
        export function App() {
          return <AliasedButton />;
        }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      export: "Button",
      source: { type: "external", package: "pkg" },
    });
  });

  it("body-scoped destructured IIFE whose leaf is an external import resolves to the imported identity", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Button } from "pkg";
        export function App() {
          const { Comp } = (() => {
            const Comp = Button;
            return { Comp };
          })();
          return <Comp />;
        }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      export: "Button",
      source: { type: "external", package: "pkg" },
    });
  });
});

// ---------------------------------------------------------------------------
// Structural pass-through wrappers
// ---------------------------------------------------------------------------

describe("local identity-preserving wrapper", () => {
  it("withX(Foo) where withX = (C) => C attributes the usage to Foo with a hoc-wrapper(withX) hop", () => {
    const occs = scan({
      "src/App.tsx": `
        const withX = (C) => C;
        const Foo = () => <div />;
        const Wrapped = withX(Foo);
        export const App = () => <Wrapped />;
      `,
    });
    const wrapped = occs.filter((o) => o.line === 5);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Foo",
      source: { type: "local" },
    });
    expect(
      wrapped[0]?.viaChain.map((v) => (v.kind === "hoc-wrapper" ? `hoc-wrapper(${v.hocCallee})` : v.kind)),
    ).toEqual(["local-component", "hoc-wrapper(withX)"]);
  });

  it("a curried local wrapper connect()(Foo) where connect = () => (c) => c also folds to Foo", () => {
    const occs = scan({
      "src/App.tsx": `
        const connect = () => (c) => c;
        const Foo = () => <div />;
        const Wrapped = connect()(Foo);
        export const App = () => <Wrapped />;
      `,
    });
    const wrapped = occs.filter((o) => o.line === 5);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.rawComponentId).toMatchObject({ kind: "react-component", export: "Foo" });
    expect(wrapped[0]?.viaChain.some((v) => v.kind === "hoc-wrapper" && v.hocCallee === "connect")).toBe(true);
  });

  // Negative control: a wrapper whose body returns a different component is
  // not structurally pass-through, so no `hoc-wrapper` hop appears. The
  // identity is the declaration holding the call (`Wrapped`), never the
  // callee `withFallback`.
  it("a wrapper that returns something other than its parameter is not folded structurally", () => {
    const occs = scan({
      "src/App.tsx": `
        const Fallback = () => <span />;
        const withFallback = (C) => Fallback;
        const Foo = () => <div />;
        const Wrapped = withFallback(Foo);
        export const App = () => <Wrapped />;
      `,
    });
    const wrapped = occs.filter((o) => o.line === 6);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.rawComponentId).toMatchObject({ export: "Wrapped" });
    expect(wrapped[0]?.viaChain.some((v) => v.kind === "hoc-wrapper")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A factory's products are its callers: real parser output
// ---------------------------------------------------------------------------

describe("factory products are callers of their factory: real parser output", () => {
  // An if/return body; the `cond ? <Spinner/> : <C .../>` ternary is covered
  // by the "ternary form" test below.
  it("attributes <Spinner/> inside withLoading's body to Foo and Bar, never to withLoading", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/with-loading.jsx": `
          import { Spinner } from "ds-icons";
          export const withLoading = (C) => (props) => {
            if (props.loading) return <Spinner />;
            return <C {...props} />;
          };
        `,
        "src/products.jsx": `
          import { withLoading } from "./with-loading";
          const FooView = () => <section>foo</section>;
          const BarView = () => <section>bar</section>;
          export const Foo = withLoading(FooView);
          export const Bar = withLoading(BarView);
        `,
      },
      (from, spec) => {
        if (spec === "./with-loading" && from === "/repo/src/products.jsx") return "/repo/src/with-loading.jsx";
        return null;
      },
      repoRoot,
    );
    const spinner = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Spinner",
    );
    expect(spinner.length).toBeGreaterThan(0);
    const owners = spinner
      .map((o) => (o.rawOwnerComponentId?.kind === "react-component" ? o.rawOwnerComponentId.export : null))
      .sort();
    expect(owners).toEqual(["Bar", "Foo"]);
    expect(owners.includes("withLoading")).toBe(false);
    for (const o of spinner) {
      expect(o.viaChain[0]).toMatchObject({ kind: "helper-call", callee: "withLoading" });
    }
  });
});

// ---------------------------------------------------------------------------
// An alias declaration is not a caller of what it aliases.
// ---------------------------------------------------------------------------

describe("an alias declaration is not a caller of what it aliases: real parser output", () => {
  it("Box inside RadioArea stays owned by RadioArea via direct-import, even though Item aliases RadioArea", () => {
    // RadioArea is exported and component-shaped, but the consumer renders
    // only its alias `<Item/>`, never `<RadioArea/>` itself.
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/radio-area.jsx": `
          import { Box } from "ds-lib";
          const RadioArea = (props) => <Box {...props} />;
          const Item = RadioArea;
          export { RadioArea, Item };
        `,
        "src/consumer.jsx": `
          import { Item } from "./radio-area";
          export const App = () => <Item />;
        `,
      },
      (from, spec) => {
        if (spec === "./radio-area" && from === "/repo/src/consumer.jsx") return "/repo/src/radio-area.jsx";
        return null;
      },
      repoRoot,
    );
    const box = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Box",
    );
    expect(box.length).toBeGreaterThan(0);
    for (const o of box) {
      expect(o.rawOwnerComponentId).toMatchObject({
        kind: "react-component",
        export: "RadioArea",
        source: { type: "local" },
      });
      expect(o.viaChain).toHaveLength(1);
      expect(o.viaChain[0]).toMatchObject({ kind: "direct-import" });
      expect(o.viaChain.some((v) => v.kind === "helper-call")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// evalKind on real parser output
// ---------------------------------------------------------------------------

describe("evalKind on real parser output: factory vs product", () => {
  it("classifies a curried factory as 'other', its product as 'component', a direct component as 'component', and a JSX literal as 'jsx'", () => {
    const graph = buildGraph({
      "src/App.tsx": `
        const withHoc = (useHook, C) => (props) => { useHook(); return <C {...props} />; };
        const View = () => <div/>;
        export const Product = withHoc(() => ({}), View);
        const br = <br/>;
      `,
    });
    const fileGraph = graph.files.get("src/App.tsx")!;
    const declValue = (name: string) => fileGraph.declarations.get(`${MODULE_SCOPE}::${name}`)!.value;
    expect(evalKind(declValue("withHoc"), graph, fileGraph)).toBe("other");
    expect(evalKind(declValue("Product"), graph, fileGraph)).toBe("component");
    expect(evalKind(declValue("View"), graph, fileGraph)).toBe("component");
    expect(evalKind(declValue("br"), graph, fileGraph)).toBe("jsx");
  });
});

// ---------------------------------------------------------------------------
// Conditional / logical render expressions → Union of the branches
// ---------------------------------------------------------------------------

describe("conditional and logical render expressions", () => {
  it("ternary-render component: two JSX terminals from one usage compact to one occurrence (cross-file)", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/x.tsx": "export const X = ({ a }) => a ? <div/> : <span/>;",
        "src/app.tsx": "import { X } from \"./x\"; export function App() { return <X />; }",
      },
      (from, spec) => {
        if (spec === "./x" && from === "/repo/src/app.tsx") return "/repo/src/x.tsx";
        return null;
      },
      repoRoot,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "X",
      source: { type: "local", filePath: "src/x.tsx" },
    });
  });

  it("attributes <Spinner/> inside withLoading's ternary body to Foo and Bar, never to withLoading (ternary form)", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/with-loading.jsx": `
          import { Spinner } from "ds-icons";
          export const withLoading = (C) => (props) => (props.loading ? <Spinner /> : <C {...props} />);
        `,
        "src/products.jsx": `
          import { withLoading } from "./with-loading";
          const FooView = () => <section>foo</section>;
          const BarView = () => <section>bar</section>;
          export const Foo = withLoading(FooView);
          export const Bar = withLoading(BarView);
        `,
      },
      (from, spec) => {
        if (spec === "./with-loading" && from === "/repo/src/products.jsx") return "/repo/src/with-loading.jsx";
        return null;
      },
      repoRoot,
    );
    const spinner = occs.filter(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Spinner",
    );
    expect(spinner.length).toBeGreaterThan(0);
    const owners = spinner
      .map((o) => (o.rawOwnerComponentId?.kind === "react-component" ? o.rawOwnerComponentId.export : null))
      .sort();
    expect(owners).toEqual(["Bar", "Foo"]);
    expect(owners.includes("withLoading")).toBe(false);
    for (const o of spinner) {
      expect(o.viaChain[0]).toMatchObject({ kind: "helper-call", callee: "withLoading" });
    }
  });

  it("evalKind classifies ternary-render and logical-AND-render arrows as 'component' on real parser output", () => {
    const graph = buildGraph({
      "src/App.tsx": `
        const X = ({ a }) => a ? <div/> : null;
        const Y = ({ a }) => a && <div/>;
      `,
    });
    const fileGraph = graph.files.get("src/App.tsx")!;
    const declValue = (name: string) => fileGraph.declarations.get(`${MODULE_SCOPE}::${name}`)!.value;
    expect(evalKind(declValue("X"), graph, fileGraph)).toBe("component");
    expect(evalKind(declValue("Y"), graph, fileGraph)).toBe("component");
  });
});

// ---------------------------------------------------------------------------
// Wrapper folding over real parser output: library-stubbed wrappers and factory
// products, run through emitReact + the engine.
// ---------------------------------------------------------------------------

describe("React library stubs and factory products: real parser output", () => {
  // `memo(View)` folds through the library stub (the `hoc-wrapper(memo)` hop is
  // produced). View's body is a ternary, which parser-react lowers to
  // `Union([JSX, JSX])`; each branch is a bare `JSX` terminal with no identity
  // of its own, so `foldTerminals` falls back to `TypeOf(View)`.
  it("`export default memo(View, areEqual)` attributes the consumer's usage to View, not to the comparator (two-arg form discriminates the library stub from the opaque last-arg fallback, which would pick areEqual)", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/View.jsx": `
          import { memo } from "react";
          const View = ({ a }) => (a ? <div /> : <span />);
          const areEqual = (prev, next) => prev.a === next.a;
          export default memo(View, areEqual);
        `,
        "src/App.jsx": `
          import View from "./View";
          export const App = () => <View />;
        `,
      },
      (from, spec) => {
        if (spec === "./View" && from === "/repo/src/App.jsx") return "/repo/src/View.jsx";
        return null;
      },
      repoRoot,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "View",
      source: { type: "local", filePath: "src/View.jsx" },
    });
    expect(
      occs[0]?.viaChain.some((v) => v.kind === "hoc-wrapper" && v.hocCallee === "memo"),
    ).toBe(true);
  });

  it("`export default memo(View)` with a multi-return View resolves to View through the library stub", () => {
    // Same shape as the ternary case above without the Union lowering: View
    // has two return statements instead.
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/View.jsx": `
          import { memo } from "react";
          const View = function ({ a }) { if (a) return <div />; return <span />; };
          export default memo(View);
        `,
        "src/App.jsx": `
          import View from "./View";
          export const App = () => <View />;
        `,
      },
      (from, spec) => {
        if (spec === "./View" && from === "/repo/src/App.jsx") return "/repo/src/View.jsx";
        return null;
      },
      repoRoot,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "View",
      source: { type: "local", filePath: "src/View.jsx" },
    });
    expect(
      occs[0]?.viaChain.some((v) => v.kind === "hoc-wrapper" && v.hocCallee === "memo"),
    ).toBe(true);
  });

  it("`export const FancyButton = forwardRef(fn, Other)` keeps the holding declaration's identity with a forwardRef hop (two-arg form discriminates the library stub from the opaque last-arg fallback, which would pick Other)", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/Button.jsx": `
          import { forwardRef } from "react";
          const Other = () => <span />;
          export const FancyButton = forwardRef((props, ref) => <button ref={ref} />, Other);
        `,
        "src/App.jsx": `
          import { FancyButton } from "./Button";
          export const App = () => <FancyButton />;
        `,
      },
      (from, spec) => {
        if (spec === "./Button" && from === "/repo/src/App.jsx") return "/repo/src/Button.jsx";
        return null;
      },
      repoRoot,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "FancyButton",
      source: { type: "local", filePath: "src/Button.jsx" },
    });
    expect(
      occs[0]?.viaChain.some((v) => v.kind === "hoc-wrapper" && v.hocCallee === "forwardRef"),
    ).toBe(true);
  });

  it("`import React from \"react\"; export default React.memo(View, areEqual)` attributes the consumer's usage to View through the default-import MemberOf form", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/View.jsx": `
          import React from "react";
          const View = ({ a }) => (a ? <div /> : <span />);
          const areEqual = (prev, next) => prev.a === next.a;
          export default React.memo(View, areEqual);
        `,
        "src/App.jsx": `
          import View from "./View";
          export const App = () => <View />;
        `,
      },
      (from, spec) => {
        if (spec === "./View" && from === "/repo/src/App.jsx") return "/repo/src/View.jsx";
        return null;
      },
      repoRoot,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "View",
      source: { type: "local", filePath: "src/View.jsx" },
    });
    expect(
      occs[0]?.viaChain.some((v) => v.kind === "hoc-wrapper" && v.hocCallee === "memo"),
    ).toBe(true);
  });

  it("`import * as R from \"react\"; export const X = R.forwardRef((p, ref) => <button ref={ref}/>)` attributes the consumer's usage to X through the namespace-import MemberOf form", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/Button.jsx": `
          import * as R from "react";
          export const X = R.forwardRef((p, ref) => <button ref={ref} />);
        `,
        "src/App.jsx": `
          import { X } from "./Button";
          export const App = () => <X />;
        `,
      },
      (from, spec) => {
        if (spec === "./Button" && from === "/repo/src/App.jsx") return "/repo/src/Button.jsx";
        return null;
      },
      repoRoot,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "X",
      source: { type: "local", filePath: "src/Button.jsx" },
    });
    expect(
      occs[0]?.viaChain.some((v) => v.kind === "hoc-wrapper" && v.hocCallee === "forwardRef"),
    ).toBe(true);
  });

  const fieldFactoryFiles = {
    "src/make-control.jsx": `
      export const makeControl = (Component, mapProps) => (props) => <Component {...props} />;
    `,
    "src/Dropdown.jsx": `
      import { Dropdown as DropdownBase } from "@example/design-system";
      import { makeControl } from "./make-control";
      export const Dropdown = makeControl(DropdownBase, (p) => ({ value: p.name }));
    `,
    "src/App.jsx": `
      import { Dropdown } from "./Dropdown";
      export const App = () => <Dropdown />;
    `,
  };

  const fieldFactoryResolver = (from: string, spec: string) => {
    if (spec === "./make-control" && from === "/repo/src/Dropdown.jsx") return "/repo/src/make-control.jsx";
    if (spec === "./Dropdown" && from === "/repo/src/App.jsx") return "/repo/src/Dropdown.jsx";
    return null;
  };

  it("`makeControl(DropdownBase, fn)` attributes <Dropdown/> to the product declaration, never to makeControl", () => {
    const occs = scan(fieldFactoryFiles, fieldFactoryResolver, "/repo");
    const consumer = occs.filter((o) => o.filePath === "src/App.jsx");
    expect(consumer).toHaveLength(1);
    expect(consumer[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Dropdown",
      source: { type: "local", filePath: "src/Dropdown.jsx" },
    });
    expect(
      occs.some((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "makeControl"),
    ).toBe(false);
  });

  it("`<Component {...props} />` inside the factory body emits no phantom occurrence", () => {
    const occs = scan(fieldFactoryFiles, fieldFactoryResolver, "/repo");
    expect(
      occs.some((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Component"),
    ).toBe(false);
    expect(occs.filter((o) => o.rawComponentId?.source.type === "unknown")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Registry membership and render crediting: real parser output
// ---------------------------------------------------------------------------

describe("registry membership and render crediting: real parser output", () => {
  it("a JSX value interpolated as `{br}` never becomes a component identity", () => {
    const { occurrences, registry } = scanGraph({
      "src/App.jsx": `
        const br = <br key="br" />;
        export const App = () => <div>{br}</div>;
      `,
    });
    expect(registry.hasLocal("src/App.jsx", "br")).toBe(false);
    expect(
      occurrences.some((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "br"),
    ).toBe(false);
  });

  it("`makeControl(DropdownBase, fn)` rendered as <Dropdown/> emits the render plus the argument-site occurrence; makeControl is never an identity and never a registry member", () => {
    const repoRoot = "/repo";
    const files = {
      "src/make-control.jsx": `
        export const makeControl = (Component, mapProps) => (props) => <Component {...props} />;
      `,
      "src/Dropdown.jsx": `
        import { Dropdown as DropdownBase } from "@example/design-system";
        import { makeControl } from "./make-control";
        export const Dropdown = makeControl(DropdownBase, (p) => ({ value: p.name }));
      `,
      "src/App.jsx": `
        import { Dropdown } from "./Dropdown";
        export const App = () => <Dropdown />;
      `,
    };
    const resolver = (from: string, spec: string) => {
      if (spec === "./make-control" && from === "/repo/src/Dropdown.jsx") return "/repo/src/make-control.jsx";
      if (spec === "./Dropdown" && from === "/repo/src/App.jsx") return "/repo/src/Dropdown.jsx";
      return null;
    };
    const { occurrences, registry } = scanGraph(files, resolver, repoRoot);
    expect(occurrences).toHaveLength(2);
    const render = occurrences.find((o) => o.via.kind === "direct-import");
    expect(render?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Dropdown",
      source: { type: "local", filePath: "src/Dropdown.jsx" },
    });
    // The design-system component handed to the factory is
    // credited once at its argument site, owned by the product.
    const arg = occurrences.find((o) => o.via.kind === "passed-as-argument");
    expect(arg?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Dropdown",
      source: { type: "external", package: "@example/design-system" },
    });
    expect(arg?.rawOwnerComponentId).toMatchObject({ export: "Dropdown", source: { type: "local", filePath: "src/Dropdown.jsx" } });
    expect(
      occurrences.some((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "makeControl"),
    ).toBe(false);
    expect(registry.hasLocal("src/make-control.jsx", "makeControl")).toBe(false);
  });

  it("a JSX-returning helper that is called, never rendered/exported/passed, is not a registry member; its inner JSX is owned by the caller (helper-call)", () => {
    const { occurrences, registry } = scanGraph({
      "src/App.jsx": `
        import { Icon } from "ds-icons";
        function renderIcon() {
          return <Icon />;
        }
        export function App() {
          return <div>{renderIcon()}</div>;
        }
      `,
    });
    expect(registry.hasLocal("src/App.jsx", "renderIcon")).toBe(false);
    expect(
      occurrences.some((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "renderIcon"),
    ).toBe(false);
    const icon = occurrences.find(
      (o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Icon",
    );
    expect(icon).toBeDefined();
    expect(icon?.rawOwnerComponentId).toMatchObject({
      kind: "react-component",
      export: "App",
      source: { type: "local" },
    });
    expect(icon?.viaChain[0]).toMatchObject({ kind: "helper-call", callee: "renderIcon" });
  });

  it("`export class ApiClient { fetch() { return 1; } }` is not a registry member and produces no occurrence", () => {
    const { occurrences, registry } = scanGraph({
      "src/App.jsx": `
        export class ApiClient {
          fetch() {
            return 1;
          }
        }
      `,
    });
    expect(registry.hasLocal("src/App.jsx", "ApiClient")).toBe(false);
    expect(occurrences).toHaveLength(0);
  });

  it("a non-exported same-file component reached only through an alias is credited under its own name", () => {
    // `Item` aliases `Inner` (never exported, never itself JSX-used); `<Item/>`
    // is the only usage. The engine's alias resolution (same as the
    // "an alias declaration is not a caller of what it aliases" suite above)
    // names Inner's own identity at the tag.
    const { occurrences } = scanGraph({
      "src/App.jsx": `
        function Inner() {
          return <div />;
        }
        const Item = Inner;
        export const App = () => <Item />;
      `,
    });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Inner",
      source: { type: "local", filePath: "src/App.jsx" },
    });
  });
});

describe("createComponent(render) products (forwardRef+memo wrapping a called parameter)", () => {
  it("a product of `createComponent(render)`, where the factory wraps render(...) in forwardRef(memo(...)) and calls its own parameter, is component-shaped and its render-site occurrence survives", () => {
    const repoRoot = "/repo";
    const graph = buildGraph(
      {
        "src/utils.ts": `
          import { forwardRef, memo } from "react";
          export function createComponent(render) {
            const Component = forwardRef((props, ref) => render({ ref, ...props }));
            const MemoizedComponent = memo(Component);
            if (render.name) { MemoizedComponent.displayName = render.name; }
            return MemoizedComponent;
          }
        `,
        "src/shared.tsx": `
          import { createComponent } from "./utils";
          export const FormLabel = createComponent(function FormLabel({ className, ...props }) {
            return <label className={className} {...props} />;
          });
        `,
        "src/App.tsx": `
          import { FormLabel } from "./shared";
          export const App = () => <FormLabel />;
        `,
      },
      (from, spec) => {
        if (spec === "./utils" && from === "/repo/src/shared.tsx") return "/repo/src/utils.ts";
        if (spec === "./shared" && from === "/repo/src/App.tsx") return "/repo/src/shared.tsx";
        return null;
      },
      repoRoot,
    );
    const sharedFg = graph.files.get("src/shared.tsx");
    const formLabelDecl = sharedFg?.declarations.get("0::FormLabel");
    expect(formLabelDecl).toBeDefined();
    if (!formLabelDecl || !sharedFg) return;
    expect(evalKind(formLabelDecl.value, graph, sharedFg)).toBe("component");

    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "FormLabel",
      source: { type: "local", filePath: "src/shared.tsx" },
    });
  });
});

describe("component namespaces rendered through member access", () => {
  it("`export const Sidebar = { Root, Leaf }` rendered as `<Sidebar.Root/>` from another file resolves to the member", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/nav.tsx": `
          function Root() { return <div className="root" />; }
          function Leaf() { return <div className="leaf" />; }
          export const Sidebar = { Root, Leaf };
        `,
        "src/consumer.tsx": `
          import { Sidebar } from "./nav";
          export const App = () => <Sidebar.Root />;
        `,
      },
      (from, spec) => {
        if (spec === "./nav" && from === "/repo/src/consumer.tsx") return "/repo/src/nav.tsx";
        return null;
      },
      repoRoot,
    );
    expect(occs).toHaveLength(1);
    // The walker's static-member arm walks into the referenced
    // prop and derives identity from Root's own declaration, not from the
    // namespace holder `Sidebar`. That holds when the member is a reference
    // to a component; an inline-function member (`{ Inline: () => <div/> }`)
    // still mints a row under the namespace name.
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Root",
      source: { type: "local", filePath: "src/nav.tsx" },
    });
  });
});

describe(".map(render) / element arrays / dynamic members", () => {
  it("a function whose body is `items.map(item => <li/>)` is component-shaped, and its render-site occurrence survives admission", () => {
    // Parser-level proof that oxc-parser + emit.ts produce the exact
    // InferredType shape component-shape.test.ts's unit tests assume:
    // Function{returns:[ReturnTypeOf(MemberOf(items,"map"), [Function[JSX]])]}.
    const graph = buildGraph({
      "src/SubmenuItemsRender.tsx": `
        export function SubmenuItemsRender({ items }) {
          return items.map((item) => <li key={item.id}>{item.label}</li>);
        }
      `,
    });
    const fg = graph.files.get("src/SubmenuItemsRender.tsx");
    const decl = fg?.declarations.get("0::SubmenuItemsRender");
    expect(decl).toBeDefined();
    if (!decl) return;
    expect(evalKind(decl.value, graph, fg!)).toBe("component");

    // walkWithFolding's "Function" case lets a component's own returns reach
    // wrapper-folding's opaque-callee step, so the render site in another
    // file survives.
    const occs = scan(
      {
        "src/SubmenuItemsRender.tsx": `
          export function SubmenuItemsRender({ items }) {
            return items.map((item) => <li key={item.id}>{item.label}</li>);
          }
        `,
        "src/App.tsx": `
          import { SubmenuItemsRender } from "./SubmenuItemsRender";
          export const App = () => <SubmenuItemsRender items={[]} />;
        `,
      },
      (from, spec) => {
        if (spec === "./SubmenuItemsRender" && from === "/repo/src/App.tsx") return "/repo/src/SubmenuItemsRender.tsx";
        return null;
      },
      "/repo",
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "SubmenuItemsRender",
      source: { type: "local", filePath: "src/SubmenuItemsRender.tsx" },
    });
    expect(occs[0]?.viaChain).toEqual([{ kind: "direct-import", specifier: "./SubmenuItemsRender", import: "SubmenuItemsRender" }]);
  });

  it("Page → List → Item: a component returning items.map(render) attributes the rendered component to itself, and is itself attributed to its own renderer", () => {
    const occs = scan(
      {
        "src/Item.tsx": "export const Item = () => <span>item</span>;",
        "src/List.tsx": `
          import { Item } from "./Item";
          export const List = ({ items }) => items.map((it) => <Item key={it.id} />);
        `,
        "src/Page.tsx": `
          import { List } from "./List";
          const data = [{ id: 1 }, { id: 2 }];
          export const Page = () => <List items={data} />;
        `,
      },
      (from, spec) => {
        if (spec === "./Item" && from === "/repo/src/List.tsx") return "/repo/src/Item.tsx";
        if (spec === "./List" && from === "/repo/src/Page.tsx") return "/repo/src/List.tsx";
        return null;
      },
      "/repo",
    );
    expect(occs).toHaveLength(2);
    const itemOcc = occs.find((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Item");
    const listOcc = occs.find((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "List");
    expect(itemOcc).toBeDefined();
    expect(listOcc).toBeDefined();
    // Item is owned by List with no helper-call hop: List's own JSX usage of
    // Item is a plain direct-import render, not a helper attribution.
    expect(itemOcc?.rawOwnerComponentId).toMatchObject({ export: "List", source: { type: "local", filePath: "src/List.tsx" } });
    expect(itemOcc?.viaChain).toEqual([{ kind: "direct-import", specifier: "./Item", import: "Item" }]);
    // List itself is owned by Page.
    expect(listOcc?.rawOwnerComponentId).toMatchObject({ export: "Page", source: { type: "local", filePath: "src/Page.tsx" } });
    expect(listOcc?.viaChain).toEqual([{ kind: "direct-import", specifier: "./List", import: "List" }]);
  });

  it("a component selected via a dynamic member access (`const Banner = MAP[type]`) fans out to every branch on admission, like Union fanout", () => {
    const repoRoot = "/repo";
    const occs = scan(
      {
        "src/banners.tsx": `
          function SuccessBanner() { return <div className="success" />; }
          function ErrorBanner() { return <div className="error" />; }
          const MAP = { success: SuccessBanner, error: ErrorBanner };
          export const Banner = MAP[getBannerType()];
        `,
        "src/consumer.tsx": `
          import { Banner } from "./banners";
          export const App = () => <Banner />;
        `,
      },
      (from, spec) => {
        if (spec === "./banners" && from === "/repo/src/consumer.tsx") return "/repo/src/banners.tsx";
        return null;
      },
      repoRoot,
    );
    // Dynamic-map fanout attributes each branch to its own binding, as Union
    // fanout does, rather than collapsing to one outer identity: both
    // SuccessBanner and ErrorBanner are admitted.
    expect(occs).toHaveLength(2);
    const exportNames = occs.map((o) => (o.rawComponentId?.kind === "react-component" ? o.rawComponentId.export : null)).sort();
    expect(exportNames).toEqual(["ErrorBanner", "SuccessBanner"]);
    for (const occ of occs) {
      expect(occ.rawComponentId).toMatchObject({ kind: "react-component", source: { type: "local", filePath: "src/banners.tsx" } });
    }
  });
});

describe("a component's return keeps the component as identity fallback", () => {
  it("a JSX-value alias returned directly (`const priceElement = <span/>; return priceElement;`) is admitted as the component, not the alias", () => {
    const occs = scan(
      {
        "src/OfferPrice.tsx": `
          export const OfferPrice = () => {
            const priceElement = <span />;
            return priceElement;
          };
        `,
        "src/App.tsx": `
          import { OfferPrice } from "./OfferPrice";
          export const App = () => <OfferPrice />;
        `,
      },
      (from, spec) => (spec === "./OfferPrice" && from === "/repo/src/App.tsx" ? "/repo/src/OfferPrice.tsx" : null),
      "/repo",
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "OfferPrice",
      source: { type: "local", filePath: "src/OfferPrice.tsx" },
    });
    expect(occs[0]?.viaChain).toEqual([{ kind: "direct-import", specifier: "./OfferPrice", import: "OfferPrice" }]);
  });

  it("a hook-return leaf returned directly (`const { modals } = useModals(); return modals;`) is admitted as the component, not a same-file binding", () => {
    const occs = scan(
      {
        "src/DrawerContactModals.tsx": `
          function useModals() {
            return { modals: <div>modals</div> };
          }
          export const DrawerContactModals = () => {
            const { modals } = useModals();
            return modals;
          };
        `,
        "src/App.tsx": `
          import { DrawerContactModals } from "./DrawerContactModals";
          export const App = () => <DrawerContactModals />;
        `,
      },
      (from, spec) => (spec === "./DrawerContactModals" && from === "/repo/src/App.tsx" ? "/repo/src/DrawerContactModals.tsx" : null),
      "/repo",
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "DrawerContactModals",
      source: { type: "local", filePath: "src/DrawerContactModals.tsx" },
    });
    expect(occs[0]?.viaChain).toEqual([{ kind: "direct-import", specifier: "./DrawerContactModals", import: "DrawerContactModals" }]);
  });
});

// ---------------------------------------------------------------------------
// Anonymous default-export arrow: the Next.js / Remix page shape
// ---------------------------------------------------------------------------

describe("parser-react + engine: `export default () => <X />`", () => {
  it("emits the external occurrence, owned by the file's default export", () => {
    const occs = scan({
      "src/page.tsx": `
        import { Button } from "pkg";
        export default () => <Button />;
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      export: "Button",
      source: { type: "external", package: "pkg" },
    });
    const owner = occs[0]?.rawOwnerComponentId;
    expect(owner?.kind).toBe("react-component");
    expect((owner as { export: string } | undefined)?.export).toBe("default");
  });

  it("`export default ({ Component, pageProps }) => <Component {...pageProps} />` emits no occurrence", () => {
    // Param-rooted JSX has no identity, as with the
    // `export default function App({ Component })` shape above: the arrow
    // branch binds its parameters before walking the body.
    const occs = scan({
      "src/_app.tsx": "export default ({ Component, pageProps }) => <Component {...pageProps} />;",
    });
    expect(occs).toEqual([]);
  });
});
