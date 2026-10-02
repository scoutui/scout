import type { ImportRecord, InferredType, Reference } from "../index.js";
import type { OpaqueSemantics } from "./denotation.js";

/**
 * The library stub table. Names a small, fixed set of framework
 * exports the engine can never parse (they live in node_modules), so that
 * calls over them resolve structurally instead of falling to the
 * opaque-HOC heuristic.
 *
 * Two kinds of entry:
 *
 * - `identity-preserving`: `Function([ParameterOf(ref, 0)])`, which is what
 *   React's `memo` and `forwardRef` are (the returned component renders
 *   exactly the wrapped argument). `walkReturnTypeOf`'s structural
 *   pass-through step folds these to the argument with a `hoc-wrapper` via.
 * - `non-component-product`: the call produces a framework value that is
 *   provably not a component (`createContext`). The walker names it with the
 *   entry's `OpaqueSemantics`.
 *
 * An entry is a structural fact about an export the engine cannot parse, not
 * a name allowlist over user code: a user-defined `memo` or `createContext` in
 * a local file never reaches here because the check runs on the import
 * record's specifier, not on the symbol.
 *
 * Add to this table only when a library export is (a) unparseable and
 * (b) provably identity-preserving or provably not a component. Anything else
 * belongs in the engine's general rules.
 */
export type LibraryExport =
  | { kind: "identity-preserving" }
  | { kind: "non-component-product"; semantics: OpaqueSemantics };

const STUBBED_PACKAGES: ReadonlySet<string> = new Set(["react", "preact", "preact/compat"]);

const LIBRARY_EXPORTS: ReadonlyMap<string, LibraryExport> = new Map<string, LibraryExport>([
  ["memo", { kind: "identity-preserving" }],
  ["forwardRef", { kind: "identity-preserving" }],
  ["createContext", { kind: "non-component-product", semantics: "context" }],
]);

/**
 * The export name a stubbed package's import names at this reference.
 *
 * `import { memo } from "react"` → imported === "memo", no member chain.
 * `import React from "react"; React.memo` → imported === "default", chain ["memo"].
 * `import * as R from "react"; R.memo` → imported === "*", chain ["memo"].
 *
 * Null when the package is not stubbed, or the chain reaches past the export.
 */
function stubbedExportName(imp: ImportRecord, ref: Reference): string | null {
  if (!STUBBED_PACKAGES.has(imp.specifier)) return null;
  const isNamespaceOrDefault = imp.imported === "default" || imp.imported === "*";
  const exportName = isNamespaceOrDefault ? ref.memberChain[0] : imp.imported;
  if (exportName === undefined) return null;
  const chainConsumed = isNamespaceOrDefault ? 1 : 0;
  return ref.memberChain.length === chainConsumed ? exportName : null;
}

/** The table entry this import + reference names, or null. */
export function libraryExportFor(imp: ImportRecord, ref: Reference): LibraryExport | null {
  const exportName = stubbedExportName(imp, ref);
  return exportName === null ? null : (LIBRARY_EXPORTS.get(exportName) ?? null);
}

/** The structural type of an identity-preserving entry; null for every other
 *  entry and for every reference the table does not name. */
export function libraryStubFor(imp: ImportRecord, ref: Reference): InferredType | null {
  return libraryExportFor(imp, ref)?.kind === "identity-preserving"
    ? { kind: "Function", returns: [{ kind: "ParameterOf", fn: ref, index: 0 }] }
    : null;
}
