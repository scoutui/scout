import { isKind, type ScanArtifact, type TraceStep } from "@scoutui/scan-format";
import { ScanFindingKind, type ScanFinding } from "./dto.js";

const SHOWN_EXAMPLES = 3;

type Tally = { count: number; examples: Map<string, number> };

function field(diagnostic: object, name: string): string | undefined {
  const value = (diagnostic as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function renderedName(diagnostic: object): string | undefined {
  const symbol = field(diagnostic, "symbol");
  const chain = (diagnostic as { memberChain?: unknown }).memberChain;
  if (symbol === undefined) return undefined;
  return Array.isArray(chain) ? [symbol, ...chain.filter(part => typeof part === "string")].join(".") : symbol;
}

function importedSpecifier(trace: TraceStep[]): string | undefined {
  for (const step of trace) if (isKind(step, "import")) return step.specifier;
  return undefined;
}

/**
 * What a scan couldn't see, one finding per kind it reported, in `ScanFindingKind` order: the uses it couldn't match,
 * grouped by reason, its web components that no package or code defines, and the renders and lazy loads it couldn't
 * follow. A diagnostic that repeats what unmatched uses already report (a package that isn't installed, a package's
 * re-exports it couldn't follow) adds nothing.
 */
export function deriveScanFindings(artifact: ScanArtifact): ScanFinding[] {
  const tallies = new Map<ScanFindingKind, Tally>();
  const add = (kind: ScanFindingKind, example: string | undefined, uses = 1) => {
    const tally = tallies.get(kind) ?? { count: 0, examples: new Map<string, number>() };
    tally.count++;
    if (example !== undefined) tally.examples.set(example, (tally.examples.get(example) ?? 0) + uses);
    tallies.set(kind, tally);
  };

  for (const occurrence of artifact.occurrences) {
    if (occurrence.resolution.status !== "unresolved") continue;
    const { reason } = occurrence.resolution;
    if (isKind(reason, "package-not-installed")) add("package-not-installed", reason.packageName);
    else if (isKind(reason, "module-not-found")) add("import-not-found", importedSpecifier(occurrence.trace) ?? occurrence.filePath);
    else if (isKind(reason, "unbound-name")) add("not-imported", reason.name);
    else if (isKind(reason, "chain-bailed")) add("package-exports", importedSpecifier(occurrence.trace) ?? occurrence.filePath);
  }
  for (const component of artifact.components) {
    if (component.identity.kind === "tag" && component.attribution?.status === "unknown") {
      add("undefined-element", `<${component.identity.tagName}>`, component.stats.occurrenceCount);
    }
  }
  for (const diagnostic of artifact.diagnostics) {
    if (diagnostic.code === "auto-import-stale-entry") add("auto-import-missing", field(diagnostic, "componentName"));
    else if (diagnostic.code === "lazy-import-unsupported") add("lazy-import", field(diagnostic, "filePath"));
    else if (diagnostic.code === "unresolved-reference") add("not-matched", renderedName(diagnostic));
    else if (diagnostic.code === "late-bound-render") add("passed-in", renderedName(diagnostic));
  }

  return ScanFindingKind.options.flatMap(kind => {
    const tally = tallies.get(kind);
    if (!tally) return [];
    const ranked = [...tally.examples].map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    return [{ kind, count: tally.count, examples: ranked.slice(0, SHOWN_EXAMPLES), more: Math.max(0, ranked.length - SHOWN_EXAMPLES) }];
  });
}
