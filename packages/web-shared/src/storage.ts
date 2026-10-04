import type { DigestScan } from "./digest.js";
import type { CompositionGraph } from "./composition-graph.js";
import type {
  RepoSummary,
  RepoDetail,
  ScanSummary,
  PackageSummary,
  PackageDetail,
  ComponentSummary,
  ComponentRow,
  ComponentDetailHead,
  OccurrenceRow,
  CrossRepoComponentDetail,
  Tag,
  TagInput,
  Dashboard,
  DashboardInput,
  ChartVisibility,
  GovernanceRecord,
  GovernanceInput,
  DashboardScope,
} from "./dto.js";
import type { GovernanceTracking } from "./governance-tracking.js";
import type { RecordAuthors } from "./governance.js";
import type { StoredPreview, StoredRegistry } from "./chart-results.js";

/**
 * A write that would collide with another record's target. The DB constraint
 * (`governance_target`, UNIQUE NULLS NOT DISTINCT) is the real guard: the
 * driver translates it so the server action can show the conflict instead of
 * overwriting another record.
 */
export class GovernanceTargetConflictError extends Error {
  constructor(
    readonly targetPackage: string,
    readonly targetExport: string | null,
  ) {
    super(
      `governance target already governed: ${targetPackage}${targetExport ? `/${targetExport}` : ""}`,
    );
    this.name = "GovernanceTargetConflictError";
  }
}

export class ReadModelUnavailableError extends Error {
  constructor(readonly scanIds: string[], readonly state: "preparing" | "failed", readonly retryable: boolean) {
    super(`Read models ${state} for scans: ${scanIds.join(", ")}`);
    this.name = "ReadModelUnavailableError";
  }
}

/** A scan a read skipped because it wasn't ready. `rebuilding`: it has stored models from an earlier build. */
export type SkippedScan = { scanId: string; rebuilding: boolean };

/**
 * A repo whose newest scans a latest-scan read skipped, newest first, and the scan it read in their place: its
 * newest ready scan, or null when it has none and the read left the repo out.
 */
export type ScanFallback = { repoId: string; skipped: SkippedScan[]; shownScanId: string | null };

/** What the reads through one snapshot skipped: repos read at an older scan, and scans left out of a history. */
export type SkippedScans = { fallbacks: ScanFallback[]; gaps: (SkippedScan & { repoId: string })[] };

export interface StorageDriver {
  withReadSnapshot<T>(fn: (driver: StorageDriver) => Promise<T>): Promise<T>;
  /** What the reads through this snapshot skipped because it wasn't ready. */
  skippedScans(): SkippedScans;
  /** All scanned repos, latest-scan-per-repo. */
  listRepos(): Promise<RepoSummary[]>;

  /** Every repo id, including repos that have no scans. */
  listRepoIds(): Promise<string[]>;

  /**
   * Detail page payload for one repo. If scanId is omitted, returns the latest scan.
   * Returns null when the repo is unknown or scanId doesn't match any stored scan.
   */
  getRepo(repoId: string, scanId?: string): Promise<RepoDetail | null>;

  /** The remote and commit of a repo's latest scan, without reading its components. Null when the repo is unknown. */
  getRepoHead(repoId: string): Promise<Pick<RepoDetail, "gitRemote" | "commit"> | null>;

  /** All scans for a repo, newest first. */
  listScans(repoId: string): Promise<ScanSummary[]>;

  /**
   * Slim per-scan component digests (no occurrences / props) for cohort
   * projections and the scan diff. `latestOnly` returns the latest scan per repo
   * (bars charts); `newestPerRepo: n` returns the
   * n newest scans per repo (the repos list needs 2 for its delta); omitted returns
   * full history (trend, stacked and table charts, and the stored chart results).
   * `componentIds` keeps only those components' digests, and leaves out the scans
   * that hold none of them (bars charts read the names of components older scans hold).
   */
  listScanDigests(repoId?: string, opts?: { latestOnly?: boolean; newestPerRepo?: number; componentIds?: string[] }): Promise<DigestScan[]>;

