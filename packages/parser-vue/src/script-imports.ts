import type { Program } from "@oxc-project/types";
import { walk } from "oxc-walker";
import { posixPath } from "@scoutui/reference-graph";

interface WarningBase {
  message: string;
}

export type Warning =
  | (WarningBase & { code: "PARSE_FAILURE"; file: string; line: number })
  | (WarningBase & { code: "IMPORT_UNRESOLVABLE"; file: string; line: number })
  | (WarningBase & { code: "MANIFEST_TAG_COLLISION"; package: string })
  | (WarningBase & { code: "EMPTY_INCLUDE" });

export type FileImport = {
  file: string;
  /** Local binding name as used at the import site. */
  imported: string;
  source: string;
  loc: { file: string; line: number; column: number };
};

export type ExtractOptions = {
  file: string;
  /**
   * Pre-parsed script-block AST. scan.ts owns the oxc parse of the SFC's
   * script block and passes it in as `wrapper.scriptProgram`.
   */
  program: Program;
};

export type ImportSpec = {
  /** Local binding name as written in the script (after `as` rename, if any). */
  local: string;
  /** Imported export name from the source module. "default" for default imports; "*" for namespace imports. */
  imported: string;
  source: string;
};

export type ExtractResult = {
  imports: FileImport[];
  /** Structured imports carrying both local + imported names; used for resolver lookups. */
  importSpecs: ImportSpec[];
  warnings: Warning[];
};

export function extractScriptImports(opts: ExtractOptions): ExtractResult {
  const imports: FileImport[] = [];
  const importSpecs: ImportSpec[] = [];
  const warnings: Warning[] = [];

  const filePosix = posixPath(opts.file);

  walk(opts.program, {
    enter(node) {
      if (node.type !== "ImportDeclaration") return;
      const source = node.source.value;
      // Side-effect import: `import "pkg"`. No binding to track.
      if (node.specifiers.length === 0) return;
      // A type-only import has no runtime value, so it can never be the
      // component a tag renders. Vue resolves template tags by name against
      // these bindings, so keeping them would let `import type { Paginator }`
      // claim every `<Paginator>` in the SFC, taking the tag from the auto-import
      // lane and inventing a component for the type's source module.
      // Both spellings drop out: the whole declaration (`import type { A }`,
      // `import type A`) and the inline specifier (`import { type B, C }`).
      if (node.importKind === "type") return;

      for (const spec of node.specifiers) {
        if (spec.type === "ImportSpecifier" && spec.importKind === "type") continue;
        const local = spec.local.name;
        imports.push({
          file: filePosix,
          imported: local,
          source,
          loc: { file: filePosix, line: 1, column: 1 },
        });
        let importedName: string;
        if (spec.type === "ImportDefaultSpecifier") {
          importedName = "default";
        } else if (spec.type === "ImportNamespaceSpecifier") {
          importedName = "*";
        } else {
          // ImportSpecifier: imported may be Identifier or StringLiteral
          // (for `import { "foo-bar" as foo } from "..."`)
          const imp = spec.imported;
          importedName =
            imp.type === "Identifier"
              ? imp.name
              : (imp as { value: string }).value;
        }
        importSpecs.push({ local, imported: importedName, source });
      }
    },
  });

  return { imports, importSpecs, warnings };
}
