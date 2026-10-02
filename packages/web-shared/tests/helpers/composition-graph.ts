import type { ScanArtifact } from "@scoutui/scan-format";
import type { GovernanceRecord } from "../../src/dto.js";
import type { CompositionGraph } from "../../src/composition-graph.js";
import { createComponentProjectionContext } from "../../src/projection-context.js";
import { deriveGraphRows } from "../../src/read-models.js";
import { reduceCompositionGraph } from "../../src/read-model-reducers.js";

/**
 * A scan's composition graph as the dashboard reads it: the graph rows a
 * publish stores, reduced the way the driver reduces them.
 */
export function projectCompositionGraph(artifact: ScanArtifact, governance: GovernanceRecord[] = []): CompositionGraph {
  return reduceCompositionGraph(deriveGraphRows(createComponentProjectionContext(artifact)), governance);
}
