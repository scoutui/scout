import { createRequire } from "node:module";
import { beforeAll, describe, expect, test } from "vitest";
import { MODULE_SCOPE, type FileBuilder, type PropUsage } from "@scoutui/reference-graph";
import { createSelectorIndex, emitAngularTemplate, type AngularCompiler, type SelectorEntry } from "../src/index.js";

const VERSIONS = [19, 20, 21, 22] as const;
const compilers = new Map(VERSIONS.map((v) => [v, createRequire(import.meta.url)(`@angular/compiler-${v}`) as AngularCompiler]));
let compiler: AngularCompiler;

type Recorded =
  | { kind: "jsx"; symbol: string; loc: { line: number; column: number }; props: PropUsage[]; events: string[] }
  | { kind: "tag"; tagName: string; loc: { line: number; column: number }; props: PropUsage[]; events: string[] };

/** Records what the emitter writes; the graph's own behaviour is covered by the CLI's end-to-end tests. */
function recorder() {
  const uses: Recorded[] = [];
  const builder = {
    addJsxUsage: (u: { ref: { symbol: string }; loc: { line: number; column: number }; props: PropUsage[]; events?: string[] }) =>
      uses.push({ kind: "jsx", symbol: u.ref.symbol, loc: u.loc, props: u.props, events: u.events ?? [] }),
    addTagUsage: (u: { tagName: string; loc: { line: number; column: number }; props: PropUsage[]; events?: string[] }) =>
      uses.push({ kind: "tag", tagName: u.tagName, loc: u.loc, props: u.props, events: u.events ?? [] }),
    setOwner: () => {},
    setTagOwner: () => {},
  } as unknown as FileBuilder;
  return { uses, builder };
}

const button: SelectorEntry = { source: { type: "file", graphKey: "src/button.ts" }, exportName: "ButtonComponent", inputs: ["label", "disabled"], outputs: ["pressed"] };
const iconButton: SelectorEntry = { source: { type: "file", graphKey: "src/icon-button.ts" }, exportName: "IconButtonComponent", inputs: ["icon"], outputs: [] };
const card: SelectorEntry = { source: { type: "package", specifier: "@example/ng-ui" }, exportName: "CardComponent" };

