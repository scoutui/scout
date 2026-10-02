import type { Component } from "@scoutui/scan-format";

type UsageKind = Component["usage"];

/** The definition of "used": usage === "direct". */
export function isUsed(c: { usage: UsageKind }): boolean {
  return c.usage === "direct";
}

/** Headline dedup key: the component id, which is stable across repos for a
 *  package export or tag and names its repo for a repository declaration. */
export function usedComponentKey(c: { id: string }): string {
  return c.id;
}

/** Total order over usage kinds: direct > root > none. */
const USAGE_RANK: Record<UsageKind, number> = {
  none: 0,
  root: 1,
  direct: 2,
};

/** Merge two usage observations of the same component identity (e.g. seen in
 *  different repo scans) into the strongest one. A component used directly in
 *  one repo is "used" overall even if another repo only reached it via
 *  root/none. Every cross-repo usage rollup goes through this. */
export function strongerUsage(a: UsageKind, b: UsageKind): UsageKind {
  return USAGE_RANK[a] >= USAGE_RANK[b] ? a : b;
}
