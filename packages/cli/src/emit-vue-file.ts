import type { GraphBuilder } from "@scoutui/reference-graph";
import { emitVueTemplate, type EmitVueTemplateOpts } from "@scoutui/parser-vue";
import { detectVueComponents } from "./local-index/detect-vue.js";
import type { LocalDefinition } from "./local-index/types.js";
import type { ParsedFile } from "./parse-by-ext.js";

/**
 * Emit a parsed SFC into the graph as `graphKey`, declared and default-exported
 * under the name `detectVueComponents` gives it: its `defineOptions` or
 * options-object `name`, else its file name in PascalCase. `onDefinitions`
 * receives the component definitions `detectVueComponents` finds, located at
 * `definitionPath`, before the emit starts.
 */
export function emitVueFile(opts: {
  graphBuilder: GraphBuilder;
  graphKey: string;
  definitionPath: string;
  parsed: Extract<ParsedFile, { kind: "vue" }>;
  onDefinitions?: (definitions: LocalDefinition[]) => void;
  resolveAutoImport?: EmitVueTemplateOpts["resolveAutoImport"];
}): void {
  const { parsed } = opts;
  const wrapper = parsed.scriptAst !== undefined
    ? {
        descriptor: parsed.descriptor,
        scriptProgram: parsed.scriptAst,
        ...(parsed.plainScriptAst !== undefined ? { plainScriptProgram: parsed.plainScriptAst } : {}),
      }
    : { descriptor: parsed.descriptor };
  const definitions = detectVueComponents({ kind: "sfc", wrapper }, opts.definitionPath);
  opts.onDefinitions?.(definitions);
  const fileBuilder = opts.graphBuilder.beginFile(opts.graphKey, "vue");
  emitVueTemplate({
    file: opts.graphKey,
    wrapper,
    fileBuilder,
    ...(definitions[0]?.exportName !== undefined ? { sfcSymbol: definitions[0].exportName } : {}),
    ...(opts.resolveAutoImport !== undefined ? { resolveAutoImport: opts.resolveAutoImport } : {}),
  });
}
