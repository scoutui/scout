import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import {
  detectAngularComponents,
  detectAngularModules,
  detectAngularBootstrap,
  type AngularComponentDecl,
} from "../../src/local-index/detect-angular.js";

/** Parse a .ts source and run the module detector. */
function detectModules(source: string) {
  const { program } = parseSync("t.ts", source);
  return detectAngularModules(program, source);
}

/** Parse a .ts source and run the bootstrap detector. */
function detectBootstrap(source: string) {
  const { program } = parseSync("t.ts", source);
  return detectAngularBootstrap(program);
}

/** Parse a .ts source and run the detector, same pattern as parse-by-ext.test.ts. */
function detect(source: string): AngularComponentDecl[] {
  const { program } = parseSync("t.ts", source);
  return detectAngularComponents(program, source);
}

/** Wrap one class-body member in a minimal `@Component` class and return its sole decl. */
function detectMember(memberSrc: string): AngularComponentDecl {
  const source = `import { Component, Input, Output, EventEmitter, input, output, model } from "@angular/core";
@Component({ selector: "x" })
export class Foo {
${memberSrc}
}
`;
  const decls = detect(source);
  expect(decls).toHaveLength(1);
  return decls[0] as AngularComponentDecl;
}

describe("detectAngularComponents: inputs", () => {
  const rows: { name: string; member: string; expected: { name: string; alias?: string; required: boolean } }[] = [
    { name: "plain @Input()", member: `@Input() label = "";`, expected: { name: "label", required: false } },
    {
      name: "@Input('alias') string form",
      member: `@Input("aliasName") x = 1;`,
      expected: { name: "x", alias: "aliasName", required: false },
    },
    {
      name: "@Input({required, alias}) object form",
      member: `@Input({ required: true, alias: "y" }) y = 1;`,
      expected: { name: "y", alias: "y", required: true },
    },
    { name: "signal input()", member: `sig = input("");`, expected: { name: "sig", required: false } },
    { name: "signal input.required()", member: "req = input.required<string>();", expected: { name: "req", required: true } },
    {
      name: "aliased signal input",
      member: `aliasedSig = input(0, { alias: "z" });`,
      expected: { name: "aliasedSig", alias: "z", required: false },
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const decl = detectMember(row.member);
      expect(decl.inputs).toHaveLength(1);
      expect(decl.inputs[0]).toEqual(row.expected);
    });
  }

  it("model() produces an input and a `<name>Change` output", () => {
    const decl = detectMember("m = model(false);");
    expect(decl.inputs).toEqual([{ name: "m", required: false }]);
    expect(decl.outputs).toEqual([{ name: "mChange" }]);
  });

  it("@Input() on a setter", () => {
    const decl = detectMember(`#v = "";
@Input() set label(value: string) { this.#v = value; }
get label(): string { return this.#v; }`);
    expect(decl.inputs).toEqual([{ name: "label", required: false }]);
  });

  it("@Input({transform}) with no alias/required still yields a plain, non-required input", () => {
    const decl = detectMember(`@Input({ transform: (v: string) => v.trim() }) label = "";`);
    expect(decl.inputs).toEqual([{ name: "label", required: false }]);
  });

  it("input.required<T>({alias}) combines required with an alias", () => {
    const decl = detectMember(`req = input.required<string>({ alias: "label" });`);
    expect(decl.inputs).toEqual([{ name: "req", alias: "label", required: true }]);
  });

  // Negative: a plain class field with no decorator and no input()/output()/model() call is not an input.
  it("a plain, undecorated field is not an input", () => {
    const decl = detectMember(`label = "";`);
    expect(decl.inputs).toEqual([]);
  });
});

describe("detectAngularComponents: outputs", () => {
  it("@Output()", () => {
    const decl = detectMember("@Output() clicked = new EventEmitter();");
    expect(decl.outputs).toEqual([{ name: "clicked" }]);
  });

  it("signal output()", () => {
    const decl = detectMember("out2 = output();");
    expect(decl.outputs).toEqual([{ name: "out2" }]);
  });
});

describe("detectAngularComponents: @Component options", () => {
  it("standalone defaults to true when absent", () => {
    const decls = detect(`import { Component } from "@angular/core";
@Component({ selector: "x" })
export class Foo {}
`);
    expect(decls[0]?.standalone).toBe(true);
  });

  it("standalone: false is respected", () => {
    const decls = detect(`import { Component } from "@angular/core";
@Component({ selector: "x", standalone: false })
export class Foo {}
`);
    expect(decls[0]?.standalone).toBe(false);
  });

  it("imports: [A, B] collects identifiers", () => {
    const decls = detect(`import { Component } from "@angular/core";
@Component({ selector: "x", imports: [A, B] })
export class Foo {}
`);
    expect(decls[0]?.imports).toEqual(["A", "B"]);
  });

  it("inline template: records source + 1-based position of the first content character", () => {
    const source = `import { Component } from "@angular/core";
@Component({ selector: "x", template: "<div></div>" })
export class Foo {}
`;
    const decls = detect(source);
    const template = decls[0]?.template;
    expect(template?.kind).toBe("inline");
    if (template?.kind !== "inline") throw new Error("type narrow");
    expect(template.source).toBe("<div></div>");
    // template: "<div></div>" is on line 2; column points just past the opening quote.
    expect(template.line).toBe(2);
    const offset = source.indexOf("<div></div>");
    const expectedColumn = offset - source.lastIndexOf("\n", offset);
    expect(template.column).toBe(expectedColumn);
  });

  it("templateUrl: records the literal url, kind 'url'", () => {
    const decls = detect(`import { Component } from "@angular/core";
@Component({ selector: "x", templateUrl: "./foo.component.html" })
export class Foo {}
`);
    expect(decls[0]?.template).toEqual({ kind: "url", url: "./foo.component.html" });
  });
});

