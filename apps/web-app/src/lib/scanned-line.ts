import type { ScanScope } from "@scoutui/scan-format";

const GLOB = /[*?[\]{}!]/;

/** An `exclude` entry as the folder or file it names, or null for a glob. */
function leftOutPath(entry: string): string | null {
  const path = entry.replace(/^\.\//, "").replace(/\/\*\*$/, "").replace(/\/+$/, "");
  return path !== "" && !GLOB.test(path) ? path : null;
}

/** True when the path's last segment has an extension: a dot after its first character. */
function isFile(path: string): boolean {
  return path.slice(path.lastIndexOf("/") + 1).lastIndexOf(".") > 0;
}

/** A piece of the Scanned line: text, with the patterns it counts in `title` when it has one, or a path. */
export type ScannedPart = { text: string; title?: string } | { path: string };

/** `parts` separated by `, `. */
function commaList(parts: ScannedPart[]): ScannedPart[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [{ text: ", " }, part]));
}

/** What the scan covered, as the repo page says it; null when it covered the whole repository or doesn't say. */
export function scannedLine(scope: ScanScope | null): ScannedPart[] | null {
  if (scope === null) return null;
  const inFolder = (path: string) => (scope.folder === "" ? path : `${scope.folder}/${path}`);
  const what =
    scope.include !== undefined
      ? commaList(scope.include.map((pattern) => ({ path: inFolder(pattern) })))
      : scope.folder !== ""
        ? [{ path: `${scope.folder}/` }]
        : null;
  const leftOut: ScannedPart[] = [];
  const patterns: string[] = [];
  for (const entry of scope.exclude) {
    const path = leftOutPath(entry);
    if (path === null) patterns.push(inFolder(entry));
    else leftOut.push({ path: isFile(path) ? inFolder(path) : `${inFolder(path)}/` });
  }
  const except = commaList(leftOut);
  if (patterns.length > 0) {
    if (leftOut.length > 0) except.push({ text: ", and " });
    except.push({ text: `files matching ${patterns.length} ${patterns.length === 1 ? "pattern" : "patterns"}`, title: patterns.join("\n") });
  }
  if (what === null) return except.length > 0 ? [{ text: "Scanned: everything except " }, ...except, { text: "." }] : null;
  return except.length > 0
    ? [{ text: "Scanned: " }, ...what, { text: ", except " }, ...except, { text: "." }]
    : [{ text: "Scanned: " }, ...what, { text: " only." }];
}
