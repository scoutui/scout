import { parse as parseVueSfc } from "@vue/compiler-sfc";
import { parseSync as oxcParse } from "oxc-parser";
import {
  createGraphBuilder,
  resolve as resolveGraph,
  type ResolveOpts,
  type EngineOccurrence,
  type FileGraph,
  type Graph,
  type GraphHostHooks,
} from "@scoutui/reference-graph";
import type { DiagnosticCollector, ResolveImport } from "@scoutui/reference-graph";
import { emitVueTemplate, type EmitVueTemplateOpts } from "../src/emit-template.js";
import type { VueParseWrapper } from "../src/parse-sfc.js";

/** Inputs for `runVueScan`. */
export type RunVueScanOpts = {
  /** Inline SFC source: full `<template>...</template><script setup>...</script>`. */
  source: string;
  /** Graph file key. Defaults to `"Page.vue"`. */
  file?: string;
  /** Optional diagnostic collector for tests asserting on engine diagnostics. */
  collector?: DiagnosticCollector;
  /** Optional moduleResolver for cross-file fixtures; defaults to null-return. */
  moduleResolver?: ResolveImport;
  /** Optional auto-import lookup (mirrors scan.ts's manifest wiring). */
  resolveAutoImport?: EmitVueTemplateOpts["resolveAutoImport"];
  /** Optional pre-resolved SFC symbol (mirrors scan.ts's detectVueComponents path). */
  sfcSymbol?: string;
  /** Absolute repo root; forwarded to createGraphBuilder so the engine can
   *  normalise absolute moduleResolver returns into repo-relative graph keys.
   *  Required for cross-file fixtures that write to a tmp dir. */
  repoRoot?: string;
  /** Optional first-party check, forwarded to the graph build as scan.ts does. */
  firstParty?: GraphHostHooks["firstParty"];
  /** Additional Vue SFC files to add to the graph before resolve, as scan.ts
   *  parses every .vue file in the workspace. A relative import resolves to a
   *  local workspace SFC only when the target is in the graph. */
  extraFiles?: Array<{
    file: string;
    source: string;
    sfcSymbol?: string;
  }>;
};

export type RunVueScanResult = {
  occurrences: EngineOccurrence[];
  graph: Graph;
  fileGraph: FileGraph;
};

/**
 * Mirrors scan.ts's .vue parse: parse the SFC descriptor and, when a script
 * block exists, oxc-parse the script content. Yields the `VueParseWrapper`
 * `emitVueTemplate` expects.
 */
function makeWrapper(source: string): VueParseWrapper {
  const { descriptor } = parseVueSfc(source);
  const scriptContent = descriptor.scriptSetup?.content ?? descriptor.script?.content;
  if (scriptContent && scriptContent.length > 0) {
    const scriptProgram = oxcParse("script.ts", scriptContent).program;
    const plainContent = descriptor.scriptSetup ? descriptor.script?.content : undefined;
    return plainContent
      ? { descriptor, scriptProgram, plainScriptProgram: oxcParse("script.ts", plainContent).program }
      : { descriptor, scriptProgram };
  }
  return { descriptor };
}

/**
 * Drive the emit-template → engine resolve pipeline on an inline SFC source,
 * as `cli/src/commands/scan.ts` does for a single .vue file, and return the
 * engine occurrences (plus the populated graph for tests that inspect
 * declarations, imports or ownership). `moduleResolver` defaults to one that
 * returns null.
 */
export function runVueScan(opts: RunVueScanOpts): RunVueScanResult {
  const file = opts.file ?? "Page.vue";
  const wrapper = makeWrapper(opts.source);

  const gb = createGraphBuilder({
    moduleResolver: opts.moduleResolver ?? (() => null),
    ...(opts.repoRoot !== undefined ? { repoRoot: opts.repoRoot } : {}),
  });

  // Extra Vue files go into the graph first, through the same emit-template
  // path, so a relative import from the primary file can land a JSX terminal
  // on their default export.
  for (const extra of opts.extraFiles ?? []) {
    const extraFb = gb.beginFile(extra.file, "vue");
    const extraWrapper = makeWrapper(extra.source);
    const extraEmitOpts: EmitVueTemplateOpts = {
      file: extra.file,
      wrapper: extraWrapper,
      fileBuilder: extraFb,
    };
    if (extra.sfcSymbol !== undefined) extraEmitOpts.sfcSymbol = extra.sfcSymbol;
    emitVueTemplate(extraEmitOpts);
  }

  const fb = gb.beginFile(file, "vue");

  const emitOpts: EmitVueTemplateOpts = {
    file,
    wrapper,
    fileBuilder: fb,
  };
  if (opts.sfcSymbol !== undefined) emitOpts.sfcSymbol = opts.sfcSymbol;
  if (opts.resolveAutoImport !== undefined) emitOpts.resolveAutoImport = opts.resolveAutoImport;
  emitVueTemplate(emitOpts);

  const resolveOpts: ResolveOpts = {};
  if (opts.collector !== undefined) resolveOpts.collector = opts.collector;

  const graph = gb.build(opts.firstParty !== undefined ? { firstParty: opts.firstParty } : undefined);
  const { occurrences } = resolveGraph(graph, resolveOpts);
  const fileGraph = graph.files.get(file);
  if (!fileGraph) {
    throw new Error(`runVueScan: file '${file}' missing from built graph`);
  }
  return { occurrences, graph, fileGraph };
}
