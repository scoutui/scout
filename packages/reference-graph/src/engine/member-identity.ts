import type { InferredType } from "../types/inferred-type.js";

/**
 * Seam: derive the export name a JSX usage attributes to, resolving
 * namespace-import members.
 *
 * `import * as Dialog from "@radix-ui/react-dialog"` records `imported: "*"`;
 * the member that actually names the component lives on the usage's member
 * chain (`<Dialog.Root/>` → `["Root"]`). For such usages the first member-chain
 * segment is the export name, mirroring the identity a named import
 * (`import { Root }; <Root/>`) already produces, so the two spellings converge
 * on one `{package, export}` identity instead of every member collapsing into
 * `export: "*"`.
 *
 * Deeper chains (`<Dialog.Root.Foo/>`) still key on the first segment as the
 * root; the remaining segments are the residual (`residualMemberChain`,
 * below) and are re-joined into the identity by `compoundExportName`.
 * Non-namespace imports and bare namespace usages (`<Dialog/>`, no member)
 * return `imported` unchanged.
 *
 * Every site that derives an export name from `ImportRecord.imported` calls
 * it; the binding resolver (`binding.ts`) routes every import through here.
 * Provenance (`via.import`) keeps the raw `"*"`: it records the actual import
 * statement, which was a namespace import.
 */
export function effectiveExportName(imported: string, memberChain: readonly string[]): string {
  const first = memberChain[0];
  return imported === "*" && first !== undefined ? first : imported;
}

/**
 * The member-chain segments a usage carries beyond the root export.
 * `effectiveExportName` consumes the first segment as the export for a
 * namespace import (`import * as Dialog; <Dialog.Root.Foo/>` → root `Root`,
 * residual `["Foo"]`); every other import form keeps `imported` as the root,
 * so the whole chain is residual (`import { Dialog }; <Dialog.Popup/>` →
 * root `Dialog`, residual `["Popup"]`). A default import's leading `default`
 * member is the default export itself, as CommonJS interop reads it
 * (`import Link; Link.default` → root `default`, residual `[]`). Lookups
 * (re-export chains, default export local names, workspace definitions) key
 * on the root; the identity stamped on the occurrence is
 * `compoundExportName(root, residual)`.
 */
export function residualMemberChain(imported: string, memberChain: readonly string[]): readonly string[] {
  const first = memberChain[0];
  return (imported === "*" && first !== undefined) || (imported === "default" && first === "default")
    ? memberChain.slice(1)
    : memberChain;
}

/**
 * Writes a compound export name: the root export followed by the residual
 * member chain, dot-joined. An empty residual returns the root unchanged.
 * `parseCompoundExport` (`@scoutui/scan-format`) is the matching reader.
 */
export function compoundExportName(root: string, residual: readonly string[]): string {
  return residual.length === 0 ? root : `${root}.${residual.join(".")}`;
}

/**
 * The object-path walk of a compound name's residual: `member` is the value
 * `path` names inside `holder`, followed through nested `Object` props, and
 * `holder` itself for an empty path. When a step is not an `Object` or has no
 * such prop, `member` is undefined and `stoppedOn` is the value that step
 * read the segment from.
 */
export function memberOfObjectPath(
  holder: InferredType | undefined,
  path: readonly string[],
): { member: InferredType | undefined; stoppedOn?: InferredType } {
  let cur = holder;
  for (const segment of path) {
    if (cur?.kind !== "Object") return { member: undefined, ...(cur !== undefined ? { stoppedOn: cur } : {}) };
    const next = cur.props[segment];
    if (next === undefined) return { member: undefined, stoppedOn: cur };
    cur = next;
  }
  return { member: cur };
}
