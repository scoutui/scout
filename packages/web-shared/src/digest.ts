import type { Component } from "@scoutui/scan-format";

/**
 * The component fields the cohort projections read. A full scan-file `Component`
 * satisfies it, so artifact-shaped callers can pass one.
 */
export type ComponentDigest = Pick<Component, "id" | "identity" | "framework" | "attribution" | "owningPackage" | "usage"> & {
  stats: Pick<Component["stats"], "occurrenceCount">;
};

/** One scan's component digests, shaped like an artifact (nested `meta`). */
export type DigestScan = {
  meta: { scanId: string; committedAt: string; arrivedAt: string; repo: { id: string; branchPosition?: number | undefined } };
  components: ComponentDigest[];
};

export function toComponentDigest(c: Component): ComponentDigest {
  return {
    id: c.id,
    identity: c.identity,
    ...(c.framework !== undefined ? { framework: c.framework } : {}),
    ...(c.attribution !== undefined ? { attribution: c.attribution } : {}),
    ...(c.owningPackage !== undefined ? { owningPackage: c.owningPackage } : {}),
    stats: { occurrenceCount: c.stats.occurrenceCount },
    usage: c.usage,
  };
}

