import { displayNameOf, type Component, type ResolvedOccurrence, type ScanArtifact } from "@scoutui/scan-format";
import type { ComponentDetailHead, ComponentSummaryBand, CompositionEdge, DeclaredMeta, EventUsage, OccurrencePropChip, OccurrenceRow, PackageCounts, PropUsage, ReferenceSource, ScanFinding, WrittenValue } from "./dto.js";
import { type ComponentDigest, toComponentDigest } from "./digest.js";
import type { CompositionGraphEdge, CompositionGraphNode } from "./composition-graph.js";
import { shownWrittenName } from "./display-name.js";
import { disambiguatorOf, governanceIdentity, presentIdentity, type GovernanceIdentity } from "./present-identity.js";
import { deriveScanFindings } from "./scan-findings.js";
import { createComponentProjectionContext, displayNameCollisionKey, type ComponentProjectionContext, type OccurrenceStatistics, type ProjectionContext } from "./projection-context.js";
import { usedComponentKey, isUsed } from "./usage.js";

// A stored-format change increments READ_MODEL_FORMAT_VERSION and PROJECTION_VERSION together.
export const PROJECTION_VERSION: number = 9;
export const READ_MODEL_FORMAT_VERSION: number = 6;

export type ImmutableDetailHead = Omit<ComponentDetailHead, "claimedBy" | "deprecated" | "migrationStatus" | "governedByRecordId">;
export type ComponentFact = Pick<Component, "id" | "identity" | "framework" | "attribution" | "owningPackage" | "stats" | "usage" | "version"> & {
  displayName: string;
  /** The other names files render this component under, most used first. */
  writtenNames: string[];
  packages: Array<{ packageName: string; versions: string[] }>;
  disambiguator: string | null;
  usedIdentityKey: string | null;
  digest: ComponentDigest;
  /** Uses and files per package the uses sit in; absent when the scan records no package on the component's uses. */
  usedIn?: Record<string, PackageCounts>;
};
/** A stored scan's meta as pages read it: the scan file's, with the commit date and arrival time of its `scans` row in place of the file's `scannedAt`. */
export type StoredScanMeta = Omit<ScanArtifact["meta"], "scannedAt"> & { committedAt: string; arrivedAt: string };
export type FactScan<T = ComponentFact> = {
  meta: StoredScanMeta;
  components: T[];
};
type RowKey = { scanId: string; ordinal: number };
export type RepoViewRow = RowKey & { kind: "repo"; meta: ScanArtifact["meta"]; findings: ScanFinding[] };
export type ComponentFactRow = RowKey & { kind: "component"; componentId: string; fact: ComponentFact };
export type PackageContributionRow = RowKey & {
  kind: "package";
  packageName: string;
  componentId: string;
  versions: string[];
  usedIdentityKey: string | null;
  occurrenceCount: number;
  governanceTarget: GovernanceIdentity;
};
export type DetailRow = RowKey & { kind: "detail"; selector: string; head: ImmutableDetailHead; governanceTarget: GovernanceIdentity };
export type OccurrenceModelRow = RowKey & { kind: "occurrence"; componentId: string; occurrence: OccurrenceRow };
export type GraphRow = RowKey & (
  { kind: "graph-node"; node: Omit<CompositionGraphNode, "deprecated">; governanceTarget: GovernanceIdentity }
  | { kind: "graph-edge"; edge: CompositionGraphEdge }
);
export type ReadModelRow = RepoViewRow | ComponentFactRow | PackageContributionRow | DetailRow | OccurrenceModelRow | GraphRow;

function deriveComponentFact(context: ComponentProjectionContext, component: Component, stats?: OccurrenceStatistics): ComponentFact {
  const presented = presentIdentity(component);
  const displayName = context.names.get(component.id) ?? displayNameOf(component);
  const collides = (context.collisions.get(displayNameCollisionKey(presented.packageName, displayName)) ?? 0) > 1;
  return {
    id: component.id,
    identity: component.identity,
    ...(component.framework !== undefined ? { framework: component.framework } : {}),
    ...(component.attribution !== undefined ? { attribution: component.attribution } : {}),
    ...(component.owningPackage !== undefined ? { owningPackage: component.owningPackage } : {}),
    stats: component.stats,
    usage: component.usage,
    version: component.version,
    displayName,
    writtenNames: (component.writtenNames ?? []).filter(written => shownWrittenName(written, displayName) !== undefined),
    packages: presented.packageName === null ? [] : [{ packageName: presented.packageName, versions: component.version ? [component.version] : [] }],
    disambiguator: collides ? disambiguatorOf(presented) : null,
    usedIdentityKey: isUsed(component) ? usedComponentKey(component) : null,
    digest: toComponentDigest(component),
    ...(stats?.byPackage.size
      ? { usedIn: Object.fromEntries([...stats.byPackage].map(([name, inPackage]) => [name, { occurrenceCount: inPackage.count, fileCount: inPackage.files.size }])) }
      : {}),
  };
}

