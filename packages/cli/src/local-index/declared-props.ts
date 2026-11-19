import type {
  ObjectPattern,
  ObjectExpression,
  TSTypeLiteral,
  Expression,
  Node,
  Program,
  Function as OxcFunction,
  ArrowFunctionExpression,
  CallExpression,
  Class,
} from "@oxc-project/types";
import type { DeclaredProp, DeclaredPropApi } from "@scoutui/scan-format";

/** Read a literal expression node into its JS value, or undefined if non-literal.
 *  oxc uses a unified ESTree `Literal` node; the value lives on `.value`. */
export function readLiteralValue(
  node: Expression | Node,
): string | number | boolean | null | undefined {
  if (node.type === "Literal") {
    const v = (node as unknown as { value: unknown }).value;
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      return v;
    }
  }
  return undefined;
}

/** Object-destructure pattern → declared API. Shared by React destructuring
 *  params and Vue reactive-props destructure (identical oxc shape). oxc emits
 *  `type: "Property"` for binding properties and `type: "RestElement"` for rest. */
export function objectPatternToDeclared(pattern: ObjectPattern): DeclaredPropApi {
  const props: Record<string, DeclaredProp> = {};
  let hasRest = false;
  for (const p of pattern.properties) {
    if (p.type === "RestElement") {
      hasRest = true;
      continue;
    }
    if (p.type !== "Property") continue;
    if (p.key.type !== "Identifier") continue; // skip computed / string keys
    const name = p.key.name;
    if (p.value.type === "AssignmentPattern") {
      const decl: DeclaredProp = { required: false };
      const lit = readLiteralValue(p.value.right);
      if (lit !== undefined) decl.default = lit;
      props[name] = decl;
    } else {
      props[name] = {};
    }
  }
  return { props, hasRest };
}

/** Vue inline type-literal `defineProps<{ ... }>()` → declared API. Names +
 *  required (from `?`) + verbatim type text. An index signature → hasRest. */
export function typeLiteralToDeclared(typeLit: TSTypeLiteral, scriptSource: string): DeclaredPropApi {
  const props: Record<string, DeclaredProp> = {};
  let hasRest = false;
  for (const m of typeLit.members) {
    if (m.type === "TSIndexSignature") {
      hasRest = true;
      continue;
    }
    if (m.type !== "TSPropertySignature") continue;
    if (m.key.type !== "Identifier") continue;
    const decl: DeclaredProp = { required: !m.optional };
    if (m.typeAnnotation) {
      const t = m.typeAnnotation.typeAnnotation;
      decl.type = scriptSource.slice(t.start, t.end);
    }
    props[m.key.name] = decl;
  }
  return { props, hasRest };
}

/** A Vue prop options object (`{ type, required, default }`) → what it states. */
export function propOptionsToDeclared(options: ObjectExpression): DeclaredProp {
  const decl: DeclaredProp = {};
  for (const d of options.properties) {
    if (d.type !== "Property" || d.key.type !== "Identifier") continue;
    if (d.key.name === "type" && d.value.type === "Identifier") {
      decl.type = d.value.name;
    } else if (d.key.name === "required") {
      const r = readLiteralValue(d.value);
      if (typeof r === "boolean") decl.required = r;
    } else if (d.key.name === "default") {
      const lit = readLiteralValue(d.value);
      if (lit !== undefined) decl.default = lit;
    }
  }
  return decl;
}

/** Vue object-runtime `defineProps({ ... })` → declared API. Reads each key's
 *  descriptor (`{ type, required, default }`) or shorthand constructor. */
export function objectRuntimeToDeclared(obj: ObjectExpression): DeclaredPropApi {
  const props: Record<string, DeclaredProp> = {};
  for (const p of obj.properties) {
    if (p.type !== "Property") continue;
    if (p.key.type !== "Identifier") continue;
    const val = p.value;
    props[p.key.name] =
      val.type === "ObjectExpression"
        ? propOptionsToDeclared(val)
        : val.type === "Identifier"
          ? { type: val.name } // shorthand: `variant: String`
          : {};
  }
  return { props, hasRest: false };
}