  /** Filtered components-table rows for a repo's scan (latest unless scanId given). `q` is a query string. */
  listComponentsForRepo(
    repoId: string,
    q: string,
    scanId?: string,
  ): Promise<ComponentRow[]>;

  getComponentDetailHead(repoId: string, componentId: string): Promise<ComponentDetailHead | null>;
  getComponentUsage(repoId: string, componentId: string): Promise<OccurrenceRow[]>;
  getCompositionGraph(repoId: string): Promise<CompositionGraph | null>;

  /** Per-component detail aggregated across all scanned repos (latest scan each). Null when the id is absent. */
  getCrossRepoComponent(componentId: string): Promise<CrossRepoComponentDetail | null>;

  /** Aggregated package list, optionally scoped to one repo's latest scan. */
  listPackages(repoId?: string): Promise<PackageSummary[]>;

  /** Per-package detail payload aggregated across all scanned repos. Null when unknown. */
  getPackage(packageName: string): Promise<PackageDetail | null>;

  /** Cross-repo aggregated component list (one row per components[] entry per repo). */
  listComponents(): Promise<ComponentSummary[]>;

  // ---- Tags (org-scoped, web-authored config) ----

  /** All tags, sorted by value. */
  listTags(): Promise<Tag[]>;

  /**
   * Create (no id) or update (matching id) a tag. Returns the stored tag.
   * `userId` is recorded as the tag's creator on create and as its last editor.
   */
  upsertTag(input: TagInput, userId?: string): Promise<Tag>;

  /** Delete a tag by id. No-op if absent. */
  deleteTag(id: string): Promise<void>;

  // ---- Governance (org-scoped, web-authored config) ----

  /** All governance records. */
  listGovernance(): Promise<GovernanceRecord[]>;

  /** Who created and last changed each governance record, keyed by record id. */
  listGovernanceAuthors(): Promise<Record<string, RecordAuthors>>;

  /**
   * Create a record, recording `userId` as its creator and last editor.
   * Throws `GovernanceTargetConflictError` if the target is already governed.
   */
  createGovernance(input: GovernanceInput, userId?: string): Promise<GovernanceRecord>;

  /**
   * Update the record with `id`, recording `userId` as its last editor.
   * Throws `GovernanceTargetConflictError` if retargeted onto another record's target.
   */
  updateGovernance(id: string, input: GovernanceInput, userId?: string): Promise<GovernanceRecord>;

  /** Delete a record by id. No-op if absent. */
  deleteGovernance(id: string): Promise<void>;

  // ---- Dashboards (saved cohort charts; global) ----

  /** All saved dashboards, sorted by name. */
  listDashboards(): Promise<Dashboard[]>;

  /** One dashboard by id, or null if absent. */
  getDashboard(id: string): Promise<Dashboard | null>;

  /** Create (no id) or update (matching id), keeping the stored creator. Returns the stored dashboard. */
  upsertDashboard(input: DashboardInput): Promise<Dashboard>;

  /** Delete by id. No-op if absent. */
  deleteDashboard(id: string): Promise<void>;

  /** Set who can open a dashboard, keeping its last-changed time. No-op if absent. */
  setDashboardVisibility(id: string, visibility: ChartVisibility): Promise<void>;

  // ---- Stored chart results (null when no row has the current format) ----

  getStoredTracking(scope: DashboardScope): Promise<GovernanceTracking[] | null>;
  getStoredRegistry(): Promise<StoredRegistry | null>;
  /** Current-format previews keyed by dashboard id. */
  getStoredPreviews(): Promise<Record<string, StoredPreview>>;
  /** When the dashboard last received a scan, as an ISO string, or null when there are no scans. */
  latestScanArrivedAt(): Promise<string | null>;
}