function deriveRepoView(artifact: ScanArtifact): RepoViewRow {
  return { kind: "repo", scanId: artifact.meta.scanId, ordinal: 0, meta: artifact.meta, findings: deriveScanFindings(artifact) };
}

export function deriveFactScan(artifact: ScanArtifact, context = createComponentProjectionContext(artifact)): { meta: ScanArtifact["meta"]; components: ComponentFact[] } {
  return { meta: artifact.meta, components: artifact.components.map(component => deriveComponentFact(context, component)) };
}

/**
 * An occurrence's row. `names` holds each component's display name: the row keeps a written name only when it
 * differs from its component's, and names the component that renders it when the scan holds that component.
 */
export function deriveOccurrenceRow(occurrence: ResolvedOccurrence, names: ReadonlyMap<string, string>): OccurrenceRow {
  const props: OccurrencePropChip[] = Object.entries(occurrence.props).map(([name, state]) => {
    if (state.tier === "dynamic") return { kind: "dynamic", name };
    if (state.tier === "reference") return { kind: "reference", name, ref: state.ref };
    return { kind: "literal", name, value: "valueSet" in state ? state.valueSet.map(String).join(" | ") : String(state.value) };
  });
  const writtenName = shownWrittenName(occurrence.writtenName, names.get(occurrence.resolution.componentId) ?? "");
  const ownerId = occurrence.ownerComponentId;
  const ownerName = ownerId === undefined ? undefined : names.get(ownerId);
  return {
    occurrenceId: occurrence.occurrenceId, filePath: occurrence.filePath, line: occurrence.line, column: occurrence.column,
    credit: occurrence.credit, trace: occurrence.trace, ...(writtenName !== undefined ? { writtenName } : {}),
    ...(ownerId !== undefined && ownerName !== undefined ? { owner: { componentId: ownerId, displayName: ownerName } } : {}),
    ...(occurrence.usedIn !== undefined ? { usedIn: occurrence.usedIn } : {}),
    props, events: occurrence.events ?? [],
  };
}

export function* deriveReadModelRows(artifact: ScanArtifact, context: ProjectionContext): Iterable<ReadModelRow> {
  if (context.artifact !== artifact) throw new Error("Projection context belongs to a different artifact");
  const scanId = artifact.meta.scanId;
  yield deriveRepoView(artifact);
  for (const [ordinal, component] of artifact.components.entries()) {
    const fact = deriveComponentFact(context, component, context.occurrenceStatistics.get(component.id));
    yield { kind: "component", scanId, ordinal, componentId: component.id, fact };
    for (const contribution of fact.packages) {
      yield { kind: "package", scanId, ordinal, componentId: component.id, ...contribution, usedIdentityKey: fact.usedIdentityKey, occurrenceCount: component.stats.occurrenceCount, governanceTarget: governanceIdentity(component) };
    }
  }
  for (const [ordinal, component] of artifact.components.entries()) {
    const row = deriveDetailRow(context, component.id, ordinal);
    if (row) yield row;
  }
  for (const [ordinal, occurrence] of context.occurrences.entries()) {
    const { componentId } = occurrence.resolution;
    yield { kind: "occurrence", scanId, ordinal, componentId, occurrence: deriveOccurrenceRow(occurrence, context.names) };
  }
  yield* deriveGraphRows(context);
}

/** The detail row for one component; `selector` is its component id. */
export function deriveDetailRow(context: ProjectionContext, selector: string, ordinal = 0): DetailRow | null {
  const component = context.components.get(selector);
  const head = deriveComponentDetailHead(context, selector);
  if (!component || !head) return null;
  return { kind: "detail", scanId: context.artifact.meta.scanId, ordinal, selector, head, governanceTarget: governanceIdentity(component) };
}

export function* deriveGraphRows(context: ComponentProjectionContext): Iterable<GraphRow> {
  const artifact = context.artifact;
  const scanId = artifact.meta.scanId;
  for (const [ordinal, component] of artifact.components.entries()) {
    const { packageName, filePath, scope } = presentIdentity(component);
    yield { kind: "graph-node", scanId, ordinal, governanceTarget: governanceIdentity(component), node: { id: component.id, displayName: displayNameOf(component), packageName, filePath, scope, occurrenceCount: component.stats.occurrenceCount } };
  }
  let ordinal = 0;
  for (const component of artifact.components) {
    for (const [childId, count] of Object.entries(component.composition.rendersByCount)) {
      if (childId === component.id || !context.components.has(childId)) continue;
      yield { kind: "graph-edge", scanId, ordinal: ordinal++, edge: { source: component.id, target: childId, count } };
    }
  }
}

