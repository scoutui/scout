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

export function parseByExt(filePath: string, source: string, onSyntaxErrors?: SyntaxErrorReporter): ParsedFile {
  const ext = extname(filePath);
  const report = onSyntaxErrors && ((messages: string[]) => onSyntaxErrors(filePath, messages));

  if (ext === ".tsx" || ext === ".jsx" || ext === ".ts" || ext === ".js") {
    return { kind: "babel", ast: parseOxc(filePath, source, ext, report), source };
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
        scriptAst: parseOxc(`${filePath}.ts`, scriptContent, ".ts", report),
        ...(plainContent ? { plainScriptAst: parseOxc(`${filePath}.ts`, plainContent, ".ts", report) } : {}),
        source: scriptContent,
      };
    }
    return { kind: "vue", descriptor, source: "" };
  }

  return { kind: "unsupported" };
}

function parseOxc(filePath: string, source: string, ext: string, report?: (messages: string[]) => void): Program {
  // oxc parses JSX in .js files only with a lang hint; without one it
  // returns an empty Program.
  const options =
    ext === ".jsx" || ext === ".js"
      ? { lang: "jsx" as const }
      : undefined;
  const result = options
    ? oxcParseSync(filePath, source, options)
    : oxcParseSync(filePath, source);
  if (result.errors.length > 0) report?.(result.errors.map((e) => e.message));
  return result.program;
}
