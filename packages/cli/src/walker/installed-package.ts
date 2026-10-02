import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Whether `packageName` is installed where Node looks for it from the
 * absolute path `fromFile`: a `node_modules/<packageName>/package.json` in
 * the file's directory or any ancestor.
 */
export function isInstalledPackage(fromFile: string, packageName: string): boolean {
  let dir = dirname(fromFile);
  while (true) {
    if (existsSync(join(dir, "node_modules", packageName, "package.json"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}