/** A top-level component a module declares: a function, or a class. */
type ComponentDecl = { fn: OxcFunction | ArrowFunctionExpression } | { cls: Class };

/** What a `propTypes` or `defaultProps` assignment holds: an object literal
 *  the scan can read, or `null` for a value it can't. */
type StaticValue = ObjectExpression | null;

/**
 * The declared prop API of every top-level function or class component in a
 * React module, keyed by its local symbol. An anonymous default export is
 * keyed `"default"`. Exported or not, whatever its name or body.
 *
 * Read from a function's destructured first parameter, and from the
 * component's `propTypes` and `defaultProps`: a `static` field of a class,
 * or a module-level `X.propTypes = …` (the last assignment wins, as when the
 * module runs). Each holds an object literal, a module-level `const` bound
 * to one, or a one-argument call around one (`forbidExtraProps({…})`).
 * `mergeDeclared` combines them.
 */
export function extractReactDeclaredProps(program: Program): Map<string, DeclaredPropApi> {
  const components = new Map<string, ComponentDecl>();
  const constObjects = new Map<string, Node>();
  const assignments: { symbol: string; member: "propTypes" | "defaultProps"; value: Node }[] = [];
  const propTypesNames = new Set<string>();
  const addFn = (symbol: string, fn: OxcFunction | ArrowFunctionExpression | null): void => {
    if (fn) components.set(symbol, { fn });
  };
  for (const stmt of program.body) {
    if (stmt.type === "ImportDeclaration") {
      if (stmt.source.value === "prop-types") for (const spec of stmt.specifiers ?? []) propTypesNames.add(spec.local.name);
      continue;
    }
    if (stmt.type === "ExpressionStatement") {
      const assignment = staticPropsAssignment(stmt.expression);
      if (assignment) assignments.push(assignment);
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (decl.type === "FunctionDeclaration") addFn(decl.id?.name ?? "default", decl);
      else if (decl.type === "ClassDeclaration") components.set(decl.id?.name ?? "default", { cls: decl });
      else addFn("default", functionFromInit(decl));
      continue;
    }
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type === "FunctionDeclaration" && decl.id) {
      addFn(decl.id.name, decl);
    } else if (decl?.type === "ClassDeclaration" && decl.id) {
      components.set(decl.id.name, { cls: decl });
    } else if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.id.type !== "Identifier" || !d.init) continue;
        if (d.init.type === "ClassExpression") components.set(d.id.name, { cls: d.init });
        else if (functionFromInit(d.init)) addFn(d.id.name, functionFromInit(d.init));
        else if (decl.kind === "const") constObjects.set(d.id.name, d.init);
      }
    }
  }

  const readStatic = (value: Node): StaticValue => staticObject(value, constObjects);
  const found = new Map<string, DeclaredPropApi>();
  for (const [symbol, component] of components) {
    let propTypes: StaticValue | undefined;
    let defaultProps: StaticValue | undefined;
    if ("cls" in component) {
      for (const member of component.cls.body.body) {
        if (member.type !== "PropertyDefinition" || !member.static || member.computed || member.key.type !== "Identifier" || !member.value) continue;
        if (member.key.name === "propTypes") propTypes = readStatic(member.value);
        if (member.key.name === "defaultProps") defaultProps = readStatic(member.value);
      }
    }
    for (const a of assignments) {
      if (a.symbol !== symbol) continue;
      if (a.member === "propTypes") propTypes = readStatic(a.value);
      else defaultProps = readStatic(a.value);
    }
    const declared = mergeDeclared({
      pattern: "fn" in component ? destructuredParam(component.fn) : undefined,
      forwardsAll: forwardsAllProps(component),
      propTypes,
      defaultProps,
      propTypesNames,
    });
    if (declared) found.set(symbol, declared);
  }
  return found;
}

