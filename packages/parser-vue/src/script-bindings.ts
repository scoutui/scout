import type { BindingPattern, Expression, ObjectExpression, Program } from "@oxc-project/types";
import type { VueParseWrapper } from "./parse-sfc.js";

/**
 * Names an SFC's script binds that the graph holds no binding for: every
 * script block's top-level variable, function and class declarations and its
 * `components:` registrations.
 */
export function scriptOnlyBindings(wrapper: VueParseWrapper): Set<string> {
  const names = new Set<string>();
  for (const program of [wrapper.scriptProgram, wrapper.plainScriptProgram]) {
    if (program === undefined) continue;
    for (const name of declaredNames(program)) names.add(name);
    for (const name of registeredComponents(program)) names.add(name);
  }
  return names;
}

function declaredNames(program: Program): string[] {
  const names: string[] = [];
  for (const stmt of program.body) {
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations) patternNames(d.id, names);
    } else if ((decl?.type === "FunctionDeclaration" || decl?.type === "ClassDeclaration") && decl.id !== null) {
      names.push(decl.id.name);
    }
  }
  return names;
}

function patternNames(pattern: BindingPattern, out: string[]): void {
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name);
      return;
    case "AssignmentPattern":
      patternNames(pattern.left, out);
      return;
    case "ObjectPattern":
      for (const p of pattern.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out);
      return;
    case "ArrayPattern":
      for (const e of pattern.elements) {
        if (e !== null) patternNames(e.type === "RestElement" ? e.argument : e, out);
      }
  }
}

/**
 * Whether any script block declares the component's options (`optionsOf`),
 * whose keys become members of the component object.
 */
export function declaresOptions(wrapper: VueParseWrapper): boolean {
  return [wrapper.scriptProgram, wrapper.plainScriptProgram].some(
    (program) => program !== undefined && optionsOf(program).length > 0,
  );
}

/**
 * Whether any script block exports a value beside its default export, which
 * the graph records only as the SFC itself.
 */
export function exportsBesideDefault(wrapper: VueParseWrapper): boolean {
  return [wrapper.scriptProgram, wrapper.plainScriptProgram].some(
    (program) =>
      program?.body.some((stmt) => {
        if (stmt.type === "ExportAllDeclaration") return stmt.exportKind !== "type";
        if (stmt.type !== "ExportNamedDeclaration" || stmt.exportKind === "type") return false;
        const type = stmt.declaration?.type;
        return type !== "TSInterfaceDeclaration" && type !== "TSTypeAliasDeclaration";
      }) === true,
  );
}

/**
 * The options each statement that declares them passes: `export default …`,
 * a call's first argument there (`export default defineComponent({ … })`),
 * and `defineOptions(…)`'s first argument. Undefined for a call with none.
 */
function optionsOf(program: Program): Array<Expression | undefined> {
  const found: Array<Expression | undefined> = [];
  for (const stmt of program.body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = unwrapParens(stmt.declaration as Expression);
      found.push(decl.type === "CallExpression" ? (decl.arguments[0] as Expression | undefined) : decl);
    } else if (
      stmt.type === "ExpressionStatement" &&
      stmt.expression.type === "CallExpression" &&
      stmt.expression.callee.type === "Identifier" &&
      stmt.expression.callee.name === "defineOptions"
    ) {
      found.push(stmt.expression.arguments[0] as Expression | undefined);
    }
  }
  return found;
}

/** Keys of the `components:` object of the options the script declares (`optionsOf`). */
function registeredComponents(program: Program): string[] {
  const names: string[] = [];
  for (const options of optionsOf(program)) {
    if (options?.type !== "ObjectExpression") continue;
    const components = propertyValue(options, "components");
    if (components?.type !== "ObjectExpression") continue;
    for (const p of components.properties) {
      if (p.type !== "Property" || p.computed) continue;
      if (p.key.type === "Identifier") names.push(p.key.name);
      else if (p.key.type === "Literal" && typeof p.key.value === "string") names.push(p.key.value);
    }
  }
  return names;
}

function propertyValue(obj: ObjectExpression, key: string): Expression | undefined {
  for (const p of obj.properties) {
    if (p.type === "Property" && !p.computed && p.key.type === "Identifier" && p.key.name === key) {
      return unwrapParens(p.value);
    }
  }
  return undefined;
}

function unwrapParens(expr: Expression): Expression {
  let current = expr;
  while (current.type === "ParenthesizedExpression") current = current.expression;
  return current;
}
