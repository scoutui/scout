import type {
  Program,
  Node,
  Class as OxcClass,
  ClassElement,
  Decorator,
  Expression,
  ObjectExpression,
  CallExpression,
} from "@oxc-project/types";
import { walk } from "oxc-walker";
import { positionAt } from "@scoutui/parser-react";
import { readLiteralValue } from "./declared-props.js";

// ---------------------------------------------------------------------------
// Public types (spike-exact: see spike/angular-lowering handoff)
// ---------------------------------------------------------------------------

export type AngularTemplateRef =
  | {
      kind: "inline";
      source: string;
      /** 1-based position of the first template character in the .ts file */
      line: number;
      column: number;
    }
  | { kind: "url"; /** the literal templateUrl as written */ url: string };

export type AngularInput = { name: string; alias?: string; required: boolean };
export type AngularOutput = { name: string; alias?: string };

export type AngularComponentDecl = {
  /** A `@Directive` renders nothing of its own and has no template; it's counted wherever its selector is written, like a component. */
  kind: "component" | "directive";
  className: string;
  isExported: boolean;
  isDefault: boolean;
  selector: string | undefined;
  /** @Component standalone flag; DEFAULT true when absent (Angular 19+). */
  standalone: boolean;
  /** identifiers listed in @Component({imports: [A, B]}) (identifiers only; skips spreads/calls). */
  imports: string[];
  /**
   * False when `imports` wasn't a plain array of identifiers end to end: a
   * spread (`...SHARED`), a call, a hole, or the whole property not being an
   * array literal (`imports: SOME_CONST`). A template-scope lookup treats
   * `false` the same way it treats an empty list — it can't trust `imports`
   * to name everything the template can use, so it falls back to global scope
   * rather than silently dropping whatever it couldn't read.
   */
  importsComplete: boolean;
  template: AngularTemplateRef | undefined;
  inputs: AngularInput[];
  outputs: AngularOutput[];
  /** 1-based class position. */
  loc: { line: number; column: number };
};

/**
 * Detect Angular `@Component` classes in an oxc `Program`.
 *
 * Mirrors detect-vue.ts's style: walk `program.body` directly (Angular
 * components in this spike are always top-level: `export class`, `export
 * default class`, or a plain class later re-exported with `export { Foo }`).
 * Only classes decorated with a `Component(...)` call (bare identifier or
 * `x.Component` member — not required to come from @angular/core) are
 * returned; `@Directive`/`@Pipe`/`@NgModule` classes are skipped because
 * they never match that decorator name.
 */
export function detectAngularComponents(program: Program, source: string): AngularComponentDecl[] {
  const out: AngularComponentDecl[] = [];
  for (const site of collectClassSites(program)) {
    const decl = toAngularComponentDecl(site, source);
    if (decl) out.push(decl);
  }
  return out;
}

/**
 * Detect `@Directive({ selector: "..." })` classes, same top-level shapes as
 * `detectAngularComponents`, as the same record with `kind: "directive"` and
 * no template: a directive is a component without one, as Angular has it. A
 * directive whose selector isn't a string literal, or that has none (a base
 * class, or one only used as a host directive), is left out: nothing in a
 * template can name it.
 */