/** `X.propTypes = v` or `X.defaultProps = v`, with `X` an identifier. */
function staticPropsAssignment(expr: Expression): { symbol: string; member: "propTypes" | "defaultProps"; value: Node } | undefined {
  if (expr.type !== "AssignmentExpression" || expr.operator !== "=") return undefined;
  const left = expr.left;
  if (left.type !== "MemberExpression" || left.computed || left.property.type !== "Identifier" || left.object.type !== "Identifier") return undefined;
  const member = left.property.name;
  if (member !== "propTypes" && member !== "defaultProps") return undefined;
  return { symbol: left.object.name, member, value: expr.right };
}

/** Parentheses and TS-only wrappers (`as`, `satisfies`, `!`, `<T>x`) removed. */
function unwrap(node: Node): Node {
  let current = node;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSTypeAssertion"
  ) {
    current = (current as unknown as { expression: Node }).expression;
  }
  return current;
}

/** The object literal a `propTypes` or `defaultProps` value holds: itself, a
 *  module-level `const` bound to one, or the one argument of a call around
 *  one; `null` for anything else. */
function staticObject(value: Node, constObjects: ReadonlyMap<string, Node>, depth = 0): StaticValue {
  const node = unwrap(value);
  if (node.type === "ObjectExpression") return node;
  if (depth > 3) return null;
  if (node.type === "Identifier") {
    const bound = constObjects.get(node.name);
    return bound ? staticObject(bound, constObjects, depth + 1) : null;
  }
  if (node.type === "CallExpression" && node.arguments.length === 1 && node.arguments[0]?.type !== "SpreadElement") {
    return staticObject(node.arguments[0] as Node, constObjects, depth + 1);
  }
  return null;
}

/** A function component's destructured first parameter (`({…} = {})` unwrapped). */
function destructuredParam(fn: OxcFunction | ArrowFunctionExpression): ObjectPattern | undefined {
  const first = fn.params[0];
  if (!first) return undefined;
  const pat = first.type === "AssignmentPattern" ? first.left : first;
  return pat.type === "ObjectPattern" ? (pat as ObjectPattern) : undefined;
}

/** Whether a component spreads its whole props object somewhere in its body:
 *  `{...props}` for a function whose first parameter is the name `props`, or
 *  `{...this.props}` in a class. Such a component passes on props it doesn't
 *  name. */
