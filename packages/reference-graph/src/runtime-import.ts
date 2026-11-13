/**
 * Whether an import declaration loads its module at runtime: a side-effect
 * import (`import "pkg/x.js"`) or one that binds at least one value. A
 * type-only import loads nothing, whether written as `import type { A }` or
 * as `import { type A, type B }`.
 */
export function isRuntimeImport(declaration: {
  importKind?: string | null | undefined;
  specifiers: readonly { type: string; importKind?: string | null | undefined }[];
}): boolean {
  if (declaration.importKind === "type") return false;
  return declaration.specifiers.length === 0 || declaration.specifiers.some((s) => s.importKind !== "type");
}
