import type { ScanScope } from "@scoutui/scan-format";

const GLOB = /[*?[\]{}!]/;

/** An `exclude` entry as the folder or file it names, or null for a glob. */
function leftOutPath(entry: string): string | null {
  const path = entry.replace(/^\.\//, "").replace(/\/\*\*$/, "").replace(/\/+$/, "");
  return path !== "" && !GLOB.test(path) ? path : null;
}

/** What the scan covered, as the repo page says it; null when it covered the whole repository or doesn't say. */
export function scannedLine(scope: ScanScope | null): string | null {
  if (scope === null) return null;
  const inFolder = (path: string) => (scope.folder === "" ? path : `${scope.folder}/${path}`);
  const what = scope.include !== undefined ? scope.include.map(inFolder).join(", ") : scope.folder !== "" ? scope.folder : null;
  const except = scope.exclude.flatMap((entry) => leftOutPath(entry) ?? []).map(inFolder).join(", ");
  if (what === null) return except ? `Scanned: everything except ${except}.` : null;
  return except ? `Scanned: ${what}, except ${except}.` : `Scanned: ${what} only.`;
}
