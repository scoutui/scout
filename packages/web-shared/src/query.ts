// Query semantics:
// - liqe string match is case-insensitive substring (so `name:button` finds IconButton).
// - array fields match by membership (so `tag` is projected as string[]).
import type { ComponentKind, GovernanceRecord, Tag } from "./dto.js";
import { componentDeprecated } from "./governance.js";
import { presentIdentity, type PresentableComponent } from "./present-identity.js";
import { resolveTags } from "./tags.js";
import { parse, test as liqeTest } from "liqe";
import type { LiqeQuery } from "liqe";

type Component = PresentableComponent & { stats: { occurrenceCount: number }; writtenNames?: readonly string[] | undefined };

/** The flat object liqe.test() matches a query against. */
export type QueryView = {
  name: string;
  /** The other names files render the component under, so a bare term finds it by any of them. */
  written: string[];
  scope: "external" | "local";
  kind: "react" | "vue" | "wc" | "undefined-element";
  package: string;
  deprecated: boolean;
  uses: number;
  tag: string[];
};

const KIND_FRIENDLY: Record<ComponentKind, QueryView["kind"]> = {
  "react-component": "react",
  "vue-component": "vue",
  "custom-element": "wc",
  tag: "undefined-element",
};

export function friendlyKind(kind: ComponentKind): QueryView["kind"] {
  return KIND_FRIENDLY[kind];
}

export function toQueryView(
  c: Component,
  governance: GovernanceRecord[],
  tags: Tag[],
): QueryView {
  const { scope, kind, packageName, exportName, tagName } = presentIdentity(c);
  return {
    name: exportName ?? tagName ?? "(anonymous)",
    written: [...(c.writtenNames ?? [])],
    scope,
    kind: friendlyKind(kind),
    package: packageName ?? "",
    deprecated: componentDeprecated(c, governance),
    uses: c.stats.occurrenceCount,
    tag: resolveTags(packageName, tags).map((t) => t.value),
  };
}

/** Parse a query string. Empty → null ast (caller treats as match-all). Malformed → error, never throws. */
export function parseQuery(input: string): { ast: LiqeQuery | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { ast: null, error: null };
  if (trimmed.length > 2000) return { ast: null, error: "query too long" };
  try {
    return { ast: parse(trimmed), error: null };
  } catch (e) {
    return { ast: null, error: e instanceof Error ? e.message : "invalid query" };
  }
}

/**
 * Whether a component matches the parsed query. False when liqe throws at eval
 * time, which it does for a query that parses but can't be evaluated (a numeric
 * comparison against a string, `uses:>foo`) and for unknown field names.
 */
export function matchesQuery(
  ast: LiqeQuery,
  c: Component,
  governance: GovernanceRecord[],
  tags: Tag[],
): boolean {
  try {
    return liqeTest(ast, toQueryView(c, governance, tags));
  } catch {
    return false;
  }
}
