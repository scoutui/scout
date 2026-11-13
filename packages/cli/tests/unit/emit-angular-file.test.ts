import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { parseSync } from "oxc-parser";
import type { AngularCompiler, ElementMatch } from "@scoutui/parser-angular";
import { type AngularImport, type AngularRefResolver, type AngularScripts, buildAngularSelectorIndex, buildModuleScopes, chooseLibraryEntry, importsOf, type PendingAngularFile } from "../../src/emit-angular-file.js";
import { detectAngularComponents, detectAngularModules, readConstArrays, readTopLevelNames } from "../../src/local-index/detect-angular.js";

/** A `PendingAngularFile` built from real detector output, same shape scan.ts assembles. */
function pendingFile(graphKey: string, source: string): PendingAngularFile {
  const { program } = parseSync(graphKey, source);
  return {
    graphKey,
    definitionPath: graphKey,
    absPath: `/repo/${graphKey}`,
    components: detectAngularComponents(program, source),
    modules: detectAngularModules(program, source),
    imports: importsOf(program),
  };
}

describe("buildAngularSelectorIndex: onSelectorUnreadable", () => {
  // `@angular/compiler-21`: a devDependency of packages/cli (see
  // tests/integration/angular-app.test.ts), loaded directly since this test
  // doesn't go through a scanned repo's own install. Resolved in beforeAll,
  // not at describe-collection time, so a missing install only fails this
  // describe block's own tests, not the whole file.
  let compiler: AngularCompiler;
  beforeAll(() => {
    compiler = createRequire(import.meta.url)("@angular/compiler-21") as AngularCompiler;
  });

  it("skips a component whose selector CssSelector.parse can't read, reporting it instead of throwing", () => {
    const good = pendingFile(
      "good.component.ts",
      `import { Component } from "@angular/core";
@Component({ selector: "app-good", template: "<div></div>" })
export class GoodComponent {}
`,
    );
    // An attribute selector with an unescaped "$" is one of the few inputs
    // @angular/compiler's CssSelector.parse actually throws on (most
    // malformed strings parse leniently instead).
    const bad = pendingFile(
      "bad.component.ts",
      `import { Component } from "@angular/core";
@Component({ selector: "[a$b]", template: "<div></div>" })
export class BadComponent {}
`,
    );
    const unreadable: { filePath: string; className: string; selector: string; message: string }[] = [];
    const index = buildAngularSelectorIndex(compiler, [good, bad], undefined, (filePath, className, selector, message) => {
      unreadable.push({ filePath, className, selector, message });
    });

    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]).toMatchObject({ filePath: "bad.component.ts", className: "BadComponent", selector: "[a$b]" });
    expect(unreadable[0]?.message.length).toBeGreaterThan(0);

    // The unreadable selector costs only its own component: app-good still matches.
    expect(index.match({ name: "app-good", attributes: [], classNames: [] })).toHaveLength(1);
    expect(index.match({ name: "a", attributes: ["a$b"], classNames: [] })).toHaveLength(0);
  });

  // Negative/positive pair: with no unreadable selector in the batch, nothing is reported.
  it("reports nothing when every selector parses", () => {
    const good = pendingFile(
      "good.component.ts",
      `import { Component } from "@angular/core";
@Component({ selector: "app-good", template: "<div></div>" })
export class GoodComponent {}
`,
    );
    const unreadable: unknown[] = [];
    buildAngularSelectorIndex(compiler, [good], undefined, (...args) => unreadable.push(args));
    expect(unreadable).toEqual([]);
  });
});

