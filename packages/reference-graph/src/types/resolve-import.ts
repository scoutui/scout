/**
 * Function type for "where does this import specifier point?", consumed by
 * the lazy resolver and the engine's module-resolution path (graph traversal
 * + bounded definition resolver). Implementation lives in
 * `cli/src/walker/resolve-import.ts` (knows about node-resolve quirks,
 * tsconfig paths, config aliases). Type lives here so the parsers
 * and the engine can depend on it without depending on the CLI.
 *
 * Returns the absolute file path the specifier resolves to, or null if no
 * resolution layer matches.
 */
export type ResolveImport = (from: string, spec: string) => string | null;
