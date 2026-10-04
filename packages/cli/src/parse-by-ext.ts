/**
 * File parsing for the scan: oxc-parser for babel-family files and
 * @vue/compiler-sfc for SFCs.
 *
 * Throws on unrecoverable syntax errors. oxc-parser recovers from the rest,
 * returning a partial Program; its errors reach `onSyntaxErrors` and the scan
 * carries on.
 */
import { extname } from "node:path";
import { parse as parseVueSfc, type SFCDescriptor } from "@vue/compiler-sfc";
import { parseSync as oxcParseSync } from "oxc-parser";
import type { Program } from "@oxc-project/types";

export type ParsedFile =
  | { kind: "babel"; ast: Program; source: string }
  | { kind: "vue"; descriptor: SFCDescriptor; scriptAst?: Program; plainScriptAst?: Program; source: string }
  | { kind: "unsupported" };

/** Called with the syntax errors oxc-parser recovered from. */
export type SyntaxErrorReporter = (filePath: string, messages: string[]) => void;

/** The warning line for a file with syntax errors the parser recovered from. */
export function syntaxErrorWarning(filePath: string, messages: string[]): string {
  return `${filePath} has syntax errors (${messages.join("; ")}), so the scan read what it could.`;
}

const SCRIPT_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js", ".mts", ".mjs", ".cts", ".cjs"]);

/** Whether `parseByExt` reads a file with this path's extension. */
export function isParsable(filePath: string): boolean {
  const ext = extname(filePath);
  return SCRIPT_EXTENSIONS.has(ext) || ext === ".vue";
}

export function parseByExt(filePath: string, source: string, onSyntaxErrors?: SyntaxErrorReporter): ParsedFile {
  const ext = extname(filePath);
  const report = onSyntaxErrors && ((messages: string[]) => onSyntaxErrors(filePath, messages));

  if (SCRIPT_EXTENSIONS.has(ext)) {
    const { program, errors } = parseOxc(filePath, source, ext);
    // oxc returns an empty Program when it can't recover from a syntax error.
    if (errors.length > 0 && program.body.length === 0) throw new Error(errors.join("; "));
    if (errors.length > 0) report?.(errors);
    return { kind: "babel", ast: program, source };
  }

  if (ext === ".vue") {
    const { descriptor } = parseVueSfc(source);
    const scriptContent =
      descriptor.scriptSetup?.content ?? descriptor.script?.content;
    if (scriptContent && scriptContent.length > 0) {
      // `scriptAst` is the `<script setup>` block when there is one; the
      // plain `<script>` beside it is parsed as `plainScriptAst`.
      const plainContent = descriptor.scriptSetup ? descriptor.script?.content : undefined;
      return {
        kind: "vue",
        descriptor,
        scriptAst: parseScriptBlock(`${filePath}.ts`, scriptContent, report),
        ...(plainContent ? { plainScriptAst: parseScriptBlock(`${filePath}.ts`, plainContent, report) } : {}),
        source: scriptContent,
      };
    }
    return { kind: "vue", descriptor, source: "" };
  }

  return { kind: "unsupported" };
}

function parseScriptBlock(filePath: string, source: string, report?: (messages: string[]) => void): Program {
  const { program, errors } = parseOxc(filePath, source, ".ts");
  if (errors.length > 0) report?.(errors);
  return program;
}

function parseOxc(filePath: string, source: string, ext: string): { program: Program; errors: string[] } {
  // oxc parses JSX in .js files only with a lang hint; without one it
  // returns an empty Program.
  const options =
    ext === ".jsx" || ext === ".js"
      ? { lang: "jsx" as const }
      : undefined;
  const result = options
    ? oxcParseSync(filePath, source, options)
    : oxcParseSync(filePath, source);
  return { program: result.program, errors: result.errors.map((e) => e.message) };
}
