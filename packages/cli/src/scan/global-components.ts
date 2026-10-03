import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { vueTagForms, type AutoImportComponent } from "@scoutui/parser-vue";
import { canonicalTagName, isValidCustomElementName } from "@scoutui/reference-graph";

/**
 * Reader for generated `GlobalComponents` declarations.
 *
 * Vue's type checker reads global components only from the `GlobalComponents`
 * interface, so generated files, hand-written declarations and library
 * packages all augment it.
 *
 * Two producers are probed. Nuxt writes its registry twice, as an
 * `export const` list and as this augmentation. Nuxt 3 puts both in
 * `.nuxt/components.d.ts`; Nuxt 4 moves the augmentation to
 * `.nuxt/types/components.d.ts`. `unplugin-vue-components` writes
 * `components.d.ts` at the project root by default, or wherever its `dts`
 * option points, most often `src/components.d.ts`. All four paths are
 * probed, in that order.
 */
export type GlobalComponentsRegistry = {
  /** The declaration file the registry was read from. */
  declarationPath: string;
  /** Keyed by lowercased tag forms (see `vueTagForms`). */
  lookup: (tagForm: string) => AutoImportComponent | undefined;
  /** In-repo entries whose resolved file no longer exists (stale declaration). */
  stale: Array<{ componentName: string; target: string }>;
  /** Every member whose key is a valid custom element name, by canonical key. */
  tagDeclarations: GlobalTagDeclaration[];
};

/**
 * A member keyed by a valid custom element name: its line in the declaration
 * file and its import: a bare specifier, an absolute in-repo path, or null
 * when the in-repo file no longer exists.
 */
export type GlobalTagDeclaration = { tagName: string; line: number; specifier: string | null; imported: string };

/** One line of a declaration file, 1-based. */
type SourceLine = { text: string; line: number };

/** Nuxt's generated declaration files. */
const NUXT_PATHS = [join(".nuxt", "components.d.ts"), join(".nuxt", "types", "components.d.ts")];

/** Declaration files probed, in order. First one that resolves entries wins. */
const CANDIDATE_PATHS = [...NUXT_PATHS, "components.d.ts", join("src", "components.d.ts")];

