import { parse } from "@babel/parser";
import * as t from "@babel/types";
import type { File as BabelFile } from "@babel/types";

export type BarrelReExport =
  | { kind: "star"; from: string }
  | { kind: "namespace"; from: string; exported: string }
  | {
      kind: "named";
      from: string;
      names: Array<{ local: string; exported: string }>;
    }
  | { kind: "own"; exported: string };

/**
 * Extract the top-level exports of a JS/TS source file: `export * from "X"`
 * (`star`), `export * as NS from "X"` (`namespace`), `export { ... } from "X"`
 * (`named`), and every name the file exports itself (`own`: an exported
 * declaration, `export { x }` or `export default`).
 *
 * Type-only exports (`export type { ... }`, `export type * from`) are skipped.
 * Side-effect imports and dynamic exports are skipped.
 * CJS re-exports (`module.exports = ...`) and conditional re-exports are
 * unsupported: they contribute nothing here, so barrel chains built on them
 * read as terminal.
 *
 * Returns [] on parse failure rather than throwing.
 */
export function parseBarrelTopLevel(source: string): BarrelReExport[] {
  let ast: BabelFile;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    return [];
  }
  return parseBarrelTopLevelFromAst(ast);
}

/**
 * AST-taking variant of {@link parseBarrelTopLevel}, for callers that parse
 * with their own parser options (the lazy resolver).
 *
 * Performs the same top-level analysis on `ast.program`, without re-parsing.
 */
export function parseBarrelTopLevelFromAst(ast: BabelFile): BarrelReExport[] {
  const reExports: BarrelReExport[] = [];
  for (const node of ast.program.body) {
    if (t.isExportAllDeclaration(node)) {
      if (node.exportKind !== "type") reExports.push({ kind: "star", from: node.source.value });
      continue;
    }
    if (t.isExportDefaultDeclaration(node)) {
      reExports.push({ kind: "own", exported: "default" });
      continue;
    }
    if (t.isExportNamedDeclaration(node)) {
      if (node.exportKind === "type") continue;
      if (!node.source) {
        for (const exported of ownExportNames(node)) reExports.push({ kind: "own", exported });
        continue;
      }
      const onlySpec = node.specifiers[0];
      if (
        node.specifiers.length === 1 &&
        onlySpec &&
        t.isExportNamespaceSpecifier(onlySpec)
      ) {
        reExports.push({ kind: "namespace", from: node.source.value, exported: onlySpec.exported.name });
        continue;
      }
      const namesPart: Array<{ local: string; exported: string }> = [];
      for (const spec of node.specifiers) {
        if (!t.isExportSpecifier(spec)) continue;
        if (spec.exportKind === "type") continue;
        const local = spec.local.name;
        const exported = t.isIdentifier(spec.exported)
          ? spec.exported.name
          : spec.exported.value;
        namesPart.push({ local, exported });
      }
      if (namesPart.length === 0) continue;
      reExports.push({ kind: "named", from: node.source.value, names: namesPart });
    }
  }
  return reExports;
}

/** The value names an `export` with no `from` gives the file: its declared
 *  names, or its `export { … }` specifiers. */
function ownExportNames(node: t.ExportNamedDeclaration): string[] {
  const decl = node.declaration;
  if (t.isTSEnumDeclaration(decl)) return [decl.id.name];
  if (decl) return Object.keys(t.getOuterBindingIdentifiers(decl));
  return node.specifiers.flatMap((spec) =>
    t.isExportSpecifier(spec) && spec.exportKind !== "type"
      ? [t.isIdentifier(spec.exported) ? spec.exported.name : spec.exported.value]
      : [],
  );
}
