import type { CohortSelector, TagRule } from "@scoutui/web-shared";
import { tagMatchesPackage } from "@scoutui/web-shared/client";

/** A component the chart builder can add as a series, with its uses in each repo's latest scan. */
export type PickableComponent = {
  componentId: string;
  displayName: string;
  packageName: string | null;
  disambiguator: string | null;
  deprecated: boolean;
  occurrences: number;
  /** Defined in a scanned repo rather than imported from a package. */
  local: boolean;
};

export type LibraryTag = { id: string; label: string; color: string; rule: TagRule };
export type DeprecatableSelector = Extract<CohortSelector, { kind: "package" | "tag" }>;
export type DeprecatedShare = { deprecated: number; total: number };

function inSeries(sel: DeprecatableSelector, packageName: string | null, tags: LibraryTag[]): boolean {
  if (packageName === null) return false;
  if (sel.kind === "package") return packageName === sel.packageName;
  const tag = tags.find((t) => t.id === sel.tagId);
  return tag !== undefined && tagMatchesPackage(tag, packageName);
}

/** How many of `components` a package or tag series covers, and how many of those are deprecated. */
export function deprecatedShare(sel: DeprecatableSelector, components: PickableComponent[], tags: LibraryTag[]): DeprecatedShare {
  let deprecated = 0;
  let total = 0;
  for (const c of components) {
    if (!inSeries(sel, c.packageName, tags)) continue;
    total += 1;
    if (c.deprecated) deprecated += 1;
  }
  return { deprecated, total };
}

/** True when narrowing to deprecated components changes the series, or when it is already on. */
export function offersDeprecatedOnly(sel: DeprecatableSelector, share: DeprecatedShare): boolean {
  return sel.deprecatedOnly === true || (share.deprecated > 0 && share.deprecated < share.total);
}

export function deprecatedShareText({ deprecated, total }: DeprecatedShare, name: string): string | null {
  if (total === 0) return null;
  return `${deprecated} of ${total} ${total === 1 ? "component" : "components"} in ${name} ${deprecated === 1 ? "is" : "are"} deprecated`;
}

export function tagsInUse(tags: LibraryTag[], components: PickableComponent[]): LibraryTag[] {
  const packages = new Set(components.flatMap((c) => (c.packageName === null ? [] : [c.packageName])));
  return tags.filter((t) => [...packages].some((p) => tagMatchesPackage(t, p)));
}