// The modules a GlobalComponents augmentation can target. Both forms are live
// in the ecosystem: `@vue/runtime-core` is the historical one, `vue` the
// current one.
const AUGMENTED_MODULE = /declare\s+module\s+["'](?:vue|@vue\/runtime-core)["']\s*\{/g;

// `interface Name extends A, B {`, with or without `export` / `declare`.
const INTERFACE_DECL = /(?:^|[\s;}])(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+([^{]*?))?\s*\{/g;

// One member of a GlobalComponents interface. The key is a bare identifier or
// a quoted string, for names an identifier can't spell such as kebab forms
// (`'my-card'`). The type is the
// bare `typeof import(...)` or a wrapper around it (`LazyComponent<...>`,
// `IslandComponent<...>`).
const MEMBER =
  /^\s*(?:["']([^"']+)["']|([A-Za-z_$][\w$]*))\??\s*:\s*.*typeof import\(["']([^"']+)["']\)\[["']([^"']+)["']\]/;

type InterfaceDecl = { name: string; extends: string[]; lines: SourceLine[]; start: number };

/** Body text between `open` (index of `{`) and its matching `}`, or null if unbalanced. */
function matchingBlock(source: string, open: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { body: source.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Every `interface` declaration in the file, in source order. */
function collectInterfaces(source: string): InterfaceDecl[] {
  const out: InterfaceDecl[] = [];
  INTERFACE_DECL.lastIndex = 0;
  for (let m = INTERFACE_DECL.exec(source); m !== null; m = INTERFACE_DECL.exec(source)) {
    const open = m.index + m[0].length - 1;
    const block = matchingBlock(source, open);
    if (block === null) continue;
    const firstLine = source.slice(0, open).split("\n").length;
    out.push({
      name: m[1] as string,
      extends: (m[2] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      lines: block.body.split("\n").map((text, i) => ({ text, line: firstLine + i })),
      start: m.index,
    });
    // Resume just inside the block: members can't declare interfaces, but
    // nested blocks can.
    INTERFACE_DECL.lastIndex = open + 1;
  }
  return out;
}

/** Character ranges covered by a `declare module 'vue' { ... }` block. */
function augmentedRanges(source: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  AUGMENTED_MODULE.lastIndex = 0;
  for (let m = AUGMENTED_MODULE.exec(source); m !== null; m = AUGMENTED_MODULE.exec(source)) {
    const open = m.index + m[0].length - 1;
    const block = matchingBlock(source, open);
    if (block === null) continue;
    out.push([m.index, block.end]);
    AUGMENTED_MODULE.lastIndex = block.end;
  }
  return out;
}

/**
 * Members contributed by `decl`, own-first then inherited as in TypeScript,
 * so a first-wins consumer resolves a shadowed name the way the type checker
 * would. `seen` breaks `extends` cycles.
 */
function flatten(decl: InterfaceDecl, byName: Map<string, InterfaceDecl>, seen: Set<string>): SourceLine[] {
  if (seen.has(decl.name)) return [];
  seen.add(decl.name);
  const lines = [...decl.lines];
  for (const parent of decl.extends) {
    const target = byName.get(parent);
    if (target !== undefined) lines.push(...flatten(target, byName, seen));
  }
  return lines;
}

/**
 * Every `GlobalComponents` member line in `source`, in precedence order, or
 * null when the file declares no `GlobalComponents`, so the probe moves on to
 * the next candidate.
 */
function globalComponentMembers(source: string): SourceLine[] | null {
  const ranges = augmentedRanges(source);
  if (ranges.length === 0) return null;
  const interfaces = collectInterfaces(source);
  // Same-name declarations merge, as in TypeScript: a parent split across two
  // `interface _GlobalComponents` blocks contributes both.
  const byName = new Map<string, InterfaceDecl>();
  for (const decl of interfaces) {
    const prior = byName.get(decl.name);
    byName.set(
      decl.name,
      prior === undefined
        ? decl
        : { ...prior, extends: [...prior.extends, ...decl.extends], lines: [...prior.lines, ...decl.lines] },
    );
  }
  const declarations = interfaces.filter(
    (decl) =>
      decl.name === "GlobalComponents" &&
      ranges.some(([start, end]) => decl.start > start && decl.start < end),
  );
  if (declarations.length === 0) return null;
  // Multiple declarations merge, as TypeScript merges them.
  return declarations.flatMap((decl) => flatten(decl, byName, new Set()));
}

export function loadGlobalComponents(scanRoot: string): GlobalComponentsRegistry | null {
  for (const candidate of CANDIDATE_PATHS) {
    const declarationPath = join(scanRoot, candidate);
    if (!existsSync(declarationPath)) continue;
    // An unreadable candidate (EACCES, EISDIR) is skipped rather than failing
    // the scan.
    let raw: string;
    try {
      raw = readFileSync(declarationPath, "utf8");
    } catch {
      continue;
    }
    const members = globalComponentMembers(raw);
    if (members === null) continue;
    const parsed = parseMembers(dirname(declarationPath), members);
    // A declaration that resolves to nothing usable is not the registry: its
    // members may come from a file this candidate can't reach. Keep probing,
    // since an empty result would also suppress the missing-declaration
    // diagnostic.
    if (parsed.map.size === 0 && parsed.stale.length === 0) continue;
    return {
      declarationPath,
      lookup: (tagForm) => parsed.map.get(tagForm),
      stale: parsed.stale,
      tagDeclarations: parsed.tagDeclarations,
    };
  }
  return null;
}

/** A module specifier that names a package rather than a path (`vuetify/components`). */
function isBareSpecifier(importPath: string): boolean {
  if (isAbsolute(importPath)) return false;
  // `.`/`..` are relative; `#` (subpath imports) and `~`/`@/` (bundler
  // aliases) are neither bare nor resolvable here, so they keep the
  // resolve-and-check path that surfaces a diagnostic instead of an identity.
  return !/^[.#~\\/]/.test(importPath) && !importPath.startsWith("@/");
}

type ParsedMembers = {
  map: Map<string, AutoImportComponent>;
  stale: Array<{ componentName: string; target: string }>;
  tagDeclarations: GlobalTagDeclaration[];
};

function parseMembers(baseDir: string, members: SourceLine[]): ParsedMembers {
  const map = new Map<string, AutoImportComponent>();
  const stale: Array<{ componentName: string; target: string }> = [];
  const tagDeclarations: GlobalTagDeclaration[] = [];
  for (const { text, line } of members) {
    const m = MEMBER.exec(text);
    if (m === null) continue;
    const name = (m[1] ?? m[2]) as string;
    const importPath = m[3] as string;
    const imported = m[4] as string;
    const tagName = canonicalTagName(name);
    const declaresTag = isValidCustomElementName(tagName);
    let specifier: string;
    if (isBareSpecifier(importPath)) {
      // A hand-written or library declaration names its own package
      // (`typeof import('vuetify/components')`). It is already the bare
      // specifier the external-identity route wants, and resolving it against
      // baseDir would invent an in-repo path that never existed.
      specifier = importPath;
    } else {
      const abs = isAbsolute(importPath) ? importPath : resolve(baseDir, importPath);
      // Search and slice the POSIX form, so a Windows path still finds the
      // `node_modules/` segment and the specifier comes out POSIX.
      const posixAbs = abs.replaceAll("\\", "/");
      const nmIdx = posixAbs.lastIndexOf("node_modules/");
      if (nmIdx >= 0) {
        // Generated paths reach into node_modules (often via pnpm's `.pnpm`
        // store); the substring after the last `node_modules/` is the bare
        // specifier, which flows the normal external-identity route.
        specifier = posixAbs.slice(nmIdx + "node_modules/".length);
      } else {
        // In-repo entry: a dead path must never become an identity.
        if (!existsSync(abs)) {
          stale.push({ componentName: name, target: abs });
          if (declaresTag) tagDeclarations.push({ tagName, line, specifier: null, imported });
          continue;
        }
        specifier = abs;
      }
    }
    if (declaresTag) tagDeclarations.push({ tagName, line, specifier, imported });
    const entry: AutoImportComponent = { specifier, imported, name };
    for (const form of vueTagForms(name)) {
      if (!map.has(form)) map.set(form, entry);
    }
  }
  return { map, stale, tagDeclarations };
}

/**
 * Detects an app that depends on `nuxt` but has no generated declarations, so
 * its auto-imports would be invisible. Only feeds the
 * `auto-import-manifest-missing` warning.
 */
export function detectAutoImportFramework(scanRoot: string): { expectedPath: string } | null {
  if (!declaresNuxt(scanRoot)) return null;
  // Name a candidate that is absent: Nuxt 4 leaves a populated
  // `.nuxt/components.d.ts` even when the augmentation under `.nuxt/types/`
  // is the missing one. With nothing generated, this is the first candidate,
  // which `nuxt prepare` writes.
  const candidates = NUXT_PATHS.map((c) => join(scanRoot, c));
  return { expectedPath: candidates.find((p) => !existsSync(p)) ?? (candidates[0] as string) };
}

/**
 * Whether `scanRoot` is a Nuxt app with none of Nuxt's generated component
 * declarations on disk. Checks only that the files exist: an empty
 * declaration still counts as prepared.
 */
export function nuxtAppUnprepared(scanRoot: string): boolean {
  return declaresNuxt(scanRoot) && NUXT_PATHS.every((c) => !existsSync(join(scanRoot, c)));
}

/** Whether `scanRoot`'s `package.json` lists `nuxt` in `dependencies` or `devDependencies`. */
export function declaresNuxt(scanRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(scanRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation
    return pkg.dependencies?.["nuxt"] !== undefined || pkg.devDependencies?.["nuxt"] !== undefined;
  } catch {
    return false;
  }
}
