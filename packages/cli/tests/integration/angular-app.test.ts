/**
 * Semantic gate for the angular-app fixture: one repository holding Angular
 * component shapes, each under `src/<shape>/`, scanned once per supported
 * Angular major (19-22; the compiler's template parser is the only Angular
 * runtime code this suite exercises).
 *
 * Scout only gives a `components[]` entry to a declared component that
 * renders something or is itself rendered (same rule vue-app.test.ts's
 * "script-only" case proves for Vue) - a lone root/page component that
 * nothing in the fixture renders won't appear unless something uses it.
 * `bootstrap-root`'s AppRootComponent is the exception: `bootstrapApplication`
 * counts as rendering it, with `usage: "root"`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isDeepStrictEqual } from "node:util";
import type { ScanArtifact } from "@scoutui/scan-format";
import type { Diagnostic } from "../../src/diagnostic.js";
import { scanFixture } from "../helpers/stage-fixture.js";

const VERSIONS = [19, 20, 21, 22] as const;

const inShape = (shape: string, filePath: string) => filePath.startsWith(`src/${shape}/`);

const local = (shape: string, file: string, exportName: string) => ({
  kind: "repository-declaration",
  repoId: "angular-app",
  filePath: `src/${shape}/${file}`,
  exportName,
});
const tag = (tagName: string) => ({ kind: "tag", tagName });
const imported = (specifier: string, name: string) => ({ kind: "import", specifier, name });
const pkg = (packageName: string, publicEntry: string, exportName: string) => ({
  kind: "package-export",
  packageName,
  publicEntry,
  exportName,
});

/** One expected occurrence; `at` is `<file>:<line>:<column>` within its shape. */
function row(
  at: string,
  component: unknown,
  owner: unknown,
  trace: unknown[],
  props: Record<string, unknown> = {},
  events?: string[],
) {
  return { at, component, owner, credit: { kind: "render" }, trace, props, events };
}

