import type { Disposition, GovernanceInput, GovernanceRecord } from "./dto.js";
import { isDeprecated, resolveGovernance } from "./governance.js";

/**
 * A save that must not proceed. The server action calls `validateGovernanceInput`
 * before any write, and the guard UX renders `conflictMessage`. Grain overlap is
 * blocked rather than modelled, so every component has at most one governing record.
 */
export type GovernanceConflict =
  | { kind: "invalid_field"; field: GovernanceField }
  | { kind: "target_governed"; existingId: string }
  | { kind: "self_supersession" }
  | { kind: "cycle"; via: string }
  | { kind: "package_grain_overlap"; existingId: string; packageName: string }
  | { kind: "component_grain_overlap"; existingIds: string[]; packageName: string };

const NUL = "\u0000";
const targetKey = (packageName: string, exportName: string | null): string =>
  `${packageName}${NUL}${exportName ?? ""}`;
const successorKey = (d: Disposition): string | null =>
  d.kind === "superseded" ? targetKey(d.by.packageName, d.by.exportName ?? null) : null;
const displayKey = (key: string): string => {
  const [pkg, exp] = key.split(NUL);
  return exp ? `${pkg}/${exp}` : (pkg ?? "");
};

/** A save field that is blank, or set where the record's grain forbids it. */
export type GovernanceField = "targetPackage" | "targetExport" | "successor" | "reason";

const blank = (value: string | null | undefined): boolean => !value?.trim();

/**
 * The fields a save gets wrong, in form order. The form shows each one next to
 * its field; `validateGovernanceInput` refuses on the first.
 */
export function invalidGovernanceFields(input: GovernanceInput): GovernanceField[] {
  const fields: GovernanceField[] = [];
  if (blank(input.targetPackage)) fields.push("targetPackage");
  else if (input.grain === "component" ? blank(input.targetExport) : input.targetExport !== null)
    fields.push("targetExport");
  if (input.disposition.kind === "superseded" && blank(input.disposition.by.packageName))
    fields.push("successor");
  if (input.disposition.kind === "retired" && blank(input.disposition.reason)) fields.push("reason");
  return fields;
}

/** The kinds of conflict a target alone causes, whatever replaces it. */
export type TargetConflict = Extract<
  GovernanceConflict,
  { kind: "target_governed" | "package_grain_overlap" | "component_grain_overlap" }
>;

/**
 * Whether a target can take a record: not when a record has the same target, nor
 * when a record at the other grain covers its package. The record being edited
 * (`editingId`) doesn't count.
 */
export function targetConflict(
  target: Pick<GovernanceInput, "grain" | "targetPackage" | "targetExport">,
  existing: GovernanceRecord[],
  editingId?: string,
): TargetConflict | null {
  const others = existing.filter((r) => r.id !== editingId);
  const self = targetKey(target.targetPackage, target.targetExport);

  const duplicate = others.find((r) => targetKey(r.targetPackage, r.targetExport) === self);
  if (duplicate) return { kind: "target_governed", existingId: duplicate.id };

  if (target.grain === "component") {
    const pkg = others.find((r) => r.grain === "package" && r.targetPackage === target.targetPackage);
    return pkg
      ? { kind: "package_grain_overlap", existingId: pkg.id, packageName: target.targetPackage }
      : null;
  }
  const components = others.filter(
    (r) => r.grain === "component" && r.targetPackage === target.targetPackage,
  );
  return components.length > 0
    ? {
        kind: "component_grain_overlap",
        existingIds: components.map((r) => r.id),
        packageName: target.targetPackage,
      }
    : null;
}

export function validateGovernanceInput(
  input: GovernanceInput,
  existing: GovernanceRecord[],
): GovernanceConflict | null {
  const [field] = invalidGovernanceFields(input);
  if (field) return { kind: "invalid_field", field };

  const target = targetConflict(input, existing, input.id);
  if (target?.kind === "target_governed") return target;

  const successor = successorKey(input.disposition);
  if (successor !== null) {
    const self = targetKey(input.targetPackage, input.targetExport);
    if (successor === self) return { kind: "self_supersession" };
    const cycle = findCycle(self, successor, existing.filter((r) => r.id !== input.id));
    if (cycle) return { kind: "cycle", via: displayKey(cycle) };
  }

  return target;
}

/**
 * Walk the successor chain from `start`; report the hop that leads back to
 * `self`. A chain that ends, or loops among records the user is not editing,
 * is not this save's problem: chains stay legal.
 */
function findCycle(self: string, start: string, others: GovernanceRecord[]): string | null {
  const byTarget = new Map(others.map((r) => [targetKey(r.targetPackage, r.targetExport), r]));
  const seen = new Set<string>();
  let cursor: string | null = start;
  while (cursor !== null) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const record = byTarget.get(cursor);
    const next = record ? successorKey(record.disposition) : null;
    if (next === self) return cursor;
    cursor = next;
  }
  return null;
}

/** The message for a blocked save: the rule and the way out. */
export function conflictMessage(c: GovernanceConflict): string {
  switch (c.kind) {
    case "invalid_field":
      return "Couldn't save the record. Reload the page and try again.";
    case "target_governed":
      return "This package or component already has a record. Edit that record instead.";
    case "self_supersession":
      return "It can't be superseded by itself. Choose another.";
    case "cycle":
      return `That would make a loop: ${c.via} is already superseded by this one. Choose another.`;
    case "package_grain_overlap":
      return `${c.packageName} already has a record for the whole package. Edit that record, or remove it to add records for single components.`;
    case "component_grain_overlap":
      return `${c.packageName} already has ${c.existingIds.length === 1 ? "a record for one of its components" : `records for ${c.existingIds.length} of its components`}. Remove ${c.existingIds.length === 1 ? "it" : "them"} to add a record for the whole package.`;
  }
}

/**
 * Whether this record's successor is itself governed (a chain). Legal, but
 * flagged on the record's registry row.
 */
export function successorDeprecated(
  record: GovernanceRecord,
  records: GovernanceRecord[],
): boolean {
  if (record.disposition.kind !== "superseded") return false;
  const { packageName, exportName } = record.disposition.by;
  return isDeprecated(resolveGovernance({ packageName, name: exportName ?? null }, records));
}
