// Public API surface for @scoutui/reference-graph.

export type { Reference, ScopeId } from "./types/reference.js";
export { MODULE_SCOPE } from "./types/reference.js";
export type { InferredType } from "./types/inferred-type.js";
export type { OccurrenceVia } from "./types/occurrence-via.js";
export type { ComponentId, ComponentKind } from "./types/component-id.js";
export type { PropUsage } from "./types/prop-usage.js";
export { isHandlerName } from "./types/prop-usage.js";
export type { ResolveImport } from "./types/resolve-import.js";
export type {
  BindingDecl,
  Dialect,
  ExportRecord,
  FileGraph,
  Graph,
  GraphHostHooks,
  ImportRecord,
  JsxUsage,
  TagUsage,
  UsageKind,
} from "./types/file-graph.js";

export { createGraphBuilder } from "./builder.js";
export type { GraphBuilder, FileBuilder, CreateGraphBuilderOptions } from "./builder.js";

export { resolveType, DYNAMIC_MEMBER_KEY } from "./engine/resolve-type.js";
export { createArgumentMap } from "./engine/argument-map.js";
export type { ArgumentMap } from "./engine/argument-map.js";

export { walkWithFolding, deriveIdentity } from "./engine/wrapper-folding.js";
export type { TerminalIdentity, WalkPosition } from "./engine/wrapper-folding.js";

export { matchDenotation, renderOutcome, creditedTerminals } from "./engine/denotation.js";
export type {
  Denotation,
  OpaqueSemantics,
  LateBoundSource,
  Terminal,
  Evaluation,
  DenotationCases,
  RenderOutcome,
} from "./engine/denotation.js";

export { denoteName, resolve } from "./engine/index.js";
export type {
  DenotedName,
  ResolvedGraph,
  EngineOccurrence,
  ExternalLeafResult,
  ResolveOpts,
} from "./engine/index.js";

export { evalKind } from "./engine/component-shape.js";
export { isHostElementName } from "./engine/host-element.js";
export type { ValueKind } from "./engine/component-shape.js";

export { classifyDeclaration, buildHelperCallers } from "./engine/helper-callers.js";
export type { Classification, HelperCallerIndex, ClassifiedHelperIndex } from "./engine/helper-callers.js";
export { buildComponentRegistry, declarationOf } from "./engine/registry.js";
export { declarationPositionIn } from "./engine/binding.js";
export type { ComponentRegistry, RegistryEntry } from "./engine/registry.js";
export { resolveOwnerChain } from "./engine/owner-resolution.js";
export type { OwnerResolution } from "./engine/owner-resolution.js";
export { followReExportChain } from "./engine/re-export-chain.js";
export { externalSubpath, packageNameFromSpecifier } from "./engine/specifier.js";

export { posixPath } from "./posix.js";
export { canonicalTagName, isValidCustomElementName } from "./tag-name.js";
export type { DiagnosticCollector, EngineDiagnostic } from "./diagnostics.js";
export { createDiagnosticCollector, engineDiagnosticKey } from "./diagnostics.js";