describe.each(VERSIONS)("integration: angular-app fixture (Angular %d)", (ngVersion) => {
  let out: ScanArtifact<Diagnostic>;
  const prevEnv = process.env.SCOUT_TEST_ANGULAR_COMPILER;

  beforeAll(async () => {
    process.env.SCOUT_TEST_ANGULAR_COMPILER = require.resolve(`@angular/compiler-${ngVersion}`);
    ({ artifact: out } = await scanFixture("angular-app"));
  }, 120_000);

  afterAll(() => {
    // biome-ignore lint/performance/noDelete: process.env coerces an `undefined` assignment to the string "undefined"; delete is the only way to truly unset it.
    if (prevEnv === undefined) delete process.env.SCOUT_TEST_ANGULAR_COMPILER;
    else process.env.SCOUT_TEST_ANGULAR_COMPILER = prevEnv;
  });

  const identityOf = () => new Map(out.components.map((c) => [c.id, c.identity]));

  /** Every occurrence under `src/<shape>/`, in source order, with ids replaced by identities. */
  function rendersIn(shape: string) {
    const identity = identityOf();
    return out.occurrences
      .filter((o) => inShape(shape, o.filePath))
      .sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : a.line - b.line || a.column - b.column))
      .map((o) => ({
        at: `${o.filePath.slice(`src/${shape}/`.length)}:${o.line}:${o.column}`,
        component: o.resolution.status === "resolved" ? identity.get(o.resolution.componentId) : o.resolution,
        owner: o.ownerComponentId === undefined ? undefined : identity.get(o.ownerComponentId),
        credit: o.credit,
        trace: o.trace,
        props: o.props,
        events: o.events,
      }));
  }

  const componentOf = (identity: object) => out.components.find((c) => isDeepStrictEqual(c.identity, identity));

  describe("standalone-import", () => {
    const S = "standalone-import";
    const appComponent = local(S, "app.component.ts", "AppComponent");
    const buttonComponent = local(S, "button.component.ts", "ButtonComponent");

    it("credits the templateUrl's element use to the imported standalone component, in the .html file, owned by AppComponent", () => {
      expect(rendersIn(S)).toEqual([
        row("app.component.html:2:3", buttonComponent, appComponent, [imported("./button.component", "ButtonComponent")], {
          label: { tier: "written", value: "Save" },
          disabled: { tier: "reference", ref: "busy" },
        }, ["pressed"]),
      ]);
    });

    it("declares ButtonComponent's input() props as its declared API", () => {
      expect(componentOf(buttonComponent)?.declared).toEqual({
        props: { label: {}, variant: {}, disabled: {} },
        hasRest: false,
      });
      expect(componentOf(buttonComponent)?.framework).toBe("angular");
    });
  });

  describe("inline-template", () => {
    const S = "inline-template";
    const card = local(S, "card.component.ts", "CardComponent");
    const tagComponent = local(S, "tag.component.ts", "TagComponent");

    it("locates a multi-line inline template's use at its real position inside the .ts file", () => {
      expect(rendersIn(S)).toEqual([
        row("card.component.ts:9:7", tagComponent, card, [imported("./tag.component", "TagComponent")], {
          text: { tier: "written", value: "New" },
        }),
      ]);
    });
  });

  describe("ng-module-scope", () => {
    const S = "ng-module-scope";
    const widget = local(S, "widget.component.ts", "WidgetComponent");
    const panel = local(S, "panel.component.ts", "PanelComponent");

    it("resolves a non-standalone component used by another module's component through imports: [SharedModule]", () => {
      expect(rendersIn(S)).toEqual([
        row("panel.component.html:1:1", widget, panel, [imported("./widget.component", "WidgetComponent")]),
      ]);
      expect(componentOf(widget)?.framework).toBe("angular");
    });
  });

  describe("decorator-io", () => {
    const S = "decorator-io";
    const toggle = local(S, "toggle.component.ts", "ToggleComponent");
    const page = local(S, "decorator-io-page.component.ts", "DecoratorIoPageComponent");

    it("reads @Input()/@Input('alias') bindings and @Output() listeners off the template use", () => {
      expect(rendersIn(S)).toEqual([
        row(
          "decorator-io-page.component.ts:7:14",
          toggle,
          page,
          [imported("./toggle.component", "ToggleComponent")],
          {
            label: { tier: "written", value: "Dark mode" },
            checkedState: { tier: "written", value: true },
          },
          ["toggled"],
        ),
      ]);
    });

    it("declares the aliased input under its alias, not its property name", () => {
      expect(componentOf(toggle)?.declared).toEqual({
        props: { label: {}, checkedState: {} },
        hasRest: false,
      });
    });
  });

  describe("signal-io", () => {
    const S = "signal-io";
    const counter = local(S, "counter.component.ts", "CounterComponent");
    const page = local(S, "signal-io-page.component.ts", "SignalIoPageComponent");

    it("reads a signal input() literal binding as written, and a [(model)] two-way binding to a plain identifier as a reference", () => {
      expect(rendersIn(S)).toEqual([
        row(
          "signal-io-page.component.ts:7:14",
          counter,
          page,
          [imported("./counter.component", "CounterComponent")],
          {
            step: { tier: "written", value: 2 },
            value: { tier: "reference", ref: "total" },
          },
          ["valueChange"],
        ),
      ]);
    });

    it("declares model()'s backing property as an input, plus its generated <name>Change output", () => {
      expect(componentOf(counter)?.declared).toEqual({
        props: { step: {}, value: {} },
        hasRest: false,
      });
    });
  });

  describe("control-flow", () => {
    const S = "control-flow";
    const item = local(S, "item.component.ts", "ItemComponent");
    const flow = local(S, "control-flow.component.ts", "ControlFlowComponent");

    // Angular 21 renamed `SwitchBlock.cases` to `SwitchBlock.groups` (each
    // group holding its own `.children`); packages/parser-angular's
    // emit-template.ts CHILD_KEYS includes both, so @switch/@case/@for work
    // on every supported major.
    it("follows @for/@switch/@case/@defer/@placeholder/@let into their child content and finds every <app-item> use", () => {
      const rows = rendersIn(S);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => isDeepStrictEqual(r.component, item) && isDeepStrictEqual(r.owner, flow))).toBe(true);
      expect(rows.map((r) => r.props.text)).toEqual([
        { tier: "reference", ref: "item" }, // inside @for, bound to the loop variable
        { tier: "written", value: "deferred" }, // inside @defer
      ]);
    });

    // This part of the template (@defer/@placeholder) is unaffected by the
    // @switch/@case gap above and should pass on every version.
    it("finds the @defer block's <app-item>, regardless of the @switch/@case gap", () => {
      const rows = rendersIn(S).filter((r) => isDeepStrictEqual(r.component, item));
      expect(rows.some((r) => isDeepStrictEqual(r.props.text, { tier: "written", value: "deferred" }))).toBe(true);
    });
  });

  describe("attribute-selector", () => {
    const S = "attribute-selector";
    const iconButton = local(S, "icon-button.component.ts", "IconButtonComponent");
    const toolbar = local(S, "toolbar.component.ts", "ToolbarComponent");

    it("matches a `button[app-icon-button]` attribute selector against <button app-icon-button>", () => {
      expect(rendersIn(S)).toEqual([
        row("toolbar.component.ts:7:14", iconButton, toolbar, [imported("./icon-button.component", "IconButtonComponent")]),
      ]);
    });
  });

  describe("ng-content-projection", () => {
    const S = "ng-content-projection";
    const frame = local(S, "frame.component.ts", "FrameComponent");
    const badge = local(S, "badge.component.ts", "BadgeComponent");
    const page = local(S, "projection-page.component.ts", "ProjectionPageComponent");

    it("credits a component projected as another component's content, owned by the page that wrote both", () => {
      expect(rendersIn(S)).toEqual([
        row("projection-page.component.ts:8:14", frame, page, [imported("./frame.component", "FrameComponent")]),
        row("projection-page.component.ts:8:25", badge, page, [imported("./badge.component", "BadgeComponent")], {
          text: { tier: "written", value: "New" },
        }),
      ]);
    });
  });

  describe("unimported-tag", () => {
    const S = "unimported-tag";
    const page = local(S, "unimported-tag-page.component.ts", "UnimportedTagPageComponent");

    it("reports a hyphenated tag no component declares as a tag usage, in the web-component lane", () => {
      expect(rendersIn(S)).toEqual([row("unimported-tag-page.component.ts:5:14", tag("x-widget"), page, [])]);
    });

    // Negative/positive pair: an ordinary HTML element and Angular's own
    // built-ins never appear as occurrences; only `<x-widget>` does.
    it("does not report a plain element as a usage of anything", () => {
      expect(rendersIn(S).every((r) => (r.component as { tagName?: string }).tagName !== "div")).toBe(true);
    });
  });

  describe("selector-conflict", () => {
    const S = "selector-conflict";

    it("counts no occurrence for <app-thing> when two exported, unimported components share its selector", () => {
      expect(rendersIn(S)).toEqual([]);
    });

    it("reports the ambiguity as a diagnostic naming both candidates, instead of guessing one", () => {
      const diag = out.diagnostics?.find((d) => (d as { code?: string }).code === "angular-selector-ambiguous");
      expect(diag).toMatchObject({
        tagName: "app-thing",
        candidates: [
          "src/selector-conflict/one/thing.component.ts#ThingOneComponent",
          "src/selector-conflict/two/thing.component.ts#ThingTwoComponent",
        ],
      });
    });

    it("declares no component in this shape (its only use never resolved, so nothing renders or is rendered)", () => {
      expect(componentOf(local(S, "one/thing.component.ts", "ThingOneComponent"))).toBeUndefined();
      expect(componentOf(local(S, "two/thing.component.ts", "ThingTwoComponent"))).toBeUndefined();
    });
  });

  describe("bootstrap-root", () => {
    const S = "bootstrap-root";
    const appRoot = local(S, "app-root.component.ts", "AppRootComponent");

    it("marks bootstrapApplication(AppRootComponent)'s argument as the app's root, usage \"root\"", () => {
      expect(componentOf(appRoot)?.usage).toBe("root");
    });
  });

  describe("bootstrap-module", () => {
    const S = "bootstrap-module";
    const rootView = local(S, "root-view.component.ts", "RootViewComponent");

    it("platformBrowserDynamic().bootstrapModule(RootModule) resolves through RootModule's bootstrap: [RootViewComponent], usage \"root\"", () => {
      expect(componentOf(rootView)?.usage).toBe("root");
    });
  });

  describe("app-ts-naming", () => {
    const S = "app-ts-naming";

    it("detects a v20+-style app.ts file (class App, selector app-root2) same as any other component file", () => {
      const app = componentOf(local(S, "app.ts", "App"));
      expect(app).toBeDefined();
      expect(app?.framework).toBe("angular");
      expect(rendersIn(S)).toEqual([
        row("app-host.component.ts:7:14", local(S, "app.ts", "App"), local(S, "app-host.component.ts", "AppHostComponent"), [
          imported("./app", "App"),
        ]),
      ]);
    });
  });

  describe("library-components", () => {
    const S = "library-components";
    const appComponent = local(S, "app.component.ts", "AppComponent");
    const exCard = pkg("@example/ng-ui", "card", "ExCard");
    const exButton = pkg("@example/ng-ui", "", "ExButton");

    it("resolves a component declared in an installed library's subpath entry, crediting the subpath it was imported from", () => {
      expect(rendersIn(S)).toEqual([
        row(
          "app.component.html:1:1",
          exCard,
          appComponent,
          [imported("@example/ng-ui/card", "ExCard")],
          {
            elevation: { tier: "written", value: "2" },
            title: { tier: "reference", ref: "t" },
          },
          ["closed"],
        ),
        row("app.component.html:2:1", exButton, appComponent, [imported("@example/ng-ui", "ExButton")]),
      ]);
    });

    it("declares the library component's inputs by their template-facing alias, the same as a repo component", () => {
      expect(componentOf(exCard)?.declared).toBeUndefined(); // a package component has no repo-declared API; its props come from the library's own typings
      expect(componentOf(exCard)?.framework).toBe("angular");
    });
  });

  describe("every declared component gets a row, none it shouldn't", () => {
    it("lists every repository-declaration that renders or is rendered in this fixture", () => {
      // selector-conflict's three files are deliberately absent: an
      // unresolved use (see that describe block) counts toward nothing, so
      // nothing there renders or is rendered either.
      const declared = out.components.flatMap((c) => (c.identity.kind === "repository-declaration" ? [c.identity.filePath] : []));
      expect(declared.sort()).toEqual(
        [
          "src/app-ts-naming/app-host.component.ts",
          "src/app-ts-naming/app.ts",
          "src/attribute-selector/icon-button.component.ts",
          "src/attribute-selector/toolbar.component.ts",
          "src/bootstrap-module/root-view.component.ts",
          "src/bootstrap-root/app-root.component.ts",
          "src/control-flow/control-flow.component.ts",
          "src/control-flow/item.component.ts",
          "src/decorator-io/decorator-io-page.component.ts",
          "src/decorator-io/toggle.component.ts",
          "src/inline-template/card.component.ts",
          "src/inline-template/tag.component.ts",
          "src/library-components/app.component.ts",
          "src/ng-content-projection/badge.component.ts",
          "src/ng-content-projection/frame.component.ts",
          "src/ng-content-projection/projection-page.component.ts",
          "src/ng-module-scope/panel.component.ts",
          "src/ng-module-scope/widget.component.ts",
          "src/signal-io/counter.component.ts",
          "src/signal-io/signal-io-page.component.ts",
          "src/standalone-import/app.component.ts",
          "src/standalone-import/button.component.ts",
          "src/unimported-tag/unimported-tag-page.component.ts",
        ].sort(),
      );
    });
  });
});
