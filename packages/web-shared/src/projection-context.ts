import { displayNameOf, resolvedOccurrences, type Component, type ResolvedOccurrence, type ScanArtifact } from "@scoutui/scan-format";
import { presentIdentity } from "./present-identity.js";

export type OccurrenceStatistics = {
  count: number;
  files: Set<string>;
};

export type ComponentProjectionContext = {
  artifact: ScanArtifact;
  components: Map<string, Component>;
  names: Map<string, string>;
  collisions: Map<string, number>;
};

export type ProjectionContext = ComponentProjectionContext & {
  occurrences: readonly ResolvedOccurrence[];
  occurrencesByComponent: Map<string, ResolvedOccurrence[]>;
  occurrenceStatistics: Map<string, OccurrenceStatistics>;
};

/** The key under which components sharing a presented package and a display name collide. */
export function displayNameCollisionKey(packageName: string | null, displayName: string): string {
  return `${packageName ?? "<no-pkg>"}|${displayName}`;
}

export function createComponentProjectionContext(artifact: ScanArtifact): ComponentProjectionContext {
  const components = new Map<string, Component>();
  const names = new Map<string, string>();
  const collisions = new Map<string, number>();
  for (const component of artifact.components) {
    components.set(component.id, component);
    const name = displayNameOf(component);
    names.set(component.id, name);
    const key = displayNameCollisionKey(presentIdentity(component).packageName, name);
    collisions.set(key, (collisions.get(key) ?? 0) + 1);
  }
  return { artifact, components, names, collisions };
}

export function createProjectionContext(artifact: ScanArtifact): ProjectionContext {
  const context = createComponentProjectionContext(artifact);
  const occurrences = resolvedOccurrences(artifact.occurrences);
  const occurrencesByComponent = new Map<string, ResolvedOccurrence[]>();
  const occurrenceStatistics = new Map<string, OccurrenceStatistics>();
  for (const occurrence of occurrences) {
    const { componentId } = occurrence.resolution;
    const componentOccurrences = occurrencesByComponent.get(componentId) ?? [];
    componentOccurrences.push(occurrence);
    occurrencesByComponent.set(componentId, componentOccurrences);
    const stats = occurrenceStatistics.get(componentId) ?? { count: 0, files: new Set<string>() };
    stats.count++;
    stats.files.add(occurrence.filePath);
    occurrenceStatistics.set(componentId, stats);
  }
  return { ...context, occurrences, occurrencesByComponent, occurrenceStatistics };
}
