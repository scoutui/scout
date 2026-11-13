/**
 * Tags installed packages declare in `HTMLElementTagNameMap`, read from the
 * type declarations of the modules the repo imports.
 *
 * A package's `.d.ts` puts a tag into the map inside `declare global`:
 *
 * ```ts
 * declare const componentSelector = "icon-close";
 * declare global {
 *     interface HTMLElementTagNameMap {
 *         [componentSelector]: IconClose;
 *     }
 * }
 * ```
 *
 * Only declarations TypeScript would load for the repo are read: each imported
 * module's typings, and every file those reach through their own imports and
 * re-exports. Never a sweep of `node_modules`.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSync } from "oxc-parser";
import type { Statement, TSInterfaceDeclaration, TSTypeAnnotation, VariableDeclarator } from "@oxc-project/types";
import { canonicalTagName, isValidCustomElementName, packageNameFromSpecifier } from "@scoutui/reference-graph";
import { isRelativeSpecifier, relativeDtsPath, resolvePackageEntry } from "./package-types.js";

/** An installed package whose type declarations put the tag into `HTMLElementTagNameMap`. */
export type TagMapClaim = { packageName: string; version: string | null };

export type TagMapIndex = { byTag: Map<string, TagMapClaim[]> };

/** A module the repo imports: its specifier as written, and the directory of the file that imports it. */
export type ImportedModule = { fromDir: string; specifier: string };

/**
 * Every tag the typings of `imports` declare, by canonical tag name, each
 * with the packages that declare it (sorted by name). An import that isn't a
 * package, isn't installed or has no typings contributes nothing, and so does
 * a declaration file that can't be read or parsed.
 */
export function buildTagMapIndex(imports: Iterable<ImportedModule>): TagMapIndex {
  const byTag = new Map<string, TagMapClaim[]>();
  const visited = new Set<string>();
  const owners = new Map<string, TagMapClaim | null>();
  const pending: string[] = [];

  const entryOf = new Map<string, string | null>();
  const follow = (fromDir: string, specifier: string): void => {
    if (packageNameFromSpecifier(specifier) === null) return;
    const key = `${fromDir}\0${specifier}`;
    let entry = entryOf.get(key);
    if (entry === undefined) {
      const resolved = resolvePackageEntry(fromDir, specifier);
      entry = resolved.kind === "found" ? resolved.entryPath : null;
      entryOf.set(key, entry);
    }
    if (entry !== null) pending.push(entry);
  };

  for (const { fromDir, specifier } of imports) follow(fromDir, specifier);

  while (pending.length > 0) {
    const file = realPath(pending.pop() as string);
    if (file === null || visited.has(file)) continue;
    visited.add(file);
    const declarations = readDeclarationFile(file);
    if (declarations === null) continue;

    for (const source of declarations.sources) {
      if (isRelativeSpecifier(source)) {
        const target = relativeDtsPath(file, source);
        if (target !== null) pending.push(target);
      } else {
        follow(dirname(file), source);
      }
    }

    if (declarations.tags.length === 0) continue;
    const owner = packageOwning(file, owners);
    if (owner === null) continue;
    for (const tag of declarations.tags) {
      const claims = byTag.get(tag) ?? [];
      if (claims.some((c) => c.packageName === owner.packageName)) continue;
      claims.push(owner);
      byTag.set(tag, claims);
    }
  }

  for (const claims of byTag.values()) {
    claims.sort((a, b) => (a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0));
  }
  return { byTag };
}

function realPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The package `file` is in, with its installed version: the nearest `package.json` above it that has a `name`. Memoized by directory. */
function packageOwning(file: string, owners: Map<string, TagMapClaim | null>): TagMapClaim | null {
  const walked: string[] = [];
  let owner: TagMapClaim | null = null;
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const known = owners.get(dir);
    if (known !== undefined) {
      owner = known;
      break;
    }
    walked.push(dir);
    const pkg = readPackageJson(join(dir, "package.json"));
    if (pkg !== null && typeof pkg.name === "string" && pkg.name !== "") {
      owner = { packageName: pkg.name, version: typeof pkg.version === "string" ? pkg.version : null };
      break;
    }
    if (dirname(dir) === dir) break;
  }
  for (const dir of walked) owners.set(dir, owner);
  return owner;
}

function readPackageJson(path: string): { name?: unknown; version?: unknown } | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** What one declaration file contributes: the modules it imports or re-exports, and the custom element tags it puts into `HTMLElementTagNameMap`. */
type DeclarationFile = { sources: string[]; tags: string[] };

function readDeclarationFile(file: string): DeclarationFile | null {
  let body: Statement[];
  try {
    const { program, errors } = parseSync(file, readFileSync(file, "utf8"));
    if (errors.length > 0) return null;
    body = program.body as Statement[];
  } catch {
    return null;
  }

  const sources: string[] = [];
  const strings = new Map<string, string>();
  const tagMaps: TSInterfaceDeclaration[] = [];
  for (const stmt of body) {
    if (stmt.type === "ImportDeclaration" || stmt.type === "ExportAllDeclaration") sources.push(stmt.source.value);
    if (stmt.type === "ExportNamedDeclaration" && stmt.source !== null) sources.push(stmt.source.value);
    const declaration = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (declaration?.type === "VariableDeclaration" && declaration.kind === "const") readConstStrings(declaration.declarations, strings);
    if (stmt.type === "TSModuleDeclaration" && stmt.kind === "global") {
      for (const inner of stmt.body?.body ?? []) {
        if (inner.type === "TSInterfaceDeclaration" && inner.id.name === "HTMLElementTagNameMap") tagMaps.push(inner);
      }
    }
  }

  const tags = new Set<string>();
  for (const tagMap of tagMaps) {
    for (const member of tagMap.body.body) {
      if (member.type !== "TSPropertySignature") continue;
      const { key } = member;
      const name =
        key.type === "Literal" && typeof key.value === "string" ? key.value
        : member.computed && key.type === "Identifier" ? strings.get(key.name)
        : undefined;
      if (name === undefined) continue;
      const tag = canonicalTagName(name);
      if (isValidCustomElementName(tag)) tags.add(tag);
    }
  }
  return { sources, tags: [...tags] };
}

/** `const name = "text"` and `const name: "text"` declarators, into `strings`. */
function readConstStrings(declarators: readonly VariableDeclarator[], strings: Map<string, string>): void {
  for (const { id, init } of declarators) {
    if (id.type !== "Identifier") continue;
    // oxc's types leave out the annotation a TypeScript binding carries.
    const annotation = (id as { typeAnnotation?: TSTypeAnnotation | null }).typeAnnotation?.typeAnnotation;
    const literal = init?.type === "Literal" ? init : annotation?.type === "TSLiteralType" ? annotation.literal : undefined;
    if (literal?.type === "Literal" && typeof literal.value === "string") strings.set(id.name, literal.value);
  }
}
