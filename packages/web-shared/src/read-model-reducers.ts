import type {
  RepoSummary,
  RepoDetail,
  ScanFinding,
  ComponentRow,
  PackageSummary,
  PackageDetail,
  PackageRepoVersionCell,
  PackageComponentRow,
  ComponentSummary,
  ComponentDetailHead,
  OccurrenceRow,
  ComponentKind,
  CrossRepoComponentDetail,
  CrossRepoUsage,
  Tag,
  GovernanceRecord,
  RepoDelta,
} from "./dto.js";
import { resolveTags } from "./tags.js";
import { resolveGovernance, isDeprecated, governingRecord, componentDeprecated, type GovernanceLookup } from "./governance.js";
import { parseQuery, matchesQuery } from "./query.js";
import { strongerUsage } from "./usage.js";
import type { DigestScan } from "./digest.js";
import { disambiguatorOf, governanceKey, presentIdentity, tagClaimants, type GovernanceIdentity, type PresentableComponent } from "./present-identity.js";
import { displayNameCollisionKey } from "./projection-context.js";
import { representativeUsage } from "./representative.js";
import { diffForScan, repoDelta } from "./scan-diff.js";
import type { ComponentFact, FactScan, DetailRow, OccurrenceModelRow, GraphRow } from "./read-models.js";
import type { CompositionGraph } from "./composition-graph.js";

/** The fact fields `presentIdentity` reads. */
type IdentityFact = Pick<ComponentFact, keyof PresentableComponent>;
export type RepoFact = IdentityFact & Pick<ComponentFact, "id" | "stats" | "usage">;
export type ComponentRowFact = RepoFact & Pick<ComponentFact, "displayName" | "writtenNames" | "disambiguator" | "version" | "usedIn">;
export type SummaryFact = RepoFact & Pick<ComponentFact, "displayName">;
export type PackageDetailFact = SummaryFact & Pick<ComponentFact, "version" | "usedIdentityKey">;
export type CrossRepoFact = IdentityFact & Pick<ComponentFact, "id" | "stats" | "displayName" | "version">;
export type PackageFact = IdentityFact & Pick<ComponentFact, "id" | "packages" | "usedIdentityKey" | "stats">;

/** The governance lookup a stored row carries; null when its component is ungovernable. */
const storedLookup = ({ packageName, exportName }: GovernanceIdentity): GovernanceLookup | null =>
  packageName === null ? null : { packageName, name: exportName };

/** A component as one scan holds it. */
type ScanUsage<C> = { meta: FactScan["meta"]; component: C };

/** How a component seen in several scans is presented: as its `representativeUsage` presents it. */
function presentAcrossScans(usages: ScanUsage<IdentityFact & Pick<ComponentFact, "displayName">>[]) {
  const usage = representativeUsage(usages);
  if (usage === null) throw new Error("A component presented across scans needs at least one usage");
  const { kind, packageName, scope } = presentIdentity(usage.component);
  return { kind, packageName, scope, displayName: usage.component.displayName };
}

/** The entry point or file of a component seen in several scans, read from the usage `presentAcrossScans` presents. */
function disambiguatorAcrossScans(usages: ScanUsage<IdentityFact>[]): string | null {
  const usage = representativeUsage(usages);
  return usage === null ? null : disambiguatorOf(presentIdentity(usage.component));
}

/** Rows keep their disambiguator only where another row shares their package and name. */
function disambiguateCollisions<R extends { displayName: string; disambiguator: string | null }>(rows: R[], packageOf: (row: R) => string | null): R[] {
  const key = (row: R) => displayNameCollisionKey(packageOf(row), row.displayName);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return rows.map(row => ((counts.get(key(row)) ?? 0) > 1 ? row : { ...row, disambiguator: null }));
}

/** Totals for one component id across scans. */
type CrossScanBucket<C> = { totalOccurrences: number; deprecated: boolean; repoIds: Set<string>; usage: ComponentFact["usage"]; usages: ScanUsage<C>[] };

export function reduceComponentDetailHead(row: DetailRow, governance: GovernanceRecord[] = [], fact?: Pick<ComponentFact, "attribution">): ComponentDetailHead {
  const lookup = storedLookup(row.governanceTarget);
  const status = resolveGovernance(lookup, governance);
  return { ...row.head, claimedBy: fact ? tagClaimants(fact) : [], deprecated: isDeprecated(status), migrationStatus: status, governedByRecordId: governingRecord(lookup, governance)?.id ?? null };
}

