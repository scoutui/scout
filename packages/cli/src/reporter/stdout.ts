import { displayNameOf, type Component, type ScanArtifact } from "@scoutui/scan-format";
import type { ScanStats } from "../artifact/scan-stats.js";
import { createColor, type Colorizer } from "../util/color.js";
import { packagesNotInstalled } from "../artifact/not-installed.js";

const UNMATCHED_PAGE = "https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences";
const MOST_USED = 5;

/**
 * The summary after a scan: the components and occurrences the dashboard will show, how many occurrences Scout
 * couldn't match to a component, and the most used components with where each comes from. Ends with a blank line.
 */
export function printSummary(
  out: ScanArtifact,
  stats: ScanStats,
  color: Colorizer = createColor({ isTTY: Boolean(process.stdout.isTTY) }),
): void {
  const seconds = (stats.scanDurationMs / 1000).toFixed(1);
  const lines = [
    `Scanned ${counted(stats.filesScanned, "file")} in ${seconds}s: ${counted(stats.componentCount, "component")}, ${counted(stats.resolvedOccurrenceCount, "occurrence")}.`,
  ];
  const unmatched = stats.occurrenceCount - stats.resolvedOccurrenceCount;
  if (unmatched > 0) {
    lines.push(`Scout couldn't match ${unmatched} more ${unmatched === 1 ? "occurrence" : "occurrences"} to a component. See ${UNMATCHED_PAGE}`);
    const packages = packagesNotInstalled(out.occurrences);
    const notInstalled = [...packages.values()].reduce((sum, n) => sum + n, 0);
    if (notInstalled > 0) {
      const verb = notInstalled === 1 ? "is" : "are";
      const from = packages.size === 1 ? "a package that isn't installed" : "packages that aren't installed";
      lines.push(color.yellow(`${notInstalled} of them ${verb} from ${from}. Install your dependencies and scan again.`));
    }
  }
  lines.push("");

  const used = out.components
    .filter((c) => c.stats.occurrenceCount > 0)
    .sort((a, b) => b.stats.occurrenceCount - a.stats.occurrenceCount)
    .slice(0, MOST_USED);
  if (used.length > 0) {
    const rows = used.map((c) => ({ name: nameOf(c), source: sourceOf(c), count: String(c.stats.occurrenceCount) }));
    const nameWidth = Math.max(...rows.map((r) => r.name.length));
    const sourceWidth = Math.max(...rows.map((r) => r.source.length));
    const countWidth = Math.max(...rows.map((r) => r.count.length));
    lines.push("Most used:");
    for (const r of rows) {
      lines.push(`  ${r.name.padEnd(nameWidth)}  ${r.source.padEnd(sourceWidth)}  ${r.count.padStart(countWidth)}`);
    }
    lines.push("");
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** `n` and the noun, singular for 1: `1 file`, `412 files`. */
function counted(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/** The component's name as the dashboard shows it, and a tag's name in angle brackets. */
export function nameOf(c: Component): string {
  return c.identity.kind === "tag" ? `<${c.identity.tagName}>` : displayNameOf(c);
}

/** Where the component comes from: its package, or the file that declares it. Empty for a tag. */
export function sourceOf(c: Component): string {
  if (c.identity.kind === "package-export") return c.identity.packageName;
  if (c.identity.kind === "repository-declaration") return c.identity.filePath;
  return "";
}
