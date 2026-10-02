import type { CohortSelector } from "@scoutui/web-shared";
import { tagMatchesPackage } from "@scoutui/web-shared/client";
import type { PickableComponent } from "@/components/dashboards/series-picker";
import type { LibraryTag } from "@/lib/chart-builder-series";

type OverlapContext = { components: PickableComponent[]; packages: string[]; tags: LibraryTag[] };
type Kind<K extends CohortSelector["kind"]> = Extract<CohortSelector, { kind: K }>;

function componentCanJoin(sel: Kind<"component">, other: Kind<"package" | "tag">, context: OverlapContext): boolean {
  const component = context.components.find((c) => c.componentId === sel.componentId);
  if (!component) return true;
  if (other.kind === "package") return component.packageName === other.packageName;
  const tag = context.tags.find((t) => t.id === other.tagId);
  if (!tag) return true;
  return component.packageName !== null && tagMatchesPackage(tag, component.packageName);
}

function tagCanJoin(sel: Kind<"tag">, other: Kind<"package" | "tag">, context: OverlapContext): boolean {
  const tag = context.tags.find((t) => t.id === sel.tagId);
  if (!tag) return true;
  if (other.kind === "package") return tagMatchesPackage(tag, other.packageName);
  const otherTag = context.tags.find((t) => t.id === other.tagId);
  if (!otherTag) return true;
  return context.packages.some((p) => tagMatchesPackage(tag, p) && tagMatchesPackage(otherTag, p));
}

function pairCanOverlap(a: CohortSelector, b: CohortSelector, context: OverlapContext): boolean {
  if (a.kind === "local" || b.kind === "local") return true;
  if (a.kind === "component") return b.kind === "component" ? a.componentId === b.componentId : componentCanJoin(a, b, context);
  if (b.kind === "component") return componentCanJoin(b, a, context);
  if (a.kind === "tag") return tagCanJoin(a, b, context);
  if (b.kind === "tag") return tagCanJoin(b, a, context);
  return false;
}

/** True when any two of the series can count the same component. */
export function seriesCanOverlap(cohorts: CohortSelector[], context: OverlapContext): boolean {
  return cohorts.some((a, i) => cohorts.slice(i + 1).some((b) => pairCanOverlap(a, b, context)));
}