describe("detectAngularComponents: non-@Component classes are skipped", () => {
  it("an @Injectable class beside a @Component class yields only the latter", () => {
    const source = `import { Component, Injectable } from "@angular/core";
@Injectable()
export class FooService {}

@Component({ selector: "bar" })
export class BarComponent {}
`;
    const decls = detect(source);
    expect(decls).toHaveLength(1);
    expect(decls[0]?.className).toBe("BarComponent");
  });
});

describe("detectAngularComponents: export shapes", () => {
  it("export default class", () => {
    const decls = detect(`import { Component } from "@angular/core";
@Component({ selector: "x" })
export default class Foo {}
`);
    expect(decls[0]).toMatchObject({ className: "Foo", isExported: true, isDefault: true });
  });

  it("plain class later re-exported via `export { Foo }`", () => {
    const decls = detect(`import { Component } from "@angular/core";
@Component({ selector: "x" })
class Foo {}
export { Foo };
`);
    expect(decls[0]).toMatchObject({ className: "Foo", isExported: true, isDefault: false });
  });

  it("plain class, never exported", () => {
    const decls = detect(`import { Component } from "@angular/core";
@Component({ selector: "x" })
class Foo {}
`);
    expect(decls[0]).toMatchObject({ className: "Foo", isExported: false, isDefault: false });
  });
});

describe("detectAngularModules", () => {
  it("reads declarations, imports, exports and bootstrap as identifier lists", () => {
    const decls = detectModules(`import { NgModule } from "@angular/core";
@NgModule({
  declarations: [FooComponent, BarComponent],
  imports: [CommonModule, SharedModule],
  exports: [FooComponent],
  bootstrap: [FooComponent],
})
export class AppModule {}
`);
    expect(decls).toHaveLength(1);
    expect(decls[0]).toMatchObject({
      className: "AppModule",
      declarations: ["FooComponent", "BarComponent"],
      imports: ["CommonModule", "SharedModule"],
      exports: ["FooComponent"],
      bootstrap: ["FooComponent"],
    });
  });

  it("an @NgModule with no bootstrap array (a feature module) reports an empty bootstrap list", () => {
    const decls = detectModules(`import { NgModule } from "@angular/core";
@NgModule({ declarations: [WidgetComponent], exports: [WidgetComponent] })
export class SharedModule {}
`);
    expect(decls[0]).toMatchObject({ declarations: ["WidgetComponent"], imports: [], exports: ["WidgetComponent"], bootstrap: [] });
  });

  // Negative: a @Component class, decorated the other way, is not an NgModule.
  it("a @Component class is not reported as a module", () => {
    const decls = detectModules(`import { Component } from "@angular/core";
@Component({ selector: "x" })
export class Foo {}
`);
    expect(decls).toEqual([]);
  });

  it("skips spreads and call expressions in module arrays, keeping only identifiers", () => {
    const decls = detectModules(`import { NgModule } from "@angular/core";
const extra = [ExtraModule];
@NgModule({ imports: [CommonModule, ...extra, someFactory()] })
export class AppModule {}
`);
    expect(decls[0]?.imports).toEqual(["CommonModule"]);
  });
});

describe("detectAngularBootstrap", () => {
  it("bootstrapApplication(X, ...) names a root component", () => {
    const refs = detectBootstrap(`import { bootstrapApplication } from "@angular/platform-browser";
bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
`);
    expect(refs).toEqual([{ identifier: "AppComponent", via: "bootstrapApplication" }]);
  });

  it("platformBrowserDynamic().bootstrapModule(X) names a root module, marked for module lookup", () => {
    const refs = detectBootstrap(`import { platformBrowserDynamic } from "@angular/platform-browser-dynamic";
import { AppModule } from "./app.module";
platformBrowserDynamic().bootstrapModule(AppModule);
`);
    expect(refs).toEqual([{ identifier: "AppModule", via: "bootstrapModule" }]);
  });

  // Negative: an unrelated call of the same shape (one identifier argument) isn't a bootstrap call.
  it("an unrelated call with a similar shape is not treated as a bootstrap call", () => {
    const refs = detectBootstrap(`registerLocaleData(AppComponent);
someObject.notBootstrapModule(AppModule);
`);
    expect(refs).toEqual([]);
  });

  it("finds no bootstrap call in a file that doesn't make one", () => {
    const refs = detectBootstrap(`import { Component } from "@angular/core";
@Component({ selector: "x" })
export class Foo {}
`);
    expect(refs).toEqual([]);
  });
});
