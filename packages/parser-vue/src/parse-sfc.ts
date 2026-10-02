import type { NodeTypes } from "@vue/compiler-core";
import type { SFCDescriptor } from "@vue/compiler-sfc";
import type { Program } from "@oxc-project/types";

/**
 * The template AST node types the walk reads, as values: importing the
 * `NodeTypes` enum itself would bundle a second copy of @vue/compiler-core
 * into the CLI.
 */
export const VueNode = {
  ROOT: 0 as NodeTypes.ROOT,
  ELEMENT: 1 as NodeTypes.ELEMENT,
  SIMPLE_EXPRESSION: 4 as NodeTypes.SIMPLE_EXPRESSION,
  ATTRIBUTE: 6 as NodeTypes.ATTRIBUTE,
};

/**
 * The parsed form of a `.vue` file.
 * parseByExt produces this shape: SFC descriptor from `@vue/compiler-sfc`,
 * plus an oxc Program for the script block when one exists. `scriptProgram`
 * stays optional because an SFC without a `<script>` block legitimately has
 * none. It is the `<script setup>` block when the SFC has one;
 * `plainScriptProgram` is then the plain `<script>` beside it, if any.
 */
export type VueParseWrapper = {
  descriptor: SFCDescriptor;
  scriptProgram?: Program;
  plainScriptProgram?: Program;
};

export type SfcParts = {
  scriptSource?: string;
  scriptLang?: "ts" | "js";
};

/**
 * Derive the `SfcParts` shape from a descriptor produced upstream (parseByExt).
 * No SFC re-parse. parseByExt throws on unrecoverable SFC syntax, so any
 * descriptor reaching this point is well-formed.
 */
export function partsFromWrapper(wrapper: VueParseWrapper): SfcParts {
  const { descriptor } = wrapper;
  const result: SfcParts = {};
  const script = descriptor.scriptSetup ?? descriptor.script;
  if (script) {
    result.scriptSource = script.content;
    result.scriptLang = script.lang === "ts" ? "ts" : "js";
  }
  return result;
}
