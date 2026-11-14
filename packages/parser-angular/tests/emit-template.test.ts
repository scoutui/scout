import { createRequire } from "node:module";
import { beforeAll, describe, expect, test } from "vitest";
import { MODULE_SCOPE, type FileBuilder, type PropUsage } from "@scoutui/reference-graph";
import { createSelectorIndex, emitAngularTemplate, type AngularCompiler, type DirectiveSelector, type SelectorEntry } from "../src/index.js";

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

function emit(
  template: string,
  opts: {
    origin?: { line: number; column: number };
    inScope?: (e: SelectorEntry) => boolean;
    scopeIsPartial?: boolean;
    entries?: { selector: string; entry: SelectorEntry }[];
    directives?: DirectiveSelector[];
  } = {},
) {
  const { uses, builder } = recorder();
  const ambiguous: string[] = [];
  const errors: string[] = [];
  const outOfScope: { tag: string; candidates: string[] }[] = [];
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
    ...(opts.scopeIsPartial !== undefined ? { scopeIsPartial: opts.scopeIsPartial } : {}),
    resolveLocal: (entry) => ({ local: entry.exportName }),
    onTemplateError: (m) => errors.push(m),
    onAmbiguous: (tag) => ambiguous.push(tag),
    onOutOfScope: (tag, _loc, matches) => outOfScope.push({ tag, candidates: matches.map((m) => m.entry.exportName) }),
  });
  return { uses, ambiguous, errors, outOfScope };
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

  describe("a selector that requires an attribute's value", () => {
    const submit: SelectorEntry = { source: { type: "file", graphKey: "src/submit.ts" }, exportName: "SubmitButtonComponent", inputs: [], outputs: [] };
    const entries = [{ selector: "button[type=submit]", entry: submit }];
    const symbols = (template: string, opts: Parameters<typeof emit>[1] = { entries }) =>
      emit(template, opts).uses.map((u) => (u.kind === "jsx" ? u.symbol : u.tagName));

    test("matches an element written with that value", () => {
      expect(symbols(`<button type="submit"></button>`)).toEqual(["SubmitButtonComponent"]);
    });

    test("doesn't match another value, a bound attribute, or no value", () => {
      expect(symbols(`<button type="reset"></button>`)).toEqual([]);
      expect(symbols(`<button [type]="t"></button>`)).toEqual([]);
      expect(symbols("<button type></button>")).toEqual([]);
    });

    test("leaves out the element a :not() with a value excludes, as Angular does", () => {
      const text = { source: { type: "file" as const, graphKey: "src/text.ts" }, exportName: "TextAccessor", inputs: [], outputs: [] };
      const check = { source: { type: "file" as const, graphKey: "src/check.ts" }, exportName: "CheckboxAccessor", inputs: [], outputs: [] };
      const directives: DirectiveSelector[] = [
        { selector: "input:not([type=checkbox])[appModel]", entry: text },
        { selector: "input[type=checkbox][appModel]", entry: check },
      ];
      expect(symbols(`<input type="checkbox" appModel />`, { directives })).toEqual(["CheckboxAccessor"]);
      expect(symbols(`<input type="text" appModel />`, { directives })).toEqual(["TextAccessor"]);
    });
  });

  test("keeps an unknown element as a tag use when only an attribute-only directive matches it", () => {
    const { uses } = emit('<ex-item exLink="/x">Go</ex-item>', { directives: ["[exLink]"] });
    expect(uses.map((u) => (u.kind === "tag" ? u.tagName : u.symbol))).toEqual(["ex-item"]);
  });

  test("an element-part directive selector with attributes still claims its tag", () => {
    expect(emit('<ex-item exLink="/x">Go</ex-item>', { directives: ["ex-item[exLink]"] }).uses).toEqual([]);
  });

  test("records no custom element for an element a directive's selector matches", () => {
    expect(emit("<ex-hint>Shown below</ex-hint><span exHint>x</span>", { directives: ["ex-hint, [exHint]"] }).uses).toEqual([]);
  });

  test("records a hyphenated element no component matches as a custom element", () => {
    expect(emit(`<x-widget size="2"></x-widget>`).uses).toEqual([
      { kind: "tag", tagName: "x-widget", loc: { line: 1, column: 1 }, props: [{ name: "size", tier: "written", value: "2" }], events: [] },
    ]);
  });

  test("leaves out components that aren't in the template's scope, and reports it as out of scope", () => {
    const { uses, outOfScope } = emit("<app-button />", { inScope: (e) => e !== button });
    expect(uses).toEqual([]);
    expect(outOfScope).toEqual([{ tag: "app-button", candidates: ["ButtonComponent"] }]);
  });

  // Positive/negative pair for onOutOfScope: a selector no component in the
  // repo matches at all is a different case (recorded as a custom element or
  // silently, never "out of scope") from one whose only matches are filtered
  // by inScope.
  test("does not report a selector nothing matches as out of scope", () => {
    expect(emit("<x-widget></x-widget>").outOfScope).toEqual([]);
  });

  test("does not report a selector matched in scope as out of scope", () => {
    expect(emit("<app-button />").outOfScope).toEqual([]);
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

  test("counts one library class exported under two names as one use, under the name it is declared as", () => {
    const declaredAs = { file: "/lib/index.d.ts", className: "ExIcon" };
    const alias: SelectorEntry = { source: { type: "package", specifier: "@example/ng-icons" }, exportName: "ExIconComponent", declaredAs };
    const declared: SelectorEntry = { source: { type: "package", specifier: "@example/ng-icons" }, exportName: "ExIcon", declaredAs };
    const { uses, ambiguous } = emit("<ex-icon></ex-icon>", {
      entries: [
        { selector: "ex-icon", entry: alias },
        { selector: "ex-icon", entry: declared },
      ],
    });
    expect(ambiguous).toEqual([]);
    expect(uses.map((u) => u.kind === "jsx" && u.symbol)).toEqual(["ExIcon"]);
  });

  test("keeps two different library classes that share a selector ambiguous", () => {
    const a: SelectorEntry = { source: { type: "package", specifier: "@example/ng-ui/field" }, exportName: "ExField" };
    const b: SelectorEntry = { source: { type: "package", specifier: "@example/ng-ui/input" }, exportName: "ExInputField" };
    const { uses, ambiguous } = emit("<ex-field></ex-field>", { entries: [{ selector: "ex-field", entry: a }, { selector: "ex-field", entry: b }] });
    expect(uses).toEqual([]);
    expect(ambiguous).toEqual(["ex-field"]);
  });

  test("keeps two classes with different declarations ambiguous even when they are exported under one package", () => {
    const a: SelectorEntry = { source: { type: "package", specifier: "@example/ng-icons" }, exportName: "ExIconA", declaredAs: { file: "/lib/a.d.ts", className: "ExIconA" } };
    const b: SelectorEntry = { source: { type: "package", specifier: "@example/ng-icons" }, exportName: "ExIconB", declaredAs: { file: "/lib/b.d.ts", className: "ExIconB" } };
    const { uses, ambiguous } = emit("<ex-icon></ex-icon>", { entries: [{ selector: "ex-icon", entry: a }, { selector: "ex-icon", entry: b }] });
    expect(uses).toEqual([]);
    expect(ambiguous).toEqual(["ex-icon"]);
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

describe("emitAngularTemplate: directives", () => {
  const dir = (exportName: string, inputs: string[] = [], outputs: string[] = []): SelectorEntry => ({
    source: { type: "file", graphKey: `src/${exportName}.ts` },
    exportName,
    inputs,
    outputs,
  });
  const tip = dir("TipDirective", ["appTip", "tipPosition"]);
  const track = dir("TrackDirective", [], ["tracked"]);
  const form = dir("FormDirective");
  const names = (uses: { kind: string; symbol?: string; tagName?: string }[]) => uses.map((u) => (u.kind === "jsx" ? u.symbol : `tag:${u.tagName}`));

  test("counts every directive on an element as its own use, after the element's component", () => {
    const { uses } = emit(`<app-button appTip="Save" appTrack (tracked)="log()" />`, {
      directives: [
        { selector: "[appTip]", entry: tip },
        { selector: "[appTrack]", entry: track },
      ],
    });
    expect(names(uses)).toEqual(["ButtonComponent", "TipDirective", "TrackDirective"]);
    expect(uses[1]).toMatchObject({ props: [{ name: "appTip", tier: "written", value: "Save" }] });
    expect(uses[2]).toMatchObject({ props: [], events: ["tracked"] });
  });

  test("keeps a directive's selector attribute as a prop only when it's an input with a value", () => {
    const directives: DirectiveSelector[] = [{ selector: "[appTip]", entry: tip }];
    expect(emit(`<span [appTip]="text"></span>`, { directives }).uses[0]).toMatchObject({ props: [{ name: "appTip", tier: "reference", ref: "text" }] });
    expect(emit("<span appTip></span>", { directives }).uses[0]).toMatchObject({ props: [] });
  });

  test("leaves out a match that rests only on a plain HTML tag, but counts the same directive when its attribute is written", () => {
    const directives: DirectiveSelector[] = [{ selector: "form:not([appNoForm]),[appForm]", entry: form }];
    expect(names(emit("<form></form>", { directives }).uses)).toEqual([]);
    expect(names(emit("<form appForm></form>", { directives }).uses)).toEqual(["FormDirective"]);
  });

  test("counts an element directive, and no custom element for it", () => {
    const field = dir("FieldDirective", ["label"]);
    expect(names(emit(`<app-field label="Name"></app-field>`, { directives: [{ selector: "app-field", entry: field }] }).uses)).toEqual(["FieldDirective"]);
  });

  test("counts no structural directive written with *", () => {
    const appIf = dir("IfDirective", ["appIf"]);
    expect(names(emit(`<p *appIf="show">x</p>`, { directives: [{ selector: "[appIf]", entry: appIf }] }).uses)).toEqual([]);
  });

  test("still only claims the element for a directive given as a bare selector", () => {
    expect(names(emit(`<span exLink="/x"></span><ex-hint></ex-hint>`, { directives: ["[exLink]", "ex-hint"] }).uses)).toEqual([]);
  });

  test("counts only in-scope directives when the scope is known", () => {
    const { uses } = emit("<span appTip appTrack></span>", {
      directives: [
        { selector: "[appTip]", entry: tip },
        { selector: "[appTrack]", entry: track },
      ],
      inScope: (e) => e === tip,
    });
    expect(names(uses)).toEqual(["TipDirective"]);
  });

  describe("a name the element writes belongs to the classes that take it as an input, else the component, else every directive that matched through it", () => {
    const model = dir("NgModel", ["ngModel"], ["ngModelChange"]);
    const status = dir("NgControlStatus");
    const row = dir("RowDirective", ["gutter"]);

    test("counts the directive that takes the name, and not one that only rides along on it", () => {
      const { uses } = emit(`<input [(ngModel)]="v" />`, {
        directives: [
          { selector: "[ngModel]", entry: model },
          { selector: "[ngModel],[formControlName]", entry: status },
        ],
      });
      expect(names(uses)).toEqual(["NgModel"]);
    });

    test("gives a tag a component matched through to the component, unless the element binds the directive's own input", () => {
      const formItem: SelectorEntry = { source: { type: "file", graphKey: "src/form-item.ts" }, exportName: "FormItemComponent", inputs: [], outputs: [] };
      const opts = { entries: [{ selector: "app-form-item", entry: formItem }], directives: [{ selector: "[app-row],app-form-item", entry: row }] };
      expect(names(emit("<app-form-item></app-form-item>", opts).uses)).toEqual(["FormItemComponent"]);
      expect(names(emit(`<app-form-item gutter="8"></app-form-item>`, opts).uses)).toEqual(["FormItemComponent", "RowDirective"]);
      expect(names(emit("<div app-row></div>", opts).uses)).toEqual(["RowDirective"]);
    });

    test("drops a helper matched through the component's own attribute", () => {
      const wave = dir("WaveDirective", ["waveExtra"]);
      const { uses } = emit("<button app-button></button>", {
        entries: [{ selector: "button[app-button]", entry: button }],
        directives: [{ selector: "[app-wave],button[app-button]", entry: wave }],
      });
      expect(names(uses)).toEqual(["ButtonComponent"]);
    });

    test("counts every directive that matched through a name no class takes", () => {
      const one = dir("MarkOneDirective");
      const two = dir("MarkTwoDirective");
      const { uses } = emit("<span appMark></span>", {
        directives: [
          { selector: "[appMark]", entry: one },
          { selector: "[appMark]", entry: two },
        ],
      });
      expect(names(uses)).toEqual(["MarkOneDirective", "MarkTwoDirective"]);
    });

    test("counts a directive whose inputs aren't known", () => {
      const unknown: SelectorEntry = { source: { type: "package", specifier: "@example/ng-ui" }, exportName: "ExStatus" };
      const { uses } = emit(`<input [ngModel]="v" />`, {
        directives: [
          { selector: "[ngModel]", entry: model },
          { selector: "[ngModel]", entry: unknown },
        ],
      });
      expect(names(uses)).toEqual(["NgModel", "ExStatus"]);
    });
  });

  test("with a partly read scope, counts neither of two different directives that answer to the same selector", () => {
    const one = dir("MarkOneDirective");
    const two = dir("MarkTwoDirective");
    const { uses, ambiguous } = emit("<span appMark appTip></span>", {
      directives: [
        { selector: "[appMark]", entry: one },
        { selector: "[appMark]", entry: two },
        { selector: "[appTip]", entry: tip },
      ],
      inScope: () => false,
      scopeIsPartial: true,
    });
    expect(names(uses)).toEqual(["TipDirective"]);
    expect(ambiguous).toEqual(["span"]);
  });
});

describe("emitAngularTemplate: a component's selector attribute that is also an input", () => {
  test("is the input's value when it carries one, and left out when it's only the marker", () => {
    const chip: SelectorEntry = { source: { type: "file", graphKey: "src/chip.ts" }, exportName: "ChipComponent", inputs: ["appChip"], outputs: [] };
    const entries = [{ selector: "span[appChip]", entry: chip }];
    expect(emit(`<span appChip="New"></span>`, { entries }).uses[0]).toMatchObject({ props: [{ name: "appChip", tier: "written", value: "New" }] });
    expect(emit("<span appChip></span>", { entries }).uses[0]).toMatchObject({ props: [] });
  });
});
});
