/**
 * Builds per-component seeds from local definitions and the engine's registry. Seeds are the
 * per-component input to `emitArtifact`: they carry identity but no
 * occurrence data (that is merged separately during rollup).
 *
 * Pure functions; no I/O.
 */

import { join } from "node:path";
import type { ComponentId } from "@scoutui/reference-graph";
import { componentKey, type DeclaredPropApi } from "@scoutui/scan-format";
import { frameworkOf, scanIdOf, toIdentity } from "./artifact/identity.js";
import type { LocalDefinitionIndex } from "./local-index/types.js";
import type { ComponentRow } from "./rollup.js";
import { findOwningPackage } from "./workspace/find-owning-package.js";
import type { WorkspaceGraph } from "./workspace/types.js";

/** One observed component, named as the scan file names it, before a tag's attribution is added. */
export type ComponentSeed = Omit<ComponentRow, "attribution">;

/** What a seed records beyond its identity. */
export type SeedContext = {
  /** The scan's `meta.repo.id`, stamped on every repository declaration. */
  repoId: string;
  workspaceGraph?: WorkspaceGraph;
  /** The root a local `filePath` is relative to; defaults to `workspaceGraph.rootPath`. */
  outputRoot?: string;
  definition?: { line: number; column: number };
  declared?: DeclaredPropApi;
  /** True when the local definition is `export default` (root eligibility). */
  isDefaultExport?: boolean;
};

/**
 * The seed constructor: `componentId`'s scan-file identity (`toIdentity`), keyed by
 * `componentKey`. Only a repository declaration keeps its declared props, its
 * declaration position and the workspace package that owns its file.
 */
export function seedFor(componentId: ComponentId, ctx: SeedContext): ComponentSeed {
  const identity = toIdentity(componentId, ctx.repoId);
  const framework = frameworkOf(componentId.kind);
  const local = identity.kind === "repository-declaration";
  const owningPackage =
    local && ctx.workspaceGraph !== undefined
      ? findOwningPackage(ctx.workspaceGraph, join(ctx.outputRoot ?? ctx.workspaceGraph.rootPath, identity.filePath))?.name
      : undefined;
  return {
    id: componentKey(identity),
    identity,
    ...(framework !== undefined ? { framework } : {}),
    ...(local && ctx.declared !== undefined ? { declared: ctx.declared } : {}),
    ...(local && ctx.definition !== undefined ? { definition: ctx.definition } : {}),
    ...(owningPackage !== undefined ? { owningPackage } : {}),
    ...(ctx.isDefaultExport !== undefined ? { isDefaultExport: ctx.isDefaultExport } : {}),
  };
}
/** Output-space view of the engine's component registry. Paths
 *  are outputRoot-relative POSIX, the same space `LocalDefinition` uses,
 *  so `scan.ts` rebases the engine's graph keys before handing it here. */
export type RosterRegistry = {
  /** Where the identity named by (filePath, exportName) is declared. Answers
   *  for names the roster itself does not hold: a folded holder, or a
   *  declaration nothing exports. Compound members (`NS.Inline`) and
   *  Vue-dialect files have none. */
  declarationOf(
    filePath: string,
    exportName: string,
  ): { symbol: string; loc: { line: number; column: number } } | undefined;
  localEntries(): readonly {
    filePath: string;
    symbol: string;
    exportName: string;
    kind: "react-component" | "vue-component";
    loc: { line: number; column: number };
    isDefault: boolean;
  }[];
};

/**
 * Project local definitions and registry entries into observed-only
 * ComponentSeeds. Two sources contribute:
 *   1. Vue and custom-element local definitions, seeded whether or not an
 *      occurrence references them, so they can serve as owner-edge targets
 *      in the composition graph.
 *   2. Registry entries: every local React row, carrying `declared` joined
 *      by symbol when the entry's name resolves to that entry.
 *
 * A seed exists here iff it was observed (local definition or registry
 * entry), one per scan-file id; the first seen for an id wins.
 * Grouping by design system is the web app's responsibility.
 */
export function buildComponentSeeds(
  localIndex?: LocalDefinitionIndex,
  repoRoot?: string,
  workspaceGraph?: WorkspaceGraph,
  registry?: RosterRegistry,
  /** The scan's `meta.repo.id`, stamped on every local identity. */
  repoId = "",
  /** Declared prop APIs extracted from each React file, by output-space
   *  file path, then local symbol. */
  declaredByFile: ReadonlyMap<string, ReadonlyMap<string, DeclaredPropApi>> = new Map(),
): ComponentSeed[] {
  const seedsById = new Map<string, ComponentSeed>();
  const context: SeedContext = {
    repoId,
    ...(workspaceGraph !== undefined ? { workspaceGraph } : {}),
    ...(repoRoot !== undefined ? { outputRoot: repoRoot } : {}),
  };

  // 1. Vue and custom-element definitions. These must appear in
  //    components[] even when no occurrence references them, so they can
  //    serve as owner-edge targets in the composition graph.
  if (localIndex) {
    for (const [, defs] of localIndex.byPath) {
      for (const def of defs) {
        if (seedsById.has(scanIdOf(def.componentId, repoId))) continue;
        const seed = seedFor(def.componentId, {
          ...context,
          ...(def.loc !== undefined ? { definition: { line: def.loc.line, column: def.loc.column } } : {}),
          ...(def.declared ? { declared: def.declared } : {}),
          ...(def.isDefault !== undefined ? { isDefaultExport: def.isDefault } : {}),
        });
        seedsById.set(seed.id, seed);
      }
    }
  }

  // 2. Registry entries: every local React
  //    component. Seeded with the declaration position, the registry's
  //    default standing and, when the entry is the declaration its name
  //    resolves to, the declared props extracted for its symbol.
  if (registry) {
    for (const entry of registry.localEntries()) {
      const componentId: ComponentId = {
        kind: entry.kind,
        export: entry.exportName,
        source: { type: "local", filePath: entry.filePath },
      };
      if (seedsById.has(scanIdOf(componentId, repoId))) continue;
      const resolved = registry.declarationOf(entry.filePath, entry.exportName)?.loc;
      const nameResolvesToEntry = resolved?.line === entry.loc.line && resolved?.column === entry.loc.column;
      const declared = nameResolvesToEntry ? declaredByFile.get(entry.filePath)?.get(entry.symbol) : undefined;
      const seed = seedFor(componentId, {
        ...context,
        definition: entry.loc,
        isDefaultExport: entry.isDefault,
        ...(declared ? { declared } : {}),
      });
      seedsById.set(seed.id, seed);
    }
  }

  return [...seedsById.values()];
}