function emit(template: string, opts: { origin?: { line: number; column: number }; inScope?: (e: SelectorEntry) => boolean; entries?: { selector: string; entry: SelectorEntry }[]; directives?: string[] } = {}) {
  const { uses, builder } = recorder();
  const ambiguous: string[] = [];
  const errors: string[] = [];
  emitAngularTemplate({
    compiler,
    template,
    templateUrl: "src/app.html",
    origin: opts.origin ?? { line: 1, column: 1 },
    fileBuilder: builder,
    owner: { symbol: "AppComponent", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/app.ts" },
    index: createSelectorIndex(
      compiler,
      opts.entries ?? [
        { selector: "app-button", entry: button },
        { selector: "button[app-icon-button]", entry: iconButton },
        { selector: "ex-card, .ex-card", entry: card },
      ],
      opts.directives ?? [],
    ),
    inScope: opts.inScope ?? (() => true),
    resolveLocal: (entry) => ({ local: entry.exportName }),
    onTemplateError: (m) => errors.push(m),
    onAmbiguous: (tag) => ambiguous.push(tag),
  });
  return { uses, ambiguous, errors };
}

describe.each(VERSIONS)("Angular %i", (version) => {
  beforeAll(() => {
    compiler = compilers.get(version) as AngularCompiler;
  });

describe("emitAngularTemplate: matching elements to components", () => {
  test.each([
    ["an element selector", "<app-button />", "ButtonComponent"],
    ["an attribute selector on its element", "<button app-icon-button></button>", "IconButtonComponent"],
    ["an attribute selector bound as an input", `<button [app-icon-button]="x"></button>`, "IconButtonComponent"],
    ["one of a selector list", "<ex-card></ex-card>", "CardComponent"],
    ["a class selector", `<div class="box ex-card"></div>`, "CardComponent"],
  ])("matches %s", (_, template, exportName) => {
    expect(emit(template).uses.map((u) => (u.kind === "jsx" ? u.symbol : u.tagName))).toEqual([exportName]);
  });

  test.each([
    ["plain HTML", "<div><span>x</span></div>"],
    ["a button without the selector's attribute", "<button></button>"],
    ["Angular's own elements", "<ng-container><ng-template><ng-content /></ng-template></ng-container>"],
  ])("emits nothing for %s", (_, template) => {
    expect(emit(template).uses).toEqual([]);
  });

  test("records no custom element for an element a directive's selector matches", () => {
    expect(emit("<ex-hint>Shown below</ex-hint><span exHint>x</span>", { directives: ["ex-hint, [exHint]"] }).uses).toEqual([]);
  });

  test("records a hyphenated element no component matches as a custom element", () => {
    expect(emit(`<x-widget size="2"></x-widget>`).uses).toEqual([
      { kind: "tag", tagName: "x-widget", loc: { line: 1, column: 1 }, props: [{ name: "size", tier: "written", value: "2" }], events: [] },
    ]);
  });

  test("leaves out components that aren't in the template's scope", () => {
    expect(emit("<app-button />", { inScope: (e) => e !== button }).uses).toEqual([]);
  });

  test("counts one library class several of its package's entry points re-export as one use, from the first entry by name", () => {
    const fromField: SelectorEntry = { source: { type: "package", specifier: "@example/ng-ui/field" }, exportName: "ExField" };
    const fromInput: SelectorEntry = { source: { type: "package", specifier: "@example/ng-ui/input" }, exportName: "ExField" };
    const { uses, ambiguous } = emit("<ex-field></ex-field>", {
      entries: [
        { selector: "ex-field", entry: fromInput },
        { selector: "ex-field", entry: fromField },
      ],
    });
    expect(uses).toHaveLength(1);
    expect(ambiguous).toEqual([]);
  });

  test("keeps two different library classes that share a selector ambiguous", () => {
    const a: SelectorEntry = { source: { type: "package", specifier: "@example/ng-ui/field" }, exportName: "ExField" };
    const b: SelectorEntry = { source: { type: "package", specifier: "@example/ng-ui/input" }, exportName: "ExInputField" };
    const { uses, ambiguous } = emit("<ex-field></ex-field>", { entries: [{ selector: "ex-field", entry: a }, { selector: "ex-field", entry: b }] });
    expect(uses).toEqual([]);
    expect(ambiguous).toEqual(["ex-field"]);
  });

  test("reports an element two components in scope both match, and counts it for neither", () => {
    const other: SelectorEntry = { ...button, source: { type: "file", graphKey: "src/other/button.ts" } };
    const { uses, ambiguous } = emit("<app-button />", { entries: [{ selector: "app-button", entry: button }, { selector: "app-button", entry: other }] });
    expect(uses).toEqual([]);
    expect(ambiguous).toEqual(["app-button"]);
  });
});

describe("emitAngularTemplate: walking the template", () => {
  test.each([
    ["@if / @else", "@if (a) { <app-button /> } @else { <app-button /> }", 2],
    ["@for with @empty", "@for (i of items; track i) { <app-button /> } @empty { <app-button /> }", 2],
    ["@switch", "@switch (k) { @case (1) { <app-button /> } @default { <app-button /> } }", 2],
    ["@defer with @placeholder and @loading", "@defer { <app-button /> } @placeholder { <app-button /> } @loading { <app-button /> }", 3],
    ["*ngIf on the component's element", `<app-button *ngIf="ok"></app-button>`, 1],
    ["projected content", "<ex-card><app-button /></ex-card>", 2],
    ["@let beside a use", `@let label = 'Save'; <app-button [label]="label" />`, 1],
  ])("finds uses inside %s", (_, template, count) => {
    expect(emit(template).uses).toHaveLength(count);
  });

  test("places a use in a template file by its own line and column", () => {
    expect(emit("<div>\n  <app-button />\n</div>").uses[0]?.loc).toEqual({ line: 2, column: 3 });
  });

  test("places a use in an inline template relative to where the template starts in the .ts file", () => {
    const { uses } = emit("<app-button />\n    <app-button />", { origin: { line: 7, column: 15 } });
    expect(uses.map((u) => u.loc)).toEqual([
      { line: 7, column: 15 },
      { line: 8, column: 5 },
    ]);
  });
});

describe("emitAngularTemplate: props and events", () => {
  test("counts only the inputs and outputs the component declares", () => {
    const [use] = emit(`<app-button id="b" class="x" label="Save" [disabled]="busy" (pressed)="go()" (click)="log()" />`).uses;
    expect(use).toMatchObject({
      props: [
        { name: "label", tier: "written", value: "Save" },
        { name: "disabled", tier: "reference", ref: "busy" },
      ],
      events: ["pressed"],
    });
  });

  test("never counts the attribute the component's own selector requires", () => {
    const [use] = emit(`<button app-icon-button icon="close"></button>`).uses;
    expect(use?.props).toEqual([{ name: "icon", tier: "written", value: "close" }]);
  });

  test("counts every binding when the component's API isn't known", () => {
    const [use] = emit(`<ex-card elevation="2" [title]="t" (closed)="x()"></ex-card>`).uses;
    expect(use).toMatchObject({
      props: [
        { name: "elevation", tier: "written", value: "2" },
        { name: "title", tier: "reference", ref: "t" },
      ],
      events: ["closed"],
    });
  });

  test.each([
    [`'Save'`, { tier: "written", value: "Save" }],
    ["3", { tier: "written", value: 3 }],
    ["true", { tier: "written", value: true }],
    ["null", { tier: "written", value: null }],
    ["user.name", { tier: "reference", ref: "user.name" }],
    ["user?.name", { tier: "reference", ref: "user?.name" }],
    ["a + b", { tier: "dynamic" }],
    ["fmt(x)", { tier: "dynamic" }],
  ])("reads [label]=\"%s\"", (expr, expected) => {
    const [use] = emit(`<app-button [label]="${expr}" />`).uses;
    expect(use?.props).toEqual([{ name: "label", ...expected }]);
  });

  test("reads a two-way binding as the input and its change event", () => {
    const model: SelectorEntry = { ...button, inputs: ["value"], outputs: ["valueChange"] };
    const [use] = emit(`<app-button [(value)]="v" />`, { entries: [{ selector: "app-button", entry: model }] }).uses;
    expect(use).toMatchObject({ props: [{ name: "value", tier: "reference", ref: "v" }], events: ["valueChange"] });
  });
});
});