describe("buildModuleScopes: file-qualified keys", () => {
  // The bug this reproduces: two apps in a monorepo each declare a component
  // of the same class name (HeaderComponent) in their own NgModule. Keying
  // by class name alone would make `declaringModule` (and the scope sets
  // built from it) unable to tell which app's HeaderComponent is which.
  it("keys declaringModule by file, so two files' same-named classes resolve to their own module", () => {
    const appOneModule = pendingFile(
      "app-one/app.module.ts",
      `import { NgModule } from "@angular/core";
import { HeaderComponent } from "./header.component";
@NgModule({ declarations: [HeaderComponent] })
export class AppOneModule {}
`,
    );
    const appOneHeader = pendingFile(
      "app-one/header.component.ts",
      `import { Component } from "@angular/core";
@Component({ selector: "app-header", standalone: false, template: "<div>One</div>" })
export class HeaderComponent {}
`,
    );
    const appTwoModule = pendingFile(
      "app-two/app.module.ts",
      `import { NgModule } from "@angular/core";
import { HeaderComponent } from "./header.component";
@NgModule({ declarations: [HeaderComponent] })
export class AppTwoModule {}
`,
    );
    const appTwoHeader = pendingFile(
      "app-two/header.component.ts",
      `import { Component } from "@angular/core";
@Component({ selector: "app-header", standalone: false, template: "<div>Two</div>" })
export class HeaderComponent {}
`,
    );

    const scopes = buildModuleScopes([appOneModule, appOneHeader, appTwoModule, appTwoHeader]);

    const one = scopes.declaringModule("app-one/header.component.ts#HeaderComponent");
    const two = scopes.declaringModule("app-two/header.component.ts#HeaderComponent");
    expect(one?.module.className).toBe("AppOneModule");
    expect(one?.file.graphKey).toBe("app-one/app.module.ts");
    expect(two?.module.className).toBe("AppTwoModule");
    expect(two?.file.graphKey).toBe("app-two/app.module.ts");
  });

  // Negative/positive pair: a class name declaringModule has never heard of
  // resolves to nothing, same as before this type existed.
  it("declaringModule returns undefined for a key no module declares", () => {
    const scopes = buildModuleScopes([]);
    expect(scopes.declaringModule("nowhere.component.ts#Nothing")).toBeUndefined();
  });

  it("exportedBy resolves a module's exports to file-qualified keys, following re-exported modules", () => {
    const widget = pendingFile(
      "widget.component.ts",
      `import { Component } from "@angular/core";
@Component({ selector: "app-widget", standalone: false, template: "<div></div>" })
export class WidgetComponent {}
`,
    );
    const widgetModule = pendingFile(
      "widget.module.ts",
      `import { NgModule } from "@angular/core";
import { WidgetComponent } from "./widget.component";
@NgModule({ declarations: [WidgetComponent], exports: [WidgetComponent] })
export class WidgetModule {}
`,
    );
    const sharedModule = pendingFile(
      "shared.module.ts",
      `import { NgModule } from "@angular/core";
import { WidgetModule } from "./widget.module";
@NgModule({ imports: [WidgetModule], exports: [WidgetModule] })
export class SharedModule {}
`,
    );
    const scopes = buildModuleScopes([widget, widgetModule, sharedModule]);
    expect(scopes.exportedBy("shared.module.ts#SharedModule")).toEqual(new Set(["widget.component.ts#WidgetComponent"]));
  });

  // Negative/positive pair: an incomplete `exports` list means `exportedBy`
  // can't be trusted, so it reports null instead of a partial set — same
  // idea as an incomplete `imports` list, one level up through re-export.
  it("exportedBy returns null when a module's own exports list is incomplete", () => {
    const widgetModule = pendingFile(
      "widget.module.ts",
      `import { NgModule } from "@angular/core";
const EXTRA = [SomethingElse];
@NgModule({ exports: [...EXTRA] })
export class WidgetModule {}
`,
    );
    const scopes = buildModuleScopes([widgetModule]);
    expect(scopes.exportedBy("widget.module.ts#WidgetModule")).toBeNull();
  });

  it("exportedBy returns null when a re-exported module's exports are incomplete, propagating up", () => {
    const widgetModule = pendingFile(
      "widget.module.ts",
      `import { NgModule } from "@angular/core";
const EXTRA = [SomethingElse];
@NgModule({ exports: [...EXTRA] })
export class WidgetModule {}
`,
    );
    const sharedModule = pendingFile(
      "shared.module.ts",
      `import { NgModule } from "@angular/core";
import { WidgetModule } from "./widget.module";
@NgModule({ imports: [WidgetModule], exports: [WidgetModule] })
export class SharedModule {}
`,
    );
    const scopes = buildModuleScopes([widgetModule, sharedModule]);
    expect(scopes.exportedBy("shared.module.ts#SharedModule")).toBeNull();
  });

  it("resolveRef passes a bare/package specifier through by name (no library index yet)", () => {
    const page = pendingFile(
      "page.component.ts",
      `import { Component } from "@angular/core";
import { LibButton } from "@example/ui";
@Component({ selector: "app-page", imports: [LibButton], template: "<lib-button></lib-button>" })
export class PageComponent {}
`,
    );
    const scopes = buildModuleScopes([page]);
    expect(scopes.resolveRef(page, "LibButton")).toBe("LibButton");
  });

  it("resolveRef returns undefined for a relative import whose target isn't one of this scan's pending Angular files", () => {
    const page = pendingFile(
      "page.component.ts",
      `import { Component } from "@angular/core";
import { Missing } from "./missing.component";
@Component({ selector: "app-page", imports: [Missing], template: "<div></div>" })
export class PageComponent {}
`,
    );
    const scopes = buildModuleScopes([page]);
    expect(scopes.resolveRef(page, "Missing")).toBeUndefined();
  });
});

