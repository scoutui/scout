export type {
  AttributionTarget,
  ChainBailedCode,
  Component,
  CompositionRollup,
  Credit,
  DeclaredProp,
  DeclaredPropApi,
  EvidenceRecord,
  Framework,
  Identity,
  Known,
  KnownEvidenceRecord,
  KnownTagAttribution,
  Occurrence,
  PropDistribution,
  PropValueEntry,
  PropValueState,
  Resolution,
  ResolvedOccurrence,
  ScanArtifact,
  ScanMeta,
  TagAttribution,
  TraceStep,
  UnresolvedReason,
} from "./schema.js";
export { isKind } from "./schema.js";
export { compareCliVersions, isSnapshotVersion } from "./cli-version.js";
export { componentKey } from "./component-key.js";
export { sameComponentName } from "./component-name.js";
export { displayNameOf } from "./display-name.js";
export { parseCompoundExport } from "./compound-export.js";
export { resolvedOccurrences } from "./resolved-occurrences.js";
export { SCHEMA_VERSION, schemaVersionOf } from "./schema-version.js";
export { validateArtifact } from "./validate.js";
