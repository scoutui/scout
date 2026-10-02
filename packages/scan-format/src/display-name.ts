import { parseCompoundExport } from "./compound-export.js";
import type { Identity } from "./schema.js";

/**
 * The name Scout shows for a component, on the dashboard and in the scan summary. A package's default export
 * (exportName "default") is named after the last segment of its public entry (`next/link` → "link"), or the package
 * name at the root entry. A compound member of a default export (`default.Header`) keeps its member chain after that
 * name: `Modal.Header`. A tag is its tag name.
 */
export function displayNameOf(c: { identity: Identity }): string {
  const id = c.identity;
  if (id.kind === "tag") return id.tagName;
  if (id.kind === "package-export") {
    const { root, path, isCompound } = parseCompoundExport(id.exportName);
    if (root === "default") {
      const base = id.publicEntry.split("/").filter(Boolean).pop() ?? id.packageName;
      return isCompound ? `${base}.${path.join(".")}` : base;
    }
  }
  return id.exportName;
}
