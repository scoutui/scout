import { displayNameOf, resolvedOccurrences, type Component, type ResolvedOccurrence, type ScanArtifact } from "@scoutui/scan-format";
import { presentIdentity } from "./present-identity.js";
import { unseenBy } from "./use-visibility.js";

export type OccurrenceStatistics = {
  count: number;
  files: Set<string>;
  /** Uses with props Scout can't all see (`unseenBy` isn't null). */
  unseen: number;
  /** For each prop name, the fully seen uses that name it. */
  seenNamed: Map<string, number>;
  /** Uses and files per package the uses sit in, for uses the scan records a package on. */
  byPackage: Map<string, { count: number; files: Set<string> }>;
};

export type ComponentProjectionContext = {
  artifact: ScanArtifact;
  components: Map<string, Component>;
  names: Map<string, string>;
  collisions: Map<string, number>;
  /** Each package export's id by `packageExportKey`, the first listed when several entries share one. */
  packageExports: Map<string, string>;
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

/** The key a package export is found under by its package and export name, whatever its entry. */
export function packageExportKey(packageName: string, exportName: string): string {
  return `${packageName}|${exportName}`;
}

export function createComponentProjectionContext(artifact: ScanArtifact): ComponentProjectionContext {
  const components = new Map<string, Component>();
  const names = new Map<string, string>();
  const collisions = new Map<string, number>();
  const packageExports = new Map<string, string>();
  for (const component of artifact.components) {
    components.set(component.id, component);
    const name = displayNameOf(component);
    names.set(component.id, name);
    const key = displayNameCollisionKey(presentIdentity(component).packageName, name);
    collisions.set(key, (collisions.get(key) ?? 0) + 1);
    const { identity } = component;
    if (identity.kind === "package-export") {
      const exportKey = packageExportKey(identity.packageName, identity.exportName);
      if (!packageExports.has(exportKey)) packageExports.set(exportKey, component.id);
    }
  }
  return { artifact, components, names, collisions, packageExports };
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
    const stats = occurrenceStatistics.get(componentId) ?? {
      count: 0, files: new Set<string>(), unseen: 0, seenNamed: new Map<string, number>(), byPackage: new Map<string, { count: number; files: Set<string> }>(),
    };
    stats.count++;
    stats.files.add(occurrence.filePath);
    const propNames = Object.keys(occurrence.props);
    if (unseenBy({ propNames, credit: occurrence.credit, trace: occurrence.trace })) stats.unseen++;
    else for (const name of propNames) stats.seenNamed.set(name, (stats.seenNamed.get(name) ?? 0) + 1);
    if (occurrence.usedIn !== undefined) {
      const inPackage = stats.byPackage.get(occurrence.usedIn) ?? { count: 0, files: new Set<string>() };
      inPackage.count++;
      inPackage.files.add(occurrence.filePath);
      stats.byPackage.set(occurrence.usedIn, inPackage);
    }
    occurrenceStatistics.set(componentId, stats);
  }
  return { ...context, occurrences, occurrencesByComponent, occurrenceStatistics };
}