describe("buildModuleScopes: packages an imports entry reaches", () => {
  /** What scan.ts keeps for a plain `.ts` file: its imports, const arrays, classes and `export *` sources. */
  const script = (graphKey: string, source: string): [string, AngularScripts extends ReadonlyMap<string, infer V> ? V : never] => {
    const { program } = parseSync(graphKey, source);
    const { classes, stars } = readTopLevelNames(program);
    return [graphKey, { imports: importsOf(program), arrays: readConstArrays(program), classes: new Set(classes), stars }];
  };
  // Relative imports land on `<path>.ts`; anything else is an installed package.
  const resolver: AngularRefResolver = (from, specifier, imported) =>
    specifier.startsWith(".") ? { graphKey: `${specifier.replace(/^\.\//, "")}.ts`, name: imported } : null;

  const page = pendingFile(
    "page.component.ts",
    `import { Component } from "@angular/core";
import { SHARED } from "./shared";
@Component({ selector: "app-page", imports: [...SHARED], template: "" })
export class PageComponent {}
`,
  );
  const scripts: AngularScripts = new Map([
    script(
      "shared.ts",
      `import { ExButtonModule } from "@example/button";
import { ExIconModule } from "@example/icon";
const MORE = [[ExIconModule]] as const;
export const SHARED = [ExButtonModule, ...MORE];
`,
    ),
    script(
      "unused.ts",
      `import { ExOtherModule } from "@example/other";
export const UNUSED = [ExOtherModule];
`,
    ),
  ]);

  it("lists every package a const array reaches, through spreads and nested arrays", () => {
    const scopes = buildModuleScopes([page], resolver, undefined, scripts);
    expect(scopes.resolveImports(page, "SHARED").packages.sort()).toEqual(["@example/button", "@example/icon"]);
  });

  it("lists nothing from an array no imports entry names", () => {
    const scopes = buildModuleScopes([page], resolver, undefined, scripts);
    expect(scopes.resolveImports(page, "SHARED").packages).not.toContain("@example/other");
  });
});

describe("chooseLibraryEntry: one library class exported under two names", () => {
  // `XButtonComponent` is the declared class; the library also exports it as `XButton`.
  const declaredAs = { file: "node_modules/@example/x/index.d.ts", className: "XButtonComponent" };
  const entry = (exportName: string): ElementMatch => ({
    entry: { source: { type: "package", specifier: "@example/x" }, exportName, declaredAs },
    selector: "x-button",
    selectorAttributes: new Set(),
  });
  const group = [entry("XButton"), entry("XButtonComponent")];
  const imp = (imported: string): AngularImport => ({ specifier: "@example/x", imported, local: imported });
  const chosen = (imports: AngularImport[]) => chooseLibraryEntry(group, imports).entry.exportName;

  it("reports the name the file imports, whichever it is", () => {
    expect(chosen([imp("XButton")])).toBe("XButton");
    expect(chosen([imp("XButtonComponent")])).toBe("XButtonComponent");
  });

  it("reports the declared name when the file imports something else from the same package", () => {
    // Both names rank the same here (the file imports from the specifier, but neither name);
    // without the declared-name tiebreak the label sort would pick `XButton`.
    expect(chosen([imp("provideX")])).toBe("XButtonComponent");
  });

  it("reports the declared name when the file imports nothing from the package", () => {
    expect(chosen([])).toBe("XButtonComponent");
  });

  it("doesn't depend on the order the entries come in", () => {
    expect(chooseLibraryEntry([...group].reverse(), [imp("provideX")]).entry.exportName).toBe("XButtonComponent");
  });
});
