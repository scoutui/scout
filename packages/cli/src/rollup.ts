/**
 * Folds the resolved occurrence stream plus per-component rows (identity and
 * descriptive fields) into rolled-up components.
 *
 * Math invariant per prop:
 *   sum(values[].count) + dynamic + (other ?? 0) + omitted === stats.occurrenceCount
 *
 * Components with zero occurrences still emit identity + zeroed stats.
 */

import type {
  Component,
  PropDistribution,
  PropValueEntry,
  PropValueState,
  ResolvedOccurrence,
} from "@scoutui/scan-format";
import { isHandlerName } from "@scoutui/reference-graph";
import { isFrameworkRootPath } from "./scan/framework-root.js";

/** One component's descriptive fields, before its occurrences are rolled up. */
export type ComponentRow = Pick<
  Component,
  "id" | "identity" | "framework" | "attribution" | "declared" | "definition" | "owningPackage"
> & {
  /** True when the local definition is `export default` (root eligibility). */
  isDefaultExport?: boolean;
};

/** A rolled-up component before `applyCompositionRollup` adds its composition. */
export type RolledComponent = Omit<Component, "composition">;

const CARDINALITY_CAP = 100;

const stringifyLiteral = (v: string | number | boolean | null): string =>
  v === null ? "null" : String(v);

const canonicalSet = (vs: (string | number | boolean)[]): (string | number | boolean)[] =>
  [...new Set(vs)].sort((a, b) => stringifyLiteral(a).localeCompare(stringifyLiteral(b)));

function bucketKey(v: Exclude<PropValueState, { tier: "dynamic" }>): string {
  if (v.tier === "reference") return `r:${v.ref}`;
  if ("valueSet" in v) return `ws:${JSON.stringify(canonicalSet(v.valueSet))}`;
  // written scalar
  const val = v.value;
  return `w:${val === null ? "null" : `${typeof val}:${String(val)}`}`;
}

function newEntry(v: Exclude<PropValueState, { tier: "dynamic" }>): PropValueEntry {
  if (v.tier === "reference") return { provenance: "reference", ref: v.ref, count: 0 };
  return "valueSet" in v
    ? { provenance: "written", valueSet: canonicalSet(v.valueSet), count: 0 }
    : { provenance: "written", value: v.value, count: 0 };
}

function buildDistribution(name: string, occs: ResolvedOccurrence[]): PropDistribution {
  let dynamic = 0;
  let omitted = 0;
  const buckets = new Map<string, PropValueEntry>();

  for (const o of occs) {
    if (!(name in o.props)) {
      omitted += 1;
      continue;
    }
    const v = o.props[name] as PropValueState;
    if (v.tier === "dynamic") {
      dynamic += 1;
      continue;
    }
    const key = bucketKey(v);
    const entry = buckets.get(key) ?? newEntry(v);
    entry.count += 1;
    buckets.set(key, entry);
  }

  const values = [...buckets.values()].sort((a, b) => b.count - a.count);
  const dist: PropDistribution = { values, dynamic, omitted };
  if (values.length > CARDINALITY_CAP) {
    const dropped = values.slice(CARDINALITY_CAP);
    dist.values = values.slice(0, CARDINALITY_CAP);
    dist.other = dropped.reduce((s, e) => s + e.count, 0);
    dist.truncated = dropped.length;
  }
  return dist;
}

export function rollupOccurrencesToComponents(
  occurrences: readonly ResolvedOccurrence[],
  rows: readonly ComponentRow[],
): RolledComponent[] {
  const byId = new Map<string, ResolvedOccurrence[]>();
  for (const o of occurrences) {
    const list = byId.get(o.resolution.componentId);
    if (list) {
      list.push(o);
    } else {
      byId.set(o.resolution.componentId, [o]);
    }
  }

  return rows.map((row) => {
    const occs = byId.get(row.id) ?? [];
    const fileSet = new Set<string>();
    const propsSeen = new Set<string>();
    const writtenCounts = new Map<string, number>();

    for (const o of occs) {
      fileSet.add(o.filePath);
      for (const name of Object.keys(o.props)) propsSeen.add(name);
      if (o.writtenName !== undefined) writtenCounts.set(o.writtenName, (writtenCounts.get(o.writtenName) ?? 0) + 1);
    }
    const writtenNames = [...writtenCounts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([name]) => name);

    const props: Record<string, PropDistribution> = {};
    for (const name of propsSeen) props[name] = buildDistribution(name, occs);

    const events: Record<string, { boundCount: number }> = {};
    for (const o of occs) {
      const names = new Set([
        ...(o.events ?? []),
        // on* handlers: an on* name with a dynamic value (a function), so
        // literal on* props like onLabel="On" / onColor="#0f0" are not handlers.
        ...Object.keys(o.props).filter((k) => isHandlerName(k) && (o.props[k] as PropValueState).tier === "dynamic"),
      ]);
      for (const name of names) {
        events[name] = { boundCount: (events[name]?.boundCount ?? 0) + 1 };
      }
    }

    const usage: Component["usage"] =
      occs.length > 0
        ? "direct"
        : row.isDefaultExport === true &&
            row.identity.kind === "repository-declaration" &&
            isFrameworkRootPath(row.identity.filePath)
          ? "root"
          : "none";

    return {
      id: row.id,
      identity: row.identity,
      ...(row.framework !== undefined ? { framework: row.framework } : {}),
      ...(row.attribution !== undefined ? { attribution: row.attribution } : {}),
      stats: { occurrenceCount: occs.length, fileCount: fileSet.size },
      usage,
      props,
      ...(Object.keys(events).length > 0 ? { events } : {}),
      ...(writtenNames.length > 0 ? { writtenNames } : {}),
      ...(row.declared !== undefined ? { declared: row.declared } : {}),
      ...(row.definition !== undefined ? { definition: row.definition } : {}),
      ...(row.owningPackage !== undefined ? { owningPackage: row.owningPackage } : {}),
      version: null,
    };
  });
}