export function reduceOccurrences(rows: Iterable<OccurrenceModelRow>, componentId: string): OccurrenceRow[] {
  return [...rows].filter(row => row.componentId === componentId).sort((a, b) =>
    a.occurrence.filePath.localeCompare(b.occurrence.filePath) || a.occurrence.line - b.occurrence.line || a.occurrence.column - b.occurrence.column || a.ordinal - b.ordinal,
  ).map(row => row.occurrence);
}

export function reduceCompositionGraph(rows: Iterable<GraphRow>, governance: GovernanceRecord[] = []): CompositionGraph {
  const nodes: Array<{ ordinal: number; node: CompositionGraph["nodes"][number] }> = [];
  const edges: Array<{ ordinal: number; edge: CompositionGraph["edges"][number] }> = [];
  for (const row of rows) {
    if (row.kind === "graph-node") nodes.push({ ordinal: row.ordinal, node: { ...row.node, deprecated: isDeprecated(resolveGovernance(storedLookup(row.governanceTarget), governance)) } });
    if (row.kind === "graph-edge") edges.push(row);
  }
  return {
    nodes: nodes.sort((a, b) => b.node.occurrenceCount - a.node.occurrenceCount || a.ordinal - b.ordinal).map(row => row.node),
    edges: edges.sort((a, b) => b.edge.count - a.edge.count || a.ordinal - b.ordinal).map(row => row.edge),
  };
}