export function detectAngularDirectives(program: Program, source: string): AngularComponentDecl[] {
  const out: AngularComponentDecl[] = [];
  for (const site of collectClassSites(program)) {
    const { node } = site;
    const call = findDecoratorCall(node.decorators, "Directive");
    if (!call) continue;
    const options = readComponentOptions(firstObjectArg(call), source);
    if (options.selector === undefined) continue;
    const { inputs, outputs } = readMembers(node);
    const pos = positionAt(source, node.start);
    out.push({
      kind: "directive",
      className: node.id?.name ?? "",
      isExported: site.isExported,
      isDefault: site.isDefault,
      selector: options.selector,
      standalone: options.standalone,
      imports: [],
      importsComplete: true,
      template: undefined,
      inputs,
      outputs,
      loc: { line: pos.line, column: pos.column },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// @NgModule({...}) classes
// ---------------------------------------------------------------------------

export type AngularModuleDecl = {
  className: string;
  /** Identifiers in `declarations: [...]` (identifiers only; skips spreads/calls). */
  declarations: string[];
  /** False under the same conditions as `AngularComponentDecl.importsComplete`, for `declarations`. */
  declarationsComplete: boolean;
  /** Identifiers in `imports: [...]`. */
  imports: string[];
  /** False under the same conditions as `AngularComponentDecl.importsComplete`, for `imports`. */
  importsComplete: boolean;
  /** Identifiers in `exports: [...]`. */
  exports: string[];
  /** False under the same conditions as `AngularComponentDecl.importsComplete`, for `exports`. */
  exportsComplete: boolean;
  /** Identifiers in `bootstrap: [...]`. */
  bootstrap: string[];
  /** 1-based class position. */
  loc: { line: number; column: number };
};

/**
 * Detect `@NgModule({...})` classes, same top-level shapes as
 * `detectAngularComponents` (export/default/re-export). A class decorated
 * with both `@Component` and `@NgModule` would appear in both detectors'
 * output; Angular itself doesn't allow that, so this isn't guarded against.
 */
export function detectAngularModules(program: Program, source: string): AngularModuleDecl[] {
  const out: AngularModuleDecl[] = [];
  for (const site of collectClassSites(program)) {
    const call = findDecoratorCall(site.node.decorators, "NgModule");
    if (!call) continue;
    const options = readNgModuleOptions(firstObjectArg(call));
    const pos = positionAt(source, site.node.start);
    out.push({
      className: site.node.id?.name ?? "",
      ...options,
      loc: { line: pos.line, column: pos.column },
    });
  }
  return out;
}

type NgModuleOptions = {
  declarations: string[];
  declarationsComplete: boolean;
  imports: string[];
  importsComplete: boolean;
  exports: string[];
  exportsComplete: boolean;
  bootstrap: string[];
};

/**
 * Reads an array-literal list of plain identifiers, same rule for every
 * `@Component`/`@NgModule` option this file reads as an identifier list:
 * `complete` is false when the value isn't an array literal at all, or any
 * element is a spread, a call, a hole, or anything else that isn't a plain
 * identifier — the list it returns only ever holds what it could read.
 *
 * With `allowReferences` (the `imports` option), `...NAME` elements and a bare
 * `NAME` value count as names too: each may stand for a `const` array of
 * imports, which the scope reading expands.
 */
function readIdentifierList(value: Expression, allowReferences = false): { names: string[]; complete: boolean } {
  if (allowReferences && value.type === "Identifier") return { names: [value.name], complete: true };
  if (value.type !== "ArrayExpression") return { names: [], complete: false };
  const names: string[] = [];
  let complete = true;
  for (const el of value.elements) {
    if (el && el.type === "Identifier") names.push(el.name);
    else if (allowReferences && el && el.type === "SpreadElement" && el.argument.type === "Identifier") names.push(el.argument.name);
    else complete = false;
  }
  return { names, complete };
}

/** A top-level `const NAME = [...]` list: the identifiers it holds, nested arrays and spreads flattened. */
export type AngularConstArray = { members: string[]; complete: boolean };

/**
 * The names of a program's top-level classes (decorated or not, exported or
 * not), and the sources of its `export * from` lines: where a name an import
 * lands on is declared, or which files to look in when that file only re-exports.
 */
export function readTopLevelNames(program: Program): { classes: string[]; stars: string[] } {
  const classes: string[] = [];
  const stars: string[] = [];
  for (const stmt of program.body) {
    if (stmt.type === "ClassDeclaration" && stmt.id) classes.push(stmt.id.name);
    else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "ClassDeclaration" && stmt.declaration.id) classes.push(stmt.declaration.id.name);
    else if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration.type === "ClassDeclaration" && stmt.declaration.id) classes.push(stmt.declaration.id.name);
    else if (stmt.type === "ExportAllDeclaration" && stmt.exported === null) stars.push(stmt.source.value);
  }
  return { classes, stars };
}

/**
 * The top-level `const` arrays of identifiers in a program, by name, such as
 * `export const ExampleButtonImports = [ExampleButton] as const`. A component's
 * `imports` lists such a name to bring in everything the array holds. An array
 * with any element that isn't an identifier, a spread of one, or a nested
 * array of those (a call, a member access, a hole) is `complete: false`: its
 * `members` only hold what could be read.
 */
export function readConstArrays(program: Program): Map<string, AngularConstArray> {
  const out = new Map<string, AngularConstArray>();
  const flatten = (expr: Expression, acc: AngularConstArray): void => {
    switch (expr.type) {
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "ParenthesizedExpression":
        flatten(expr.expression, acc);
        return;
      case "ArrayExpression":
        for (const el of expr.elements) {
          if (el === null) acc.complete = false;
          else if (el.type === "SpreadElement") flatten(el.argument, acc);
          else flatten(el, acc);
        }
        return;
      case "Identifier":
        acc.members.push(expr.name);
        return;
      default:
        acc.complete = false;
    }
  };
  const read = (decl: { kind: string; declarations: { id: { type: string; name?: string }; init?: Expression | null }[] }): void => {
    if (decl.kind !== "const") return;
    for (const d of decl.declarations) {
      if (d.id.type !== "Identifier" || d.id.name === undefined || d.init === null || d.init === undefined) continue;
      let init: Expression = d.init;
      while (init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression" || init.type === "ParenthesizedExpression") init = init.expression;
      if (init.type !== "ArrayExpression") continue;
      const acc: AngularConstArray = { members: [], complete: true };
      flatten(init, acc);
      out.set(d.id.name, acc);
    }
  };
  for (const stmt of program.body) {
    if (stmt.type === "VariableDeclaration") read(stmt);
    else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "VariableDeclaration") read(stmt.declaration);
  }
  return out;
}

function readNgModuleOptions(obj: ObjectExpression | undefined): NgModuleOptions {
  const options: NgModuleOptions = {
    declarations: [],
    declarationsComplete: true,
    imports: [],
    importsComplete: true,
    exports: [],
    exportsComplete: true,
    bootstrap: [],
  };
  if (!obj) return options;
  for (const p of obj.properties) {
    if (p.type !== "Property" || p.key.type !== "Identifier") continue;
    const name = p.key.name;
    if (name === "bootstrap") {
      if (p.value.type === "ArrayExpression") {
        for (const el of p.value.elements) if (el && el.type === "Identifier") options.bootstrap.push(el.name);
      }
      continue;
    }
    if (name !== "declarations" && name !== "imports" && name !== "exports") continue;
    const { names, complete } = readIdentifierList(p.value, name === "imports");
    if (name === "declarations") {
      options.declarations = names;
      options.declarationsComplete = complete;
    } else if (name === "imports") {
      options.imports = names;
      options.importsComplete = complete;
    } else {
      options.exports = names;
      options.exportsComplete = complete;
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// App-root bootstrap
// ---------------------------------------------------------------------------

/**
 * One identifier bootstrapped at the app's root. `bootstrapApplication(X,
 * ...)` names a root component directly (`via: "bootstrapApplication"`).
 * `anything.bootstrapModule(X)` (e.g. `platformBrowserDynamic().bootstrapModule(X)`)
 * names a root *module*: the caller resolves that module's own `bootstrap:
 * [...]` array (from `detectAngularModules`) to find the actual root
 * component(s) — `via: "bootstrapModule"` marks that it needs this step.
 */
export type AngularBootstrapRef = { identifier: string; via: "bootstrapApplication" | "bootstrapModule" };

/**
 * Detect root-bootstrap calls anywhere in the program (not just top-level
 * statements, since `bootstrapApplication(...).catch(...)` and similar
 * chains are common). Generic by design: matches any call named
 * `bootstrapApplication` or any `.bootstrapModule(...)` member call,
 * regardless of where the callee comes from, but nothing else.
 */
export function detectAngularBootstrap(program: Program): AngularBootstrapRef[] {
  const out: AngularBootstrapRef[] = [];
  walk(program, {
    enter(node: Node) {
      if (node.type !== "CallExpression") return;
      const arg0 = node.arguments[0];
      const identifier = arg0 && arg0.type === "Identifier" ? arg0.name : undefined;
      if (identifier === undefined) return;
      if (calleeNamed(node.callee, "bootstrapApplication")) {
        out.push({ identifier, via: "bootstrapApplication" });
        return;
      }
      if (
        node.callee.type === "MemberExpression" &&
        !node.callee.computed &&
        node.callee.property.type === "Identifier" &&
        node.callee.property.name === "bootstrapModule"
      ) {
        out.push({ identifier, via: "bootstrapModule" });
      }
    },
  });
  return out;
}

// ---------------------------------------------------------------------------
// Top-level export-shape resolution
// ---------------------------------------------------------------------------

type ClassSite = { node: OxcClass; isExported: boolean; isDefault: boolean };

function collectClassSites(program: Program): ClassSite[] {
  const sites: ClassSite[] = [];
  const reExportedNames = new Set<string>();

  for (const stmt of program.body) {
    if (stmt.type === "ClassDeclaration") {
      sites.push({ node: stmt, isExported: false, isDefault: false });
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (decl.type === "ClassDeclaration" || decl.type === "ClassExpression") {
        sites.push({ node: decl, isExported: true, isDefault: true });
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration && stmt.declaration.type === "ClassDeclaration") {
        sites.push({ node: stmt.declaration, isExported: true, isDefault: false });
        continue;
      }
      // `export { Foo }` / `export { Foo as Bar }`: re-exports a class
      // declared elsewhere in this file as a plain `class Foo {}`.
      if (!stmt.declaration) {
        for (const spec of stmt.specifiers) {
          if (spec.local.type === "Identifier") reExportedNames.add(spec.local.name);
        }
      }
    }
  }

  for (const site of sites) {
    if (!site.isExported && site.node.id && reExportedNames.has(site.node.id.name)) {
      site.isExported = true;
    }
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Class -> AngularComponentDecl
// ---------------------------------------------------------------------------

function toAngularComponentDecl(site: ClassSite, source: string): AngularComponentDecl | undefined {
  const { node } = site;
  const componentCall = findDecoratorCall(node.decorators, "Component");
  if (!componentCall) return undefined;

  const options = readComponentOptions(firstObjectArg(componentCall), source);
  const { inputs, outputs } = readMembers(node);
  const pos = positionAt(source, node.start);

  return {
    kind: "component",
    className: node.id?.name ?? "",
    isExported: site.isExported,
    isDefault: site.isDefault,
    selector: options.selector,
    standalone: options.standalone,
    imports: options.imports,
    importsComplete: options.importsComplete,
    template: options.template,
    inputs,
    outputs,
    loc: { line: pos.line, column: pos.column },
  };
}

// ---------------------------------------------------------------------------
// @Component({...}) option reading
// ---------------------------------------------------------------------------

type ComponentOptions = {
  selector: string | undefined;
  standalone: boolean;
  imports: string[];
  importsComplete: boolean;
  template: AngularTemplateRef | undefined;
};

function readComponentOptions(obj: ObjectExpression | undefined, source: string): ComponentOptions {
  let selector: string | undefined;
  let standalone = true; // DEFAULT true when absent (Angular 19+)
  let imports: string[] = [];
  let importsComplete = true;
  let template: AngularTemplateRef | undefined;

  if (obj) {
    for (const p of obj.properties) {
      if (p.type !== "Property" || p.key.type !== "Identifier") continue;
      const name = p.key.name;
      if (name === "selector") {
        const v = readLiteralValue(p.value);
        if (typeof v === "string") selector = v;
      } else if (name === "standalone") {
        const v = readLiteralValue(p.value);
        if (typeof v === "boolean") standalone = v;
      } else if (name === "imports") {
        const result = readIdentifierList(p.value, true);
        imports = result.names;
        importsComplete = result.complete;
      } else if (name === "template") {
        const inlineSource = inlineTemplateSource(p.value);
        if (inlineSource !== undefined) {
          const pos = positionAt(source, p.value.start + 1);
          template = { kind: "inline", source: inlineSource, line: pos.line, column: pos.column };
        }
      } else if (name === "templateUrl") {
        const v = readLiteralValue(p.value);
        if (typeof v === "string") template = { kind: "url", url: v };
      }
    }
  }

  return { selector, standalone, imports, importsComplete, template };
}

/**
 * A plain string literal or a no-substitution template literal's content.
 * Both node kinds start at their opening quote/backtick, so the first
 * content character is always at `node.start + 1`.
 */
function inlineTemplateSource(node: Expression): string | undefined {
  if (node.type === "Literal") {
    const v = readLiteralValue(node);
    return typeof v === "string" ? v : undefined;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    const quasi = node.quasis[0];
    return quasi ? quasi.value.cooked ?? quasi.value.raw : "";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

function readMembers(node: OxcClass): { inputs: AngularInput[]; outputs: AngularOutput[] } {
  const inputs: AngularInput[] = [];
  const outputs: AngularOutput[] = [];

  for (const member of node.body.body) {
    const keyName = memberKeyName(member);
    if (keyName === undefined) continue;

    const inputDecorator = findDecoratorCall(memberDecorators(member), "Input");
    if (inputDecorator) {
      inputs.push(angularInputFromDecorator(keyName, inputDecorator));
      continue;
    }
    const outputDecorator = findDecoratorCall(memberDecorators(member), "Output");
    if (outputDecorator) {
      outputs.push(angularOutputFromDecorator(keyName, outputDecorator));
      continue;
    }

    if (member.type === "PropertyDefinition" && member.value && member.value.type === "CallExpression") {
      const signal = signalCallInfo(member.value);
      if (!signal) continue;
      const alias = aliasFromArgs(member.value.arguments);
      if (signal.kind === "output") {
        outputs.push({ name: keyName, ...(alias !== undefined ? { alias } : {}) });
        continue;
      }
      // "input" or "model"
      inputs.push({ name: keyName, required: signal.required, ...(alias !== undefined ? { alias } : {}) });
      if (signal.kind === "model") {
        // `model()` also produces an output named `<name>Change`.
        const changeAlias = alias !== undefined ? `${alias}Change` : undefined;
        outputs.push({ name: `${keyName}Change`, ...(changeAlias !== undefined ? { alias: changeAlias } : {}) });
      }
    }
  }

  return { inputs, outputs };
}

function memberDecorators(member: ClassElement): Decorator[] {
  return member.type === "PropertyDefinition" || member.type === "MethodDefinition" || member.type === "AccessorProperty"
    ? member.decorators
    : [];
}

function memberKeyName(member: ClassElement): string | undefined {
  if (member.type !== "PropertyDefinition" && member.type !== "MethodDefinition" && member.type !== "AccessorProperty") {
    return undefined;
  }
  if (member.computed) return undefined;
  if (member.key.type === "Identifier") return member.key.name;
  const lit = readLiteralValue(member.key);
  return typeof lit === "string" ? lit : undefined;
}

function angularInputFromDecorator(keyName: string, call: CallExpression): AngularInput {
  const { alias, required } = decoratorArgOptions(call);
  return { name: keyName, required: required ?? false, ...(alias !== undefined ? { alias } : {}) };
}

function angularOutputFromDecorator(keyName: string, call: CallExpression): AngularOutput {
  const { alias } = decoratorArgOptions(call);
  return { name: keyName, ...(alias !== undefined ? { alias } : {}) };
}

/** Reads `@Input()` / `@Input('alias')` / `@Input({required, alias})` (and the `@Output` equivalents) first-argument shapes. */
function decoratorArgOptions(call: CallExpression): { alias: string | undefined; required: boolean | undefined } {
  const arg0 = call.arguments[0];
  if (!arg0) return { alias: undefined, required: undefined };
  if (arg0.type === "Literal") {
    const v = readLiteralValue(arg0);
    return { alias: typeof v === "string" ? v : undefined, required: undefined };
  }
  if (arg0.type === "ObjectExpression") {
    let alias: string | undefined;
    let required: boolean | undefined;
    for (const p of arg0.properties) {
      if (p.type !== "Property" || p.key.type !== "Identifier") continue;
      if (p.key.name === "alias") {
        const v = readLiteralValue(p.value);
        if (typeof v === "string") alias = v;
      } else if (p.key.name === "required") {
        const v = readLiteralValue(p.value);
        if (typeof v === "boolean") required = v;
      }
    }
    return { alias, required };
  }
  return { alias: undefined, required: undefined };
}

type SignalCallKind = "input" | "output" | "model";

/** Classifies `input()`, `input.required()`, `output()`, `model()`, `model.required()` call expressions. */
function signalCallInfo(call: CallExpression): { kind: SignalCallKind; required: boolean } | undefined {
  const callee = call.callee;
  if (callee.type === "Identifier") {
    if (callee.name === "input" || callee.name === "output" || callee.name === "model") {
      return { kind: callee.name, required: false };
    }
    return undefined;
  }
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === "required") {
    const obj = callee.object;
    if (obj.type === "Identifier" && (obj.name === "input" || obj.name === "model")) {
      return { kind: obj.name, required: true };
    }
  }
  return undefined;
}

/** Scans call arguments for an `{ alias: '...' }` options object, at any position. */
function aliasFromArgs(args: CallExpression["arguments"]): string | undefined {
  for (const arg of args) {
    if (arg.type !== "ObjectExpression") continue;
    for (const p of arg.properties) {
      if (p.type !== "Property" || p.key.type !== "Identifier" || p.key.name !== "alias") continue;
      const v = readLiteralValue(p.value);
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Decorator helpers
// ---------------------------------------------------------------------------

/** Finds a decorator by name (`@Name` or `@Name(...)`), matching `Name` as a bare identifier or an `x.Name` member (e.g. `@core.Component(...)`). */
function findDecoratorCall(decorators: Decorator[], name: string): CallExpression | undefined {
  for (const decorator of decorators) {
    const expr = unwrapParens(decorator.expression);
    if (expr.type === "CallExpression" && calleeNamed(expr.callee, name)) return expr;
  }
  return undefined;
}

function calleeNamed(callee: Expression, name: string): boolean {
  if (callee.type === "Identifier") return callee.name === name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    return callee.property.name === name;
  }
  return false;
}

function firstObjectArg(call: CallExpression): ObjectExpression | undefined {
  const arg = call.arguments[0];
  return arg && arg.type === "ObjectExpression" ? arg : undefined;
}

/** oxc preserves ParenthesizedExpression as a distinct node type (see detect-vue.ts). */
function unwrapParens(node: Node): Node {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = (current as { expression: Node }).expression;
  }
  return current;
}