export function deriveComponentDetailHead(context: ProjectionContext, componentId: string): ImmutableDetailHead | null {
  const component = context.components.get(componentId);
  if (!component) return null;
  const presented = presentIdentity(component);
  const byId = context.components;

  const declaredApi = component.declared ?? null;
  const hasDeclaredApi = declaredApi !== null;
  const hasRest = declaredApi?.hasRest ?? false;
  const declaredKeys = new Set(Object.keys(declaredApi?.props ?? {}));

  const declaredMetaFor = (name: string): DeclaredMeta | null => {
    const d = declaredApi?.props[name];
    if (!d) return null;
    return {
      type: d.type ?? null,
      required: d.required ?? null,
      default: d.default === undefined ? null : String(d.default),
    };
  };

  const props: PropUsage[] = Object.entries(component.props).map(([name, dist]) => {
    const written: WrittenValue[] = [];
    const references: ReferenceSource[] = [];
    for (const e of dist.values) {
      if (e.provenance === "reference") {
        references.push({ ref: e.ref, count: e.count });
      } else {
        const value = "valueSet" in e ? e.valueSet.map(String).join(" | ") : String(e.value);
        written.push({ value, count: e.count });
      }
    }
    written.sort((a, b) => b.count - a.count);
    references.sort((a, b) => b.count - a.count);
    return {
      name,
      written,
      references,
      dynamicCount: dist.dynamic,
      omittedCount: dist.omitted,
      truncatedWrittenCount: dist.truncated ?? 0,
      status: !hasDeclaredApi ? null : declaredKeys.has(name) ? "used" : "undeclared",
      declared: declaredMetaFor(name),
    };
  });

  if (hasDeclaredApi) {
    for (const name of declaredKeys) {
      if (name in component.props) continue;
      props.push({
        name,
        written: [], references: [], dynamicCount: 0,
        omittedCount: 0, truncatedWrittenCount: 0,
        status: "unused",
        declared: declaredMetaFor(name),
      });
    }
  }

  const events: EventUsage[] = Object.entries(component.events ?? {})
    .map(([name, dist]) => ({ name, boundCount: dist.boundCount }))
    .sort((a, b) => b.boundCount - a.boundCount);

  const { rendersByCount, renderedByCount } = component.composition;

  const renders: CompositionEdge[] = Object.entries(rendersByCount)
    .map(([childId, count]) => edgeFor(byId, childId, count))
    .filter((e): e is CompositionEdge => e !== null)
    .sort((a, b) => b.count - a.count);

  const renderedBy: CompositionEdge[] = Object.entries(renderedByCount)
    .map(([parentId, count]) => edgeFor(byId, parentId, count))
    .filter((e): e is CompositionEdge => e !== null)
    .sort((a, b) => b.count - a.count);

  const definedAt =
    component.identity.kind === "repository-declaration" && component.definition
      ? {
          filePath: component.identity.filePath,
          line: component.definition.line,
          column: component.definition.column,
        }
      : null;

  const statistics = context.occurrenceStatistics.get(componentId);
  const summary: ComponentSummaryBand = {
    footprint: {
      callCount: statistics?.count ?? 0,
      fileCount: statistics?.files.size ?? 0,
      rendersCount: Object.keys(rendersByCount).length,
      renderedByCount: Object.keys(renderedByCount).length,
    },
    apiUsage: {
      declaredCount: declaredKeys.size,
      usedCount: props.filter(p => p.status === "used").length,
      neverUsedCount: props.filter(p => p.status === "unused").length,
      undeclaredCount: props.filter(p => p.status === "undeclared").length,
    },
    provenance: props.reduce(
      (acc, p) => ({
        written: acc.written + p.written.reduce((s, w) => s + w.count, 0),
        reference: acc.reference + p.references.reduce((s, r) => s + r.count, 0),
        dynamic: acc.dynamic + p.dynamicCount,
      }),
      { written: 0, reference: 0, dynamic: 0 },
    ),
  };

  return {
    componentId,
    repoId: context.artifact.meta.repo.id,
    displayName: displayNameOf(component),
    packageName: presented.packageName,
    publicEntry: presented.publicEntry,
    scope: presented.scope,
    kind: presented.kind,
    version: component.version,
    hasDeclaredApi,
    hasRest,
    definedAt,
    props,
    events,
    composition: {
      renders,
      renderedBy,
      isRootCount: component.composition.isRootCount,
      isLeafCount: component.composition.isLeafCount,
    },
    summary,
  };
}

function edgeFor(
  byId: Map<string, Component>,
  componentId: string,
  count: number,
): CompositionEdge | null {
  const c = byId.get(componentId);
  if (!c) return null;
  const { packageName, scope } = presentIdentity(c);
  return {
    componentId,
    displayName: displayNameOf(c),
    packageName,
    scope,
    count,
  };
}