export function reduceRepoSummary(
  artifact: FactScan<RepoFact>,
  ctx: { scanCount: number; delta: RepoDelta | null },
  governance: GovernanceRecord[] = [],
): RepoSummary {
  const { meta, components } = artifact;
  const repo = meta.repo;

  let external = 0;
  let local = 0;
  let totalOccurrences = 0;
  const packages = new Set<string>();
  const frameworks = new Map<ComponentKind, number>();
  let deprecated = 0;

  for (const c of components) {
    const { scope, packageName, kind } = presentIdentity(c);
    if (scope === "external") external++;
    else local++;
    if (componentDeprecated(c, governance)) deprecated++;
    totalOccurrences += c.stats.occurrenceCount;
    if (packageName) packages.add(packageName);
    frameworks.set(kind, (frameworks.get(kind) ?? 0) + 1);
  }

  const frameworkCounts = [...frameworks.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  return {
    repoId: repo.id,
    gitRemote: repo.gitRemote ?? null,
    branch: repo.branch,
    commit: repo.commit,
    committedAt: meta.committedAt,
    scanCount: ctx.scanCount,
    // Every component in the scan, rendered or not: the repo page lists the same set.
    componentCount: components.length,
    externalComponentCount: external,
    localComponentCount: local,
    packageCount: packages.size,
    deprecatedCount: deprecated,
    totalOccurrences,
    frameworkCounts,
    delta: ctx.delta,
  };
}

export function reduceRepoDetail(
  artifact: FactScan<RepoFact>,
  ctx: { scanCount: number; digests: DigestScan[]; tags: Tag[]; findings: ScanFinding[] },
  governance: GovernanceRecord[] = [],
): RepoDetail {
  // Baseline is the scan immediately before the shown scan, so an older
  // `?scan=` compares against its own predecessor, never against the newest.
  const diff = diffForScan(ctx.digests, artifact.meta.scanId, governance, ctx.tags);
  const summary = reduceRepoSummary(
    artifact,
    { scanCount: ctx.scanCount, delta: diff === null ? null : repoDelta(diff) },
    governance,
  );
  return {
    ...summary,
    initialCommit: artifact.meta.repo.initialCommit ?? null,
    scanId: artifact.meta.scanId,
    arrivedAt: artifact.meta.arrivedAt,
    scannerVersion: artifact.meta.scannerVersion,
    diff,
    scope: artifact.meta.scope ?? null,
    findings: ctx.findings,
  };
}

export function reduceComponentRows(
  artifact: FactScan<ComponentRowFact>,
  q: string,
  governance: GovernanceRecord[] = [],
  tags: Tag[] = [],
): ComponentRow[] {
  const { ast, error } = parseQuery(q);
  if (error) return []; // malformed query → no rows (not match-all)

  const rows: ComponentRow[] = [];
  for (const c of artifact.components) {
    if (ast && !matchesQuery(ast, c, governance, tags)) continue;

    const { kind, scope, packageName } = presentIdentity(c);
    rows.push({
      componentId: c.id,
      kind,
      scope,
      packageName,
      displayName: c.displayName,
      ...(c.writtenNames.length > 0 ? { writtenNames: c.writtenNames } : {}),
      disambiguator: c.disambiguator,
      version: c.version ?? null,
      occurrenceCount: c.stats.occurrenceCount,
      fileCount: c.stats.fileCount,
      ...(c.usedIn != null ? { usedIn: c.usedIn } : {}),
      deprecated: componentDeprecated(c, governance),
      tags: resolveTags(packageName, tags),
    });
  }
  return rows;
}

const soleVersionOf = (versions: Set<string>): string | null =>
  versions.size === 1 ? (versions.values().next().value ?? null) : null;

export function reducePackagesAcrossScans(artifacts: FactScan<PackageFact>[], governance: GovernanceRecord[] = []): PackageSummary[] {
  // Map: packageName → accumulator
  const acc = new Map<string, {
    consumers: Set<string>;
    // Used-component keys, not a raw appearance count: a component
    // reached the same way from N repos still contributes 1 if it's used in at least one.
    usedKeys: Set<string>;
    totalOccurrences: number;
    deprecatedIds: Set<string>;
    versions: Set<string>;
  }>();

  for (const a of artifacts) {
    for (const c of a.components) {
      for (const { packageName: pkg, versions } of c.packages) {
        let entry = acc.get(pkg);
        if (!entry) {
          entry = { consumers: new Set(), usedKeys: new Set(), totalOccurrences: 0, deprecatedIds: new Set(), versions: new Set() };
          acc.set(pkg, entry);
        }
        entry.consumers.add(a.meta.repo.id);
        if (c.usedIdentityKey !== null) entry.usedKeys.add(c.usedIdentityKey);
        entry.totalOccurrences += c.stats.occurrenceCount;
        if (componentDeprecated(c, governance)) entry.deprecatedIds.add(c.id);
        for (const version of versions) entry.versions.add(version);
      }
    }
  }

  return [...acc.entries()]
    .map(([packageName, e]) => ({
      packageName,
      consumerCount: e.consumers.size,
      componentCount: e.usedKeys.size,
      totalOccurrences: e.totalOccurrences,
      deprecatedCount: e.deprecatedIds.size,
      distinctVersionCount: e.versions.size,
      soleVersion: soleVersionOf(e.versions),
    }))
    .sort((a, b) => b.totalOccurrences - a.totalOccurrences);
}

export function reducePackageDetail(
  artifacts: FactScan<PackageDetailFact>[],
  packageName: string,
  governance: GovernanceRecord[] = [],
): PackageDetail | null {
  const cellKey = (repoId: string, version: string | null) =>
    `${repoId} ${version ?? ""}`;
  const cells = new Map<string, PackageRepoVersionCell>();
  const componentBuckets = new Map<string, CrossScanBucket<PackageDetailFact>>();
  const consumers = new Set<string>();
  const versions = new Set<string>();
  // Headline count = distinct used identities, not raw appearances;
  // the full `components` list below stays complete regardless.
  const usedKeys = new Set<string>();
  let totalOccurrences = 0;
  let found = false;

  for (const a of artifacts) {
    const repoId = a.meta.repo.id;
    const committedAt = a.meta.committedAt;
    for (const c of a.components) {
      if (presentIdentity(c).packageName !== packageName) continue;
      found = true;

      const dep = componentDeprecated(c, governance);

      consumers.add(repoId);
      if (c.usedIdentityKey !== null) usedKeys.add(c.usedIdentityKey);
      totalOccurrences += c.stats.occurrenceCount;
      if (c.version) versions.add(c.version);

      const version = c.version ?? null;
      const cKey = cellKey(repoId, version);
      const existingCell = cells.get(cKey);
      if (existingCell) {
        existingCell.occurrenceCount += c.stats.occurrenceCount;
      } else {
        cells.set(cKey, { repoId, version, occurrenceCount: c.stats.occurrenceCount, committedAt });
      }

      addToBucket(componentBuckets, a.meta, c, dep);
    }
  }

  if (!found) return null;

  const components = disambiguateCollisions(
    [...componentBuckets].map(([componentId, b]): PackageComponentRow => {
      const { displayName, kind } = presentAcrossScans(b.usages);
      return { componentId, displayName, kind, disambiguator: disambiguatorAcrossScans(b.usages), totalOccurrences: b.totalOccurrences, consumerCount: b.repoIds.size, deprecated: b.deprecated, usage: b.usage };
    }),
    () => packageName,
  ).sort((a, b) => b.totalOccurrences - a.totalOccurrences);

  return {
    packageName,
    consumerCount: consumers.size,
    componentCount: usedKeys.size,
    totalOccurrences,
    deprecatedCount: components.filter(row => row.deprecated).length,
    distinctVersionCount: versions.size,
    soleVersion: soleVersionOf(versions),
    cells: [...cells.values()],
    components,
  };
}

export function reduceComponentsAcrossScans(
  artifacts: FactScan<SummaryFact>[],
  governance: GovernanceRecord[] = [],
): ComponentSummary[] {
  const byId = new Map<string, CrossScanBucket<SummaryFact>>();
  for (const a of artifacts) {
    for (const c of a.components) addToBucket(byId, a.meta, c, componentDeprecated(c, governance));
  }
  return disambiguateCollisions(
    [...byId].map(([componentId, b]): ComponentSummary => {
      const [soleRepoId] = b.repoIds;
      return {
        componentId,
        ...presentAcrossScans(b.usages),
        disambiguator: disambiguatorAcrossScans(b.usages),
        totalOccurrences: b.totalOccurrences,
        repoCount: b.repoIds.size,
        repoId: b.repoIds.size === 1 ? soleRepoId ?? null : null,
        deprecated: b.deprecated,
        usage: b.usage,
      };
    }),
    row => row.packageName,
  ).sort((a, b) => b.totalOccurrences - a.totalOccurrences);
}

function addToBucket<C extends Pick<ComponentFact, "id" | "stats" | "usage">>(
  buckets: Map<string, CrossScanBucket<C>>, meta: FactScan["meta"], c: C, deprecated: boolean,
): void {
  const bucket = buckets.get(c.id) ?? { totalOccurrences: 0, deprecated: false, repoIds: new Set<string>(), usage: c.usage, usages: [] };
  bucket.totalOccurrences += c.stats.occurrenceCount;
  bucket.deprecated ||= deprecated;
  bucket.repoIds.add(meta.repo.id);
  bucket.usage = strongerUsage(bucket.usage, c.usage);
  bucket.usages.push({ meta, component: c });
  buckets.set(c.id, bucket);
}

export function reduceCrossRepoComponent(
  latestArtifacts: FactScan<CrossRepoFact>[],
  componentId: string,
  governance: GovernanceRecord[] = [],
): CrossRepoComponentDetail | null {
  const usages: CrossRepoUsage[] = [];
  const found: ScanUsage<CrossRepoFact>[] = [];
  const versions = new Set<string>();

  for (const a of latestArtifacts) {
    const c = a.components.find(comp => comp.id === componentId);
    if (!c) continue;
    found.push({ meta: a.meta, component: c });
    if (c.version) versions.add(c.version);
    usages.push({
      repoId: a.meta.repo.id,
      version: c.version ?? null,
      occurrenceCount: c.stats.occurrenceCount,
      deprecated: componentDeprecated(c, governance),
      committedAt: a.meta.committedAt,
    });
  }

  if (!found.length) return null;

  usages.sort((x, y) => y.occurrenceCount - x.occurrenceCount);
  // Governance reads the representative among the scans where the component is governable.
  const governable = representativeUsage(found.filter(u => governanceKey(u.component) !== null));
  const lookup = governable === null ? null : governanceKey(governable.component);

  return {
    componentId,
    ...presentAcrossScans(found),
    repoCount: usages.length,
    totalOccurrences: usages.reduce((sum, u) => sum + u.occurrenceCount, 0),
    distinctVersionCount: versions.size,
    deprecatedAnywhere: usages.some(u => u.deprecated),
    migrationStatus: resolveGovernance(lookup, governance),
    governedByRecordId: governingRecord(lookup, governance)?.id ?? null,
    usages,
  };
}
