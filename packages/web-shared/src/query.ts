// Query semantics:
// - liqe string match is case-insensitive substring (so `name:button` finds IconButton).
// - array fields match by membership (so `tag` is projected as string[]).
import type { ComponentKind, GovernanceRecord, KnownComponentKind, Tag } from "./dto.js";
import { componentDeprecated } from "./governance.js";
import { presentIdentity, type PresentableComponent } from "./present-identity.js";
import { resolveTags } from "./tags.js";
import { parse, test as liqeTest } from "liqe";
import type { LiqeQuery } from "liqe";

type Component = PresentableComponent & { stats: { occurrenceCount: number }; writtenNames?: readonly string[] | undefined };

/** The known friendly kinds `friendlyKind` returns for the four kinds this dashboard knows by name. */
export type KnownFriendlyKind = "react" | "vue" | "wc" | "undefined-element";

/** The flat object liqe.test() matches a query against. `kind` is open: a known friendly kind, or the
 *  framework's own name (e.g. "svelte") for a component whose framework this dashboard doesn't know. */
export type QueryView = {
  name: string;
  /** The other names files render the component under, so a bare term finds it by any of them. */
  written: string[];
  scope: "external" | "local";
  kind: KnownFriendlyKind | string;
  package: string;
  deprecated: boolean;
  uses: number;
  tag: string[];
};

const KIND_FRIENDLY: Record<KnownComponentKind, KnownFriendlyKind> = {
  "react-component": "react",
  "vue-component": "vue",
  "custom-element": "wc",
  tag: "undefined-element",
};

const COMPONENT_SUFFIX = "-component";

/** `kind`'s friendly form: the known word for a kind this dashboard recognises, otherwise the
 *  framework name an open `${framework}-component` kind carries (e.g. "svelte-component" → "svelte"). */
export function friendlyKind(kind: ComponentKind): KnownFriendlyKind | string {
  const known = (KIND_FRIENDLY as Partial<Record<ComponentKind, KnownFriendlyKind>>)[kind];
  if (known !== undefined) return known;
  return kind.endsWith(COMPONENT_SUFFIX) ? kind.slice(0, -COMPONENT_SUFFIX.length) : kind;
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
