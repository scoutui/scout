import { parseCompoundExport } from "@scoutui/scan-format";
import type { GovernanceRecord, MigrationStatus } from "./dto.js";
import type { DigestScan } from "./digest.js";
import { governanceKey, type PresentableComponent } from "./present-identity.js";

/** What governance resolves: a package, and an export or tag name in it (null for the package itself). */
export type GovernanceLookup = { packageName: string; name: string | null };

/** The fields of a governance record that decide what it matches. */
export type GovernanceRule = Pick<GovernanceRecord, "grain" | "targetPackage" | "targetExport">;

/**
 * The record governing a lookup, or null. Precedence: a component-grain record on
 * the exact name, then a component-grain record on the name's compound root
 * (`Dialog` governs `Dialog.Popup`), then the package-grain record. A null lookup
 * (an ungovernable component) is never governed. Every governance question
 * resolves through this lookup.
 */
export function governingRecord<R extends GovernanceRule>(lookup: GovernanceLookup | null, records: R[]): R | null {
  if (lookup === null) return null;
  const { packageName, name } = lookup;
  const componentRecord = (target: string | null) =>
    records.find((r) => r.grain === "component" && r.targetPackage === packageName && r.targetExport === target);
  const exact = componentRecord(name);
  if (exact) return exact;
  if (name !== null) {
    const { root, isCompound } = parseCompoundExport(name);
    if (isCompound) {
      const rootRecord = componentRecord(root);
      if (rootRecord) return rootRecord;
    }
  }
  return records.find((r) => r.grain === "package" && r.targetPackage === packageName) ?? null;
}

/** The lifecycle status of a lookup: its governing record's disposition, or active. */
export function resolveGovernance(lookup: GovernanceLookup | null, records: GovernanceRecord[]): MigrationStatus {
  const record = governingRecord(lookup, records);
  return record ? statusFrom(record) : { status: "active" };
}

function statusFrom(r: GovernanceRecord): MigrationStatus {
  switch (r.disposition.kind) {
    case "superseded":
      return { status: "superseded", by: r.disposition.by };
    case "retired":
      return { status: "retired", reason: r.disposition.reason };
  }
}

export function isDeprecated(s: MigrationStatus): boolean {
  return s.status !== "active";
}

/**
 * Whether a component is deprecated in its own scan: its `governanceKey` has a
 * governing record. The single per-component deprecation seam, shared by the read
 * models, the query view, scan diff and cohort matching.
 */
export function componentDeprecated(component: PresentableComponent, records: GovernanceRecord[]): boolean {
  return isDeprecated(resolveGovernance(governanceKey(component), records));
}

/**
 * The ids of the components one rule governs in one scan. A package-grain rule
 * takes everything in its package. A component-grain rule takes the components
 * whose `governingRecord` among it and every component-grain record in `records`
 * is the rule: its exact name at any public entry, and its compound members
 * that have no record of their own. A tag is matched only in a scan that
 * resolves it to the package.
 */
export function governedComponentIds(rule: GovernanceRule, scan: DigestScan, records: GovernanceRule[]): Set<string> {
  // The rule goes first so it wins a tie with a record on the same target.
  const rules = rule.grain === "package" ? [rule] : [rule, ...records.filter((r) => r.grain === "component" && r !== rule)];
  const ids = new Set<string>();
  for (const c of scan.components) {
    if (governingRecord(governanceKey(c), rules) === rule) ids.add(c.id);
  }
  return ids;
}

/** Order-independent cache-key fingerprint; changes on any record edit. */
export function governanceHash(records: GovernanceRecord[]): string {
  if (records.length === 0) return "-";
  return records
    .map((r) => `${r.grain}:${r.targetPackage}:${r.targetExport ?? ""}:${JSON.stringify(r.disposition)}:${r.updatedAt}`)
    .sort()
    .join("|");
}

/** A selectable governance target. Package grain omits `exportName`. */
export type GovernanceTarget = { packageName: string; exportName?: string };

/**
 * Every governable identity ever scanned, as governance targets for the record
 * picker. Every scan counts, not only the latest, so an identity that has left the
 * latest scans (migration finished, code deleted) can still be marked superseded
 * or retired.
 *
 * Each component contributes its `governanceKey` (the key `governedComponentIds`
 * matches on), so everything offered here governs a real component: package
 * exports at any public entry, and tags in the scans that resolve them to a
 * package. Each key's package is also offered at package grain.
 *
 * Sorted, so the picker order does not depend on scan iteration order.
 */
export function listGovernanceTargets(scans: DigestScan[]): GovernanceTarget[] {
  const packages = new Set<string>();
  const components = new Map<string, GovernanceTarget>();

  for (const scan of scans) {
    for (const c of scan.components) {
      const key = governanceKey(c);
      if (key === null) continue;
      packages.add(key.packageName);
      components.set(`${key.packageName}\u0000${key.name}`, { packageName: key.packageName, exportName: key.name });
    }
  }

  const sorted = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b));
  return [
    ...sorted([...packages]).map((packageName) => ({ packageName })),
    ...sorted([...components.keys()]).map((k) => components.get(k) as GovernanceTarget),
  ];
}
