import type { JSXAttribute, JSXOpeningElement } from "oxc-parser";
import type { Expression } from "@oxc-project/types";
import { isHandlerName, type PropUsage } from "@scoutui/reference-graph";
import { unwrapTsNoise } from "./infer-value.js";

/** Dotted static member path, or null if any segment is computed/dynamic. */
function memberPath(node: Expression): string | null {
  const parts: string[] = [];
  let cur: Expression = node;
  while (cur.type === "MemberExpression") {
    const m = cur as unknown as { object: Expression; property: { type: string; name?: string; value?: unknown }; computed?: boolean };
    if (m.computed) return null;
    if (m.property.type !== "Identifier" || typeof m.property.name !== "string") return null;
    parts.unshift(m.property.name);
    cur = m.object;
  }
  if (cur.type !== "Identifier") return null;
  parts.unshift((cur as unknown as { name: string }).name);
  return parts.join(".");
}

const isLiteralValue = (v: unknown): v is string | number | boolean | null =>
  v === null || ["string", "number", "boolean"].includes(typeof v);

/** Collect literal leaves of a ternary; null if any leaf is non-literal. */
function ternaryLiterals(node: Expression): (string | number | boolean)[] | null {
  if (node.type !== "ConditionalExpression") return null;
  const c = node as unknown as { consequent: Expression; alternate: Expression };
  const out: (string | number | boolean)[] = [];
  for (const branch of [c.consequent, c.alternate]) {
    const b = unwrapTsNoise(branch);
    if (!b || b.type !== "Literal") return null;
    const val = (b as unknown as { value: unknown }).value;
    if (val === null || typeof val === "object") return null;
    out.push(val as string | number | boolean);
  }
  return out;
}

/** One attribute's usage, or null for a value it skips (an empty `{}`, or JSX as the value). */
function readAttrValue(name: string, value: JSXAttribute["value"]): PropUsage | null {
  if (!value) return { name, tier: "written", value: true };
  if (value.type === "Literal") return { name, tier: "written", value: value.value };
  if (value.type !== "JSXExpressionContainer") return null;

  const raw = value.expression;
  if (raw.type === "JSXEmptyExpression") return null;
  return readExprValue(name, raw);
}

/** One prop's usage from the expression passed for it, or null for one it
 *  skips. */
function readExprValue(name: string, raw: Expression): PropUsage | null {
  const expr = unwrapTsNoise(raw);
  if (!expr) return null;

  if (expr.type === "Literal") {
    const val = (expr as unknown as { value: unknown }).value;
    return isLiteralValue(val) ? { name, tier: "written", value: val } : { name, tier: "dynamic" };
  }
  const set = ternaryLiterals(expr);
  if (set) return { name, tier: "written", valueSet: set };
  if (expr.type === "Identifier") return { name, tier: "reference", ref: (expr as unknown as { name: string }).name };
  const path = memberPath(expr);
  return path ? { name, tier: "reference", ref: path } : { name, tier: "dynamic" };
}

/**
 * Extract per-prop usage from a JSXOpeningElement. A prop named `on` plus a
 * capital letter keeps a `written` value; any other value it has is `dynamic`
 * (recovered into the component's `events` rollup downstream). Drops empty
 * expression containers (`{}`) on other props. Returns one entry per recognised
 * attribute, tiered as `written` (literal value, incl. a folded literal set from
 * a ternary-of-literals), `reference` (identifier or static member path,
 * captured by name but not resolved), or `dynamic` (opaque: call, spread,
 * object/array, mixed template, etc.).
 */
export function readJsxAttrs(opening: JSXOpeningElement): PropUsage[] {
  const props: PropUsage[] = [];
  for (const attr of opening.attributes) {
    if (attr.type === "JSXSpreadAttribute") {
      if (!props.some((p) => p.name === "...rest")) props.push({ name: "...rest", tier: "dynamic" });
      continue;
    }
    if (attr.type !== "JSXAttribute") continue;
    const nameNode = attr.name;
    const name = nameNode.type === "JSXIdentifier" ? nameNode.name : "";
    if (!name) continue;
    const usage = readAttrValue(name, attr.value);
    if (isHandlerName(name)) {
      props.push(usage?.tier === "written" ? usage : { name, tier: "dynamic" });
      continue;
    }
    if (usage) props.push(usage);
  }
  return props;
}

/**
 * Per-prop usage from the props argument of a render call
 * (`createElement(X, { … })`, `h(X, { … })`), read the way `readJsxAttrs`
 * reads attributes. Each statically named key is a prop. A spread, a computed
 * key, or a props argument that isn't an object literal (`h(X, props)`)
 * passes props Scout can't name, recorded once as `...rest`. No argument, or
 * a literal `null`/`undefined`, passes none.
 */
export function readPropsArgument(arg: Expression | undefined): PropUsage[] {
  const expr = arg === undefined ? undefined : unwrapTsNoise(arg);
  if (!expr || isNullishArgument(expr)) return [];
  const rest: PropUsage = { name: "...rest", tier: "dynamic" };
  if (expr.type !== "ObjectExpression") return [rest];
  const props: PropUsage[] = [];
  for (const prop of (expr as unknown as { properties: OxcProperty[] }).properties) {
    const name = prop.type === "Property" && !prop.computed ? staticKey(prop.key) : null;
    if (prop.type !== "Property" || name === null) {
      if (!props.some((p) => p.name === "...rest")) props.push(rest);
      continue;
    }
    const usage = prop.kind !== "init" || prop.method ? null : readExprValue(name, prop.value);
    if (isHandlerName(name)) {
      props.push(usage?.tier === "written" ? usage : { name, tier: "dynamic" });
      continue;
    }
    props.push(usage ?? { name, tier: "dynamic" });
  }
  return props;
}

/** A render call argument that passes nothing: `null`, `undefined` or
 *  `void 0`, through TS casts. */
export function isNullishArgument(arg: Expression): boolean {
  const expr = unwrapTsNoise(arg);
  if (!expr) return false;
  if (expr.type === "Literal") return (expr as unknown as { value: unknown }).value === null;
  if (expr.type === "Identifier") return (expr as unknown as { name: string }).name === "undefined";
  return expr.type === "UnaryExpression" && (expr as unknown as { operator: string }).operator === "void";
}

type OxcProperty =
  | { type: "SpreadElement" }
  | {
      type: "Property";
      computed: boolean;
      kind: "init" | "get" | "set";
      method: boolean;
      key: { type: string; name?: string; value?: unknown };
      value: Expression;
    };

function staticKey(key: { type: string; name?: string; value?: unknown }): string | null {
  if (key.type === "Identifier" && typeof key.name === "string") return key.name;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) return String(key.value);
  return null;
}
