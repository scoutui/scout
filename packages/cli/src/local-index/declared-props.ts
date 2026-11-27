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
} from "@oxc-project/types";
import type { DeclaredProp, DeclaredPropApi } from "@scoutui/scan-format";
import { memberPath } from "@scoutui/parser-react";

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

/** The fields of a `DeclaredProp` that state its default. All absent: the default wasn't read. */
export type DeclaredDefault = Pick<DeclaredProp, "default" | "hasDefault" | "defaultRef">;

const NO_DEFAULT: DeclaredDefault = { hasDefault: false };

/** What a default's initialiser states: its literal value; for another
 *  expression, that a default exists, with the identifier or dotted path it
 *  names; and no default for a missing initialiser or `undefined`. */
export function readDefault(node: Expression | null | undefined): DeclaredDefault {
  if (!node || (node.type === "Identifier" && node.name === "undefined")) return NO_DEFAULT;
  const literal = readLiteralValue(node);
  if (literal !== undefined) return { default: literal };
  const ref = memberPath(node);
  return ref ? { hasDefault: true, defaultRef: ref } : { hasDefault: true };
}

/** `prop` with its default fields replaced by `state`. */
export function withDefaultState(prop: DeclaredProp, state: DeclaredDefault): DeclaredProp {
  const { default: _value, hasDefault: _has, defaultRef: _ref, ...rest } = prop;
  return { ...rest, ...state };
}

/** Whether `state` says the prop has a default, literal or not. */
export const statesDefault = (state: DeclaredDefault): boolean => state.default !== undefined || state.hasDefault === true;

/** The default left after an object spread that may set it: a default with an
 *  unknown value if one was set before, otherwise unread. */
export const afterSpread = (state: DeclaredDefault): DeclaredDefault => (statesDefault(state) ? { hasDefault: true } : {});

/** An object property's static name: an identifier key or a string-literal key. */
export function staticKeyName(property: { key: Node; computed: boolean }): string | undefined {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return (property.key as { name: string }).name;
  const literal = readLiteralValue(property.key);
  return typeof literal === "string" ? literal : undefined;
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
    props[name] = p.value.type === "AssignmentPattern" ? { required: false, ...readDefault(p.value.right) } : NO_DEFAULT;
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
    props[m.key.name] = { ...decl, ...NO_DEFAULT };
  }
  return { props, hasRest };
}

/** A Vue prop options object (`{ type, required, default }`) → what it states.
 *  A spread or computed key may set the default, so it isn't read past one. */
export function propOptionsToDeclared(options: ObjectExpression): DeclaredProp {
  const decl: DeclaredProp = {};
  let state = NO_DEFAULT;
  for (const d of options.properties) {
    if (d.type !== "Property" || d.computed) {
      state = afterSpread(state);
      continue;
    }
    const key = staticKeyName(d);
    if (key === "type" && d.value.type === "Identifier") {
      decl.type = d.value.name;
    } else if (key === "required") {
      const r = readLiteralValue(d.value);
      if (typeof r === "boolean") decl.required = r;
    } else if (key === "default") {
      state = readDefault(d.value);
    }
  }
  return { ...decl, ...state };
}

/** Vue's built-in prop type constructors: a shorthand naming one declares no default. */
const VUE_TYPE_CONSTRUCTORS = new Set(["String", "Number", "Boolean", "Array", "Object", "Date", "Function", "Symbol", "BigInt"]);

/** A Vue runtime prop value that isn't an options object: a constructor
 *  shorthand (`variant: String`) or a type list (`[String, Number]`). Any other
 *  identifier may name a shared options object, so its default isn't read. */
function shorthandToDeclared(value: Expression): DeclaredProp {
  if (value.type === "Identifier") {
    return VUE_TYPE_CONSTRUCTORS.has(value.name) ? { type: value.name, ...NO_DEFAULT } : { type: value.name };
  }
  return value.type === "ArrayExpression" ? NO_DEFAULT : {};
}

/** Vue object-runtime `defineProps({ ... })` → declared API. Reads each key's
 *  descriptor (`{ type, required, default }`) or shorthand constructor. */
export function objectRuntimeToDeclared(obj: ObjectExpression): DeclaredPropApi {
  const props: Record<string, DeclaredProp> = {};
  for (const p of obj.properties) {
    if (p.type !== "Property") continue;
    if (p.key.type !== "Identifier") continue;
    const val = p.value;
    props[p.key.name] = val.type === "ObjectExpression" ? propOptionsToDeclared(val) : shorthandToDeclared(val);
  }
  return { props, hasRest: false };
}

/** The declared prop API of every top-level function in a React module (a
 *  function declaration, or a variable whose initialiser `functionFromInit`
 *  reads as a function), keyed by its local symbol. An anonymous default
 *  export is keyed `"default"`. Exported or not, whatever its name or body. */
export function extractReactDeclaredProps(program: Program): Map<string, DeclaredPropApi> {
  const found = new Map<string, DeclaredPropApi>();
  const record = (symbol: string, fn: OxcFunction | ArrowFunctionExpression | null): void => {
    const declared = fn ? declaredFromFn(fn) : undefined;
    if (declared) found.set(symbol, declared);
  };
  for (const stmt of program.body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (decl.type === "FunctionDeclaration") record(decl.id?.name ?? "default", decl);
      else record("default", functionFromInit(decl));
      continue;
    }
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type === "FunctionDeclaration" && decl.id) {
      record(decl.id.name, decl);
    } else if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.id.type === "Identifier" && d.init) record(d.id.name, functionFromInit(d.init));
      }
    }
  }
  return found;
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

/** Declared API from a component function's first param, when it is an object
 *  destructure with ≥1 named prop. `({...}= {})` default-param form is unwrapped. */
function declaredFromFn(fn: OxcFunction | ArrowFunctionExpression): DeclaredPropApi | undefined {
  const first = fn.params[0];
  if (!first) return undefined;
  const pat = first.type === "AssignmentPattern" ? first.left : first;
  if (pat.type !== "ObjectPattern") return undefined;
  const declared = objectPatternToDeclared(pat as ObjectPattern);
  return Object.keys(declared.props).length > 0 ? declared : undefined;
}
