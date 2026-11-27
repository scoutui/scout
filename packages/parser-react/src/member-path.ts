import type { Expression } from "@oxc-project/types";

/** An identifier or dotted static member path as written, such as `theme.icon`, or null if any segment is computed or dynamic. */
export function memberPath(node: Expression): string | null {
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
