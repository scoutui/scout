import { createHash } from "node:crypto";

/**
 * Stable per-occurrence id keyed on (componentId, filePath, line, column,
 * ownerComponentId?).
 *
 * Inputs are the final artifact id strings (an occurrence's
 * `resolution.componentId` and `ownerComponentId`), so a consumer can
 * re-derive a resolved occurrence's id:
 *   id === computeOccurrenceId(o.resolution.componentId, o.filePath, o.line, o.column, o.ownerComponentId)
 *
 * `ownerComponentId` is hashed so one call site that resolves to several
 * owners (helper-call fanout) gets a distinct id per owner. Without an owner,
 * the hash has no owner segment.
 *
 * The id is the first 16 hex characters of a SHA-256 (64 bits), so collisions
 * become likely around 4 billion occurrences.
 */
export function computeOccurrenceId(
  componentId: string,
  filePath: string,
  line: number,
  column: number,
  ownerComponentId?: string,
): string {
  const base = `${componentId}|${filePath}|${line}|${column}`;
  const key = ownerComponentId !== undefined ? `${base}|${ownerComponentId}` : base;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
