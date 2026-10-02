import type { AttributionTarget, EvidenceRecord, KnownEvidenceRecord, KnownTagAttribution } from "@scoutui/scan-format";

type Strength = KnownEvidenceRecord["strength"];

/** Strongest class first. */
const STRENGTHS: readonly Strength[] = ["observed", "declared"];

/** A target as JSON with its keys in a fixed order. */
function targetKey(target: AttributionTarget): string {
  return target.kind === "package"
    ? JSON.stringify({ kind: target.kind, packageName: target.packageName })
    : JSON.stringify({ kind: target.kind, repoId: target.repoId, filePath: target.filePath, exportName: target.exportName });
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** File locators before package coordinates; a file's lines in numeric order. */
function compareLocators(a: EvidenceRecord["locator"], b: EvidenceRecord["locator"]): number {
  if ("filePath" in a) return "filePath" in b ? compareText(a.filePath, b.filePath) || a.line - b.line : -1;
  if ("filePath" in b) return 1;
  return compareText(a.packageName, b.packageName) || compareText(a.version ?? "", b.version ?? "");
}

/** Strongest class first, then source, locator and target. */
function compareRecords(a: KnownEvidenceRecord, b: KnownEvidenceRecord): number {
  return (
    STRENGTHS.indexOf(a.strength) - STRENGTHS.indexOf(b.strength) ||
    compareText(a.source, b.source) ||
    compareLocators(a.locator, b.locator) ||
    compareText(a.target !== undefined ? targetKey(a.target) : "", b.target !== undefined ? targetKey(b.target) : "")
  );
}

/**
 * A tag's attribution from every evidence record found for it: the strongest
 * class that carries a target decides. One target there resolves the tag with
 * that class as confidence; several are a conflict; no targeted record leaves
 * it unknown. Every record is kept, sorted, and given its disposition against
 * the outcome, so the result never depends on input order.
 */
export function resolveTagAttribution(evidence: readonly KnownEvidenceRecord[]): KnownTagAttribution {
  const records = [...evidence].sort(compareRecords);
  const strongestClass = STRENGTHS.find((s) => records.some((r) => r.strength === s && r.target !== undefined));

  if (strongestClass === undefined) {
    const unresolved = records.map((r) => withDisposition(r, "unresolved"));
    return { status: "unknown", reason: records.length === 0 ? "absent" : "unresolved", evidence: unresolved };
  }

  const candidates = new Map<string, AttributionTarget>();
  for (const r of records) {
    if (r.strength === strongestClass && r.target !== undefined) candidates.set(targetKey(r.target), r.target);
  }

  if (candidates.size === 1) {
    const [[resolvedKey, target]] = [...candidates] as [[string, AttributionTarget]];
    return {
      status: "resolved",
      target,
      confidence: strongestClass,
      evidence: records.map((r) =>
        withDisposition(r, r.target === undefined ? "unresolved" : targetKey(r.target) === resolvedKey ? "supports" : "contradicts"),
      ),
    };
  }

  return {
    status: "conflict",
    strongestClass,
    candidates: [...candidates.values()].sort((a, b) => compareText(targetKey(a), targetKey(b))),
    evidence: records.map((r) =>
      withDisposition(r, r.target === undefined ? "unresolved" : candidates.has(targetKey(r.target)) ? "candidate" : "contradicts"),
    ),
  };
}

/** The record in schema key order, with `disposition` set. */
function withDisposition(record: KnownEvidenceRecord, disposition: KnownEvidenceRecord["disposition"]): KnownEvidenceRecord {
  return {
    source: record.source,
    strength: record.strength,
    locator: record.locator,
    ...(record.target !== undefined ? { target: record.target } : {}),
    disposition,
  };
}
