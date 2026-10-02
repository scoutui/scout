const SCOPED_SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/;
const UNSCOPED_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Extract the npm package name from a module specifier. Null when the
 * specifier does not start with a valid npm package name.
 *
 * - `react`               → `react`
 * - `@org/pkg`            → `@org/pkg`
 * - `@org/pkg/sub/path`   → `@org/pkg`
 * - `./foo` / `../bar`    → null (relative)
 * - `/abs/path`           → null (absolute)
 * - `~/x`, `#x`           → null (alias, subpath import)
 * - `@/components/X`      → null (empty scope: an alias)
 *
 * Used by identity stamping (engine/index.ts), by workspace-sibling
 * detection (wrapper-folding.ts) and by the CLI's external-leaf walk, which
 * slices a public entry against the package name it was imported by. It lives
 * in its own module to avoid a circular import.
 */
export function packageNameFromSpecifier(specifier: string): string | null {
  if (/^[./~#]/.test(specifier)) return null;
  const [first = "", second = ""] = specifier.split("/");
  if (first.startsWith("@")) {
    return SCOPED_SEGMENT.test(first.slice(1)) && SCOPED_SEGMENT.test(second) ? `${first}/${second}` : null;
  }
  return UNSCOPED_NAME.test(first) ? first : null;
}

/**
 * Module-file extensions stripped from a derived subpath so that spelling
 * variants of the same import collapse to one identity: `@x/pkg/react/button`
 * and `@x/pkg/react/button.js` resolve to the same module and must hash to the
 * same component id. Non-module extensions (`.css`, `.json`, ...) are left
 * intact: they denote genuinely distinct subpath targets.
 */
const MODULE_EXTENSIONS = [".tsx", ".ts", ".mts", ".cts", ".jsx", ".js", ".mjs", ".cjs", ".vue"];

function stripModuleExtension(subpath: string): string {
  for (const ext of MODULE_EXTENSIONS) {
    if (subpath.endsWith(ext)) return subpath.slice(0, -ext.length);
  }
  return subpath;
}

/**
 * The POSIX subpath after the package name for an external import specifier,
 * with any trailing module extension stripped. Returns `undefined` for bare
 * package specifiers (`react`, `@org/pkg`). Derived from the specifier string
 * alone, whether or not module resolution succeeded.
 *
 * Every derivation of an external import's `publicEntry` goes through here:
 * `publicEntry` is part of a package export's identity, so spelling variance
 * would split one logical component into several identities.
 */
export function externalSubpath(pkg: string, specifier: string): string | undefined {
  if (specifier.length > pkg.length + 1 && specifier.startsWith(`${pkg}/`)) {
    return stripModuleExtension(specifier.slice(pkg.length + 1));
  }
  return undefined;
}
