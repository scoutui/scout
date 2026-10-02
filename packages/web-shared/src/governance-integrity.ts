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

export function validateGovernanceInput(
  input: GovernanceInput,
  existing: GovernanceRecord[],
): GovernanceConflict | null {
  const [field] = invalidGovernanceFields(input);
  if (field) return { kind: "invalid_field", field };

  // A record editing itself is not its own conflict.
  const others = existing.filter((r) => r.id !== input.id);
  const self = targetKey(input.targetPackage, input.targetExport);

  const duplicate = others.find((r) => targetKey(r.targetPackage, r.targetExport) === self);
  if (duplicate) return { kind: "target_governed", existingId: duplicate.id };

  const successor = successorKey(input.disposition);
  if (successor !== null) {
    if (successor === self) return { kind: "self_supersession" };
    const cycle = findCycle(self, successor, others);
    if (cycle) return { kind: "cycle", via: displayKey(cycle) };
  }

  if (input.grain === "component") {
    const pkg = others.find((r) => r.grain === "package" && r.targetPackage === input.targetPackage);
    if (pkg) {
      return { kind: "package_grain_overlap", existingId: pkg.id, packageName: input.targetPackage };
    }
  } else {
    const components = others.filter(
      (r) => r.grain === "component" && r.targetPackage === input.targetPackage,
    );
    if (components.length > 0) {
      return {
        kind: "component_grain_overlap",
        existingIds: components.map((r) => r.id),
        packageName: input.targetPackage,
      };
    }
  }

  return null;
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
