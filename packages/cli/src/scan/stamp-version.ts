import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { resolvedOccurrences, type Component, type Occurrence } from "@scoutui/scan-format";

/** The package a component comes from: its own, or its tag's attributed package. */
function packageOf(c: Component): string | undefined {
  if (c.identity.kind === "package-export") return c.identity.packageName;
  if (c.attribution?.status === "resolved" && c.attribution.target.kind === "package") {
    return c.attribution.target.packageName;
  }
  return undefined;
}

/** Reads a package's installed `version`, from the folder of `fromFile` (a scan-file path), or from the scan's root when there's none. */
export type PackageVersionReader = (packageName: string, fromFile: string | undefined) => Promise<string | null>;

/**
 * The installed-version reader: Node-style module resolution from the folder
 * of `fromFile` under `root`, else from `root`. `root` is the root the scan
 * file's paths are relative to. Starting inside the sub-app that uses the
 * package handles monorepos that install dependencies per app
 * (`apps/web/node_modules/`) rather than at the workspace root.
 */
export function installedVersionReader(root: string): PackageVersionReader {
  return (packageName, fromFile) =>
    resolvePackageVersion(fromFile !== undefined ? dirname(resolve(root, fromFile)) : root, packageName);
}

/**
 * The components with the installed `version` of the package each comes
 * from (a package export's package, or a tag's attributed package). The
 * version is read from where the package's first occurrence is
 * (`readVersion`), once per package. Repository declarations and tags
 * attributed to no package keep `version: null`.
 */
export async function withInstalledVersions(
  components: readonly Component[],
  occurrences: readonly Occurrence[],
  readVersion: PackageVersionReader,
): Promise<Component[]> {
  // componentId → packageName for fast occurrence → package lookup.
  const pkgByComponentId = new Map<string, string>();
  for (const c of components) {
    const pkg = packageOf(c);
    if (pkg) pkgByComponentId.set(c.id, pkg);
  }

  // packageName → the file of its first occurrence. A package with none is
  // read from the scan's root.
  const fromFileByPackage = new Map<string, string>();
  for (const o of resolvedOccurrences(occurrences)) {
    const pkg = pkgByComponentId.get(o.resolution.componentId);
    if (pkg && !fromFileByPackage.has(pkg)) fromFileByPackage.set(pkg, o.filePath);
  }

  const versionByPackage = new Map<string, string | null>();
  await Promise.all(
    [...new Set(pkgByComponentId.values())].map(async (name) => {
      versionByPackage.set(name, await readVersion(name, fromFileByPackage.get(name)));
    }),
  );

  return components.map((c) => {
    const pkg = packageOf(c);
    return { ...c, version: pkg ? (versionByPackage.get(pkg) ?? null) : null };
  });
}

/**
 * Walk up the directory tree from `startDir`, trying
 * `<dir>/node_modules/<packageName>/package.json` at each level.
 * Returns the `version` string, or null when not found anywhere.
 */
async function resolvePackageVersion(
  startDir: string,
  packageName: string,
): Promise<string | null> {
  let dir = startDir;
  while (true) {
    const pkgPath = join(dir, "node_modules", packageName, "package.json");
    try {
      const raw = await readFile(pkgPath, "utf8");
      try {
        const pkg = JSON.parse(raw) as { version?: string };
        return pkg.version ?? null;
      } catch {
        // Malformed JSON: the file exists but its version is unreadable.
        return null;
      }
    } catch {
      // File not found or unreadable: try the parent directory.
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root.
      return null;
    }
    dir = parent;
  }
}