function forwardsAllProps(component: ComponentDecl): boolean {
  let isWhole: (arg: Node) => boolean;
  let body: Node;
  if ("fn" in component) {
    const first = component.fn.params[0];
    if (first?.type !== "Identifier") return false;
    const name = first.name;
    isWhole = (arg) => arg.type === "Identifier" && arg.name === name;
    body = component.fn.body as Node;
  } else {
    isWhole = (arg) =>
      arg.type === "MemberExpression" && !arg.computed && arg.object.type === "ThisExpression" && arg.property.type === "Identifier" && arg.property.name === "props";
    body = component.cls.body as unknown as Node;
  }
  const visit = (node: unknown): boolean => {
    if (node === null || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(visit);
    const n = node as { type?: unknown; argument?: Node };
    if ((n.type === "JSXSpreadAttribute" || n.type === "SpreadElement") && n.argument && isWhole(unwrap(n.argument))) return true;
    return Object.values(node).some((v) => typeof v === "object" && v !== null && visit(v));
  };
  return visit(body);
}

/** A static property key's name: an identifier, or a string literal. */
function propertyName(p: ObjectExpression["properties"][number]): string | undefined {
  if (p.type !== "Property" || p.computed) return undefined;
  if (p.key.type === "Identifier") return p.key.name;
  const lit = readLiteralValue(p.key);
  return typeof lit === "string" ? lit : undefined;
}

/**
 * A component's declared API from what it states about its props. Names are
 * the union of its destructured names and its `propTypes` keys, in that
 * order; a `defaultProps` key names no prop of its own. Undefined when there
 * are no names.
 *
 * - `required`: `false` for a prop with a default (destructured or in
 *   `defaultProps`), else `true` for a `propTypes` value ending `.isRequired`
 *   and `false` for another `prop-types` validator. A value the scan can't
 *   read as either leaves it absent.
 * - `default`: the destructured default, else the `defaultProps` value, when
 *   it's a literal.
 * - `hasRest`: the destructure collects `...rest`, the component spreads its
 *   whole props object (`forwardsAll`), or `propTypes` names props the scan
 *   can't read (a spread, a computed key, or a value that isn't an object).
 */
function mergeDeclared(input: {
  pattern: ObjectPattern | undefined;
  forwardsAll: boolean;
  propTypes: StaticValue | undefined;
  defaultProps: StaticValue | undefined;
  propTypesNames: ReadonlySet<string>;
}): DeclaredPropApi | undefined {
  const fromPattern = input.pattern ? objectPatternToDeclared(input.pattern) : { props: {}, hasRest: false };
  const props = new Map<string, DeclaredProp>(Object.entries(fromPattern.props).map(([name, decl]) => [name, { ...decl }]));
  const destructuredDefaults = new Set<string>();
  for (const p of input.pattern?.properties ?? []) {
    if (p.type === "Property" && p.key.type === "Identifier" && p.value.type === "AssignmentPattern") destructuredDefaults.add(p.key.name);
  }
  let hasRest = fromPattern.hasRest || input.forwardsAll || input.propTypes === null;
  for (const p of input.propTypes?.properties ?? []) {
    const name = propertyName(p);
    if (p.type !== "Property" || name === undefined) {
      hasRest = true;
      continue;
    }
    const decl = props.get(name) ?? {};
    if (!destructuredDefaults.has(name)) {
      const required = requiredFromPropType(p.value, input.propTypesNames);
      if (required !== undefined) decl.required = required;
    }
    props.set(name, decl);
  }
  for (const p of input.defaultProps?.properties ?? []) {
    const name = propertyName(p);
    const decl = name === undefined ? undefined : props.get(name);
    if (p.type !== "Property" || name === undefined || decl === undefined) continue;
    decl.required = false;
    // A destructured default, literal or not, is the one recorded.
    if (!destructuredDefaults.has(name)) {
      const lit = readLiteralValue(p.value);
      if (lit !== undefined) decl.default = lit;
    }
  }
  return props.size > 0 ? { props: Object.fromEntries(props), hasRest } : undefined;
}

/** `true` for a validator ending `.isRequired`, `false` for another one built
 *  from a `prop-types` import (`PropTypes.string`, `oneOf([…])`), undefined
 *  for a value the scan can't tell (`shared.title`, a custom function). */
function requiredFromPropType(value: Node, propTypesNames: ReadonlySet<string>): boolean | undefined {
  const node = unwrap(value);
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier" && node.property.name === "isRequired") return true;
  let root: Node = node;
  while (root.type === "MemberExpression" || root.type === "CallExpression") {
    root = unwrap(root.type === "MemberExpression" ? root.object : root.callee);
  }
  return root.type === "Identifier" && propTypesNames.has(root.name) ? false : undefined;
}

/** The underlying component function for a variable init: an arrow/fn-expr, or
 *  the one inside memo/forwardRef/observer wrappers, however nested. */
function functionFromInit(init: Node): OxcFunction | ArrowFunctionExpression | null {
  if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
    return init as OxcFunction | ArrowFunctionExpression;
  }
  if (init.type === "CallExpression") {
    const c = init as CallExpression;
    let name: string | undefined;
    if (c.callee.type === "Identifier") name = c.callee.name;
    else if (c.callee.type === "MemberExpression" && c.callee.property.type === "Identifier") name = c.callee.property.name;
    if ((name === "memo" || name === "forwardRef" || name === "observer") && c.arguments[0]) {
      return functionFromInit(c.arguments[0]);
    }
  }
  return null;
}
