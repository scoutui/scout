import type { LocalDefinition, LocalDefinitionIndex } from "./types.js";

/**
 * Builds the byPath / byTag indices from a flat LocalDefinition[] stream. The
 * caller (scan.ts phase 1) reads and parses files and runs the detectors.
 *
 * `byTag` keeps every custom-element registration of a tag, in stream order.
 */
export function buildLocalIndex(definitions: LocalDefinition[]): LocalDefinitionIndex {
  const byPath: LocalDefinitionIndex["byPath"] = new Map();
  const byTag: LocalDefinitionIndex["byTag"] = new Map();

  for (const def of definitions) {
    if (def.componentId.source.type === "local") {
      const filePath = def.componentId.source.filePath;
      const existing = byPath.get(filePath);
      if (existing) existing.push(def);
      else byPath.set(filePath, [def]);
    }

    if (def.componentId.kind !== "custom-element") continue;
    const claims = byTag.get(def.componentId.tagName);
    if (claims) claims.push(def);
    else byTag.set(def.componentId.tagName, [def]);
  }

  return { byPath, byTag };
}

export type { LocalDefinition, LocalDefinitionIndex, DetectorId } from "./types.js";
