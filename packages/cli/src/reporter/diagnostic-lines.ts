import type { Diagnostic } from "../diagnostic.js";

type Warning = Extract<Diagnostic, { severity: "warning" }>;

function assertUnreachable(x: never): never {
  throw new Error(`Unhandled diagnostic code: ${(x as { code: string }).code}`);
}

/** The line printed under `Warning:` for a warning diagnostic. */
export function formatWarning(d: Warning): string {
  switch (d.code) {
    case "cycle-detected":
      return `The re-exports of ${d.exportName} in ${d.filePath} loop back on themselves, so its uses aren't matched to a component.`;
    case "chain-too-deep":
      return `Stopped following the re-exports of ${d.exportName} after ${d.depth} files (at ${d.filePath}), so its uses aren't matched to a component.`;
    case "lazy-import-unsupported":
      return `${d.filePath}:${d.line}:${d.column}: couldn't tell which component import('${d.specifier}') loads, so this use isn't counted.`;
    case "auto-import-stale-entry":
      return `${d.filePath} lists ${d.componentName} at ${d.target}, which no longer exists. Regenerate that file (for Nuxt, run npx nuxt prepare) and scan again.`;
    case "auto-import-manifest-missing":
      return "This Nuxt app hasn't been prepared, so auto-imported components aren't counted. Run npx nuxt prepare and scan again.";
    case "file-not-parsed":
      return `Skipped ${d.filePath}: ${d.reason}.`;
    case "dependency-not-installed":
      return d.occurrenceCount === 1
        ? `${d.packageName} is listed in ${d.declaredIn} but isn't installed, so 1 use of it isn't matched to a component. Install your dependencies and scan again.`
        : `${d.packageName} is listed in ${d.declaredIn} but isn't installed, so ${d.occurrenceCount} uses of it aren't matched to a component. Install your dependencies and scan again.`;
    default:
      return assertUnreachable(d);
  }
}

type Info = Extract<Diagnostic, { severity: "info" }>;

function countLine(code: Info["code"], n: number): string {
  switch (code) {
    case "unresolved-reference":
      return n === 1
        ? "1 render couldn't be followed to a component and wasn't counted as a use."
        : `${n} renders couldn't be followed to a component and weren't counted as uses.`;
    case "late-bound-render":
      return n === 1
        ? "1 component passed in as a prop or argument wasn't counted."
        : `${n} components passed in as a prop or argument weren't counted.`;
    default:
      return assertUnreachable(code);
  }
}

/** A scan's diagnostics as printed: a line per warning, and a count per kind of info. */
export function diagnosticLogLines(diagnostics: readonly Diagnostic[]): { warnings: string[]; counts: string[] } {
  const warnings: string[] = [];
  const infoCounts = new Map<Info["code"], number>();
  for (const d of diagnostics) {
    if (d.severity === "warning") warnings.push(formatWarning(d));
    else infoCounts.set(d.code, (infoCounts.get(d.code) ?? 0) + 1);
  }
  return { warnings, counts: [...infoCounts].map(([code, n]) => countLine(code, n)) };
}
