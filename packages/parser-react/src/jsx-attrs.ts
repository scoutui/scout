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
