import type { PoolClient } from "pg";
import type { DigestScan, ComponentDigest } from "../digest.js";
import type { ComponentFact, FactScan, RepoViewRow, DetailRow, OccurrenceModelRow, GraphRow, StoredScanMeta } from "../read-models.js";
import { READ_MODEL_FORMAT_VERSION } from "../read-models.js";
import { ReadModelUnavailableError, type SkippedScan, type SkippedScans } from "../storage.js";
import { newestScanFirstSql } from "../scan-order.js";

export type ScanSelection = {
  scan_id: string;
  repo_id: string;
  committed_at: Date | string;
  created_at: Date | string;
  branch: string | null;
  branch_position: number | null;
  scan_count: number;
  projection_version: number | null;
  format_version: number | null;
  state: string | null;
  build_revision: number | null;
  expected_counts: Record<(typeof countKinds)[number], number> | null;
  actual_counts: Record<(typeof countKinds)[number], number> | null;
  details_retained: boolean | null;
};

const countKinds = ["repo", "component", "package", "detail", "occurrence", "graph-node", "graph-edge"] as const;

export type ScanModelHeader = Pick<ScanSelection,
  "state" | "projection_version" | "format_version" | "build_revision" | "expected_counts" | "actual_counts" | "details_retained">;

/** Whether pages can read a scan from its stored model header. */
export function scanModelReady(scan: ScanModelHeader, details = false): boolean {
  return scan.state === "ready"
    && Number.isInteger(scan.projection_version) && (scan.projection_version ?? 0) > 0 && scan.format_version === READ_MODEL_FORMAT_VERSION
    && Number.isInteger(scan.build_revision) && (scan.build_revision ?? 0) > 0 && (!details || scan.details_retained === true)
    && countKinds.every(kind => Number.isInteger(scan.expected_counts?.[kind])
      && (scan.expected_counts?.[kind] ?? -1) >= 0 && scan.expected_counts?.[kind] === scan.actual_counts?.[kind])
    && scan.expected_counts?.repo === 1;
}

type RankedScan = ScanSelection & { rank: number };

/** Only a successful build writes a scan's model header, so a header on a scan that isn't ready is from an earlier version. */
function skippedScan(scan: ScanSelection): SkippedScan {
  return { scanId: scan.scan_id, rebuilding: scan.state !== null };
}

/**
 * `scanId` picks one scan, which must be ready. `latestOnly` and `newestPerRepo` read each repo's newest ready scans;
 * without them a read takes every ready scan. `record: false` keeps the skipped scans out of the snapshot's record.
 */
type SelectOptions = { scanId?: string; latestOnly?: boolean; newestPerRepo?: number; record?: boolean };

export class ReadModelReader {
  constructor(private readonly client: PoolClient, private readonly skipped: SkippedScans = { fallbacks: [], gaps: [] }) {}

  /**
   * Each repo's newest ready scans, or every ready scan, oldest first per repo. Records the newer scans skipped for
   * each repo, or the scans left out when reading every scan. A repo with no ready scan is left out, except that a
   * read with nothing ready to show, of one repo or of all of them, fails.
   */
  async select(repoId?: string, options: SelectOptions = {}): Promise<ScanSelection[]> {
    if (options.scanId) {
      const rows = await this.ranked({ repoId, scanId: options.scanId });
      this.requireReady(rows);
      return rows;
    }
    const limit = options.newestPerRepo ?? (options.latestOnly ? 1 : null);
    const selected: ScanSelection[] = [];
    const histories = await this.histories({ repoId, fromRank: 0 }, limit);
    for (const history of histories) {
      const ready = history.filter(scan => scanModelReady(scan));
      if (limit === null) {
        if (options.record !== false) this.recordGaps(history.filter(scan => !ready.includes(scan)));
        selected.push(...ready.reverse());
        continue;
      }
      const newest = ready[0];
      const skipped = newest ? history.slice(0, history.indexOf(newest)) : history;
      if (options.record !== false && skipped.length) this.recordFallback(skipped, newest?.scan_id ?? null);
      selected.push(...ready.slice(0, limit).reverse());
    }
    if (!selected.length) this.requireReady(histories.flatMap(history => history.slice(0, 1)));
    return selected;
  }

  /**
   * One repo's scan and the next older ready scan, newest first. The scan is the repo's newest ready scan, recording
   * the newer ones skipped, or the picked `scanId`, which must be ready.
   */
  async selectRepoDetail(repoId: string, scanId?: string): Promise<ScanSelection[]> {
    if (!scanId) return (await this.select(repoId, { newestPerRepo: 2 })).reverse();
    const [picked] = await this.ranked({ repoId, scanId });
    if (!picked) return [];
    this.requireReady([picked]);
    const [older] = (await this.histories({ repoId, fromRank: picked.rank }, 1)).flat().filter(scan => scanModelReady(scan));
    return older ? [picked, older] : [picked];
  }

  /**
   * Each repo's scans ranked below `fromRank`, newest first: `limit` deep, and the rest of the history only for a repo
   * without `limit` ready scans there. Without a limit, every scan.
   */
  private async histories(from: { repoId?: string | undefined; fromRank: number }, limit: number | null): Promise<RankedScan[][]> {
    const byRepo = new Map<string, RankedScan[]>();
    const add = (rows: RankedScan[]) => {
      for (const row of rows) {
        const history = byRepo.get(row.repo_id) ?? [];
        history.push(row);
        byRepo.set(row.repo_id, history);
      }
    };
    add(await this.ranked({ repoId: from.repoId, fromRank: from.fromRank, ...(limit === null ? {} : { toRank: from.fromRank + limit }) }));
    if (limit !== null) {
      const short = [...byRepo].filter(([, history]) => history.filter(scan => scanModelReady(scan)).length < limit
        && (history.at(-1)?.rank ?? 0) < (history[0]?.scan_count ?? 0)).map(([id]) => id);
      if (short.length) add(await this.ranked({ repoIds: short, fromRank: from.fromRank + limit }));
    }
    return [...byRepo.values()];
  }

  /** Scans with their stored model headers, ranked newest first within each repo, ordered by repo and rank. */
  private async ranked(filter: { repoId?: string | undefined; repoIds?: string[]; scanId?: string; fromRank?: number; toRank?: number }): Promise<RankedScan[]> {
    const { rows } = await this.client.query<RankedScan>(`
      WITH ranked AS (
        SELECT scan_id, repo_id, committed_at, created_at, branch, branch_position,
          COUNT(*) OVER (PARTITION BY repo_id)::int AS scan_count,
          (ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY ${newestScanFirstSql()}))::int AS rank
        FROM scans WHERE ($1::text IS NULL OR repo_id = $1) AND ($2::text[] IS NULL OR repo_id = ANY($2))
      )
      SELECT ranked.scan_id, ranked.repo_id, ranked.committed_at, ranked.created_at, ranked.branch, ranked.branch_position,
        ranked.scan_count, ranked.rank, model.projection_version, model.format_version, model.state, model.build_revision,
        model.expected_counts, model.actual_counts, model.details_retained
      FROM ranked LEFT JOIN scan_read_models model USING (scan_id)
      WHERE ($3::text IS NULL OR ranked.scan_id = $3) AND ranked.rank > $4 AND ($5::int IS NULL OR ranked.rank <= $5)
      ORDER BY ranked.repo_id, ranked.rank`,
    [filter.repoId ?? null, filter.repoIds ?? null, filter.scanId ?? null, filter.fromRank ?? 0, filter.toRank ?? null]);
    return rows;
  }

  private recordFallback(skipped: RankedScan[], shownScanId: string | null): void {
    const repoId = skipped[0]?.repo_id;
    if (!repoId || this.skipped.fallbacks.some(fallback => fallback.repoId === repoId)) return;
    this.skipped.fallbacks.push({ repoId, skipped: skipped.map(skippedScan), shownScanId });
  }

  private recordGaps(skipped: RankedScan[]): void {
    for (const scan of skipped) {
      if (!this.skipped.gaps.some(gap => gap.scanId === scan.scan_id)) this.skipped.gaps.push({ ...skippedScan(scan), repoId: scan.repo_id });
    }
  }

  requireReady(scans: ScanSelection[], details = false): void {
    const unavailable = scans.filter(scan => !scanModelReady(scan, details));
    if (unavailable.length) {
      const state = unavailable.some(scan => scan.state === "failed") ? "failed" : "preparing";
      throw new ReadModelUnavailableError(unavailable.map(scan => scan.scan_id), state, state === "preparing");
    }
  }

  private unavailable(scanIds: string[]): never {
    throw new ReadModelUnavailableError(scanIds, "preparing", true);
  }

  /** Each scan's repo view, with its commit date in place of the scan file's `scannedAt`, the branch and branch position its `scans` row stores, and its arrival time. */
  async repos(scans: ScanSelection[]): Promise<(Omit<RepoViewRow, "meta"> & { meta: StoredScanMeta })[]> {
    if (!scans.length) return [];
    const { rows } = await this.client.query<{ payload: RepoViewRow }>(
      "SELECT payload FROM scan_repo_views WHERE scan_id = ANY($1::text[])", [scans.map(scan => scan.scan_id)]);
    const byId = new Map(rows.map(row => [row.payload.scanId, row.payload]));
    return scans.map(scan => {
      const view = byId.get(scan.scan_id) ?? this.unavailable([scan.scan_id]);
      const { scannedAt: _scannedAt, ...meta } = view.meta;
      const { branchPosition: _, ...repo } = view.meta.repo;
      return { ...view, meta: { ...meta, committedAt: new Date(scan.committed_at).toISOString(), arrivedAt: new Date(scan.created_at).toISOString(), repo: {
        ...repo, branch: scan.branch, ...(scan.branch_position === null ? {} : { branchPosition: scan.branch_position }),
      } } };
    });
  }

  async facts<K extends keyof ComponentFact>(scans: ScanSelection[], fields: readonly K[], selector?: { componentId: string } | { packageName: string }): Promise<FactScan<Pick<ComponentFact, K>>[]> {
    const repos = await this.repos(scans);
    if (!scans.length) return [];
    const projection = fields.map(field => `'${field}', fact.payload->'fact'->'${field}'`).join(", ");
    const clause = selector && "componentId" in selector ? "AND fact.component_id = $2"
      : selector ? "AND EXISTS (SELECT 1 FROM scan_package_contributions p WHERE p.scan_id = fact.scan_id AND p.component_id = fact.component_id AND p.package_name = $2)" : "";
    const values: unknown[] = [scans.map(scan => scan.scan_id)];
    if (selector) values.push("componentId" in selector ? selector.componentId : selector.packageName);
    const { rows } = await this.client.query<{ scan_id: string; fact: Pick<ComponentFact, K> }>(`
      SELECT fact.scan_id, jsonb_build_object(${projection}) AS fact
      FROM scan_component_facts fact WHERE fact.scan_id = ANY($1::text[]) ${clause}
      ORDER BY fact.scan_id, fact.source_ordinal`, values);
    const grouped = new Map<string, Pick<ComponentFact, K>[]>();
    for (const row of rows) {
      const components = grouped.get(row.scan_id) ?? [];
      components.push(row.fact);
      grouped.set(row.scan_id, components);
    }
    return repos.map((repo, index) => {
      const components = grouped.get(repo.scanId) ?? [];
      if (!selector && components.length !== scans[index]?.expected_counts?.component) this.unavailable([repo.scanId]);
      return { meta: repo.meta, components };
    });
  }

  async digests(scans: ScanSelection[], componentIds?: string[]): Promise<DigestScan[]> {
    if (componentIds) return this.componentDigests(scans, componentIds);
    const repos = await this.repos(scans);
    if (!scans.length) return [];
    const { rows } = await this.client.query<{ scan_id: string; digest: ComponentDigest }>(`
      SELECT scan_id, payload->'fact'->'digest' AS digest FROM scan_component_facts
      WHERE scan_id = ANY($1::text[]) ORDER BY scan_id, source_ordinal`, [scans.map(scan => scan.scan_id)]);
    const components = new Map<string, ComponentDigest[]>();
    for (const row of rows) {
      const list = components.get(row.scan_id) ?? [];
      list.push(row.digest);
      components.set(row.scan_id, list);
    }
    return repos.map((repo, index) => {
      const list = components.get(repo.scanId) ?? [];
      const scan = scans[index];
      if (!scan || list.length !== scan.expected_counts?.component) this.unavailable([repo.scanId]);
      const { branchPosition } = repo.meta.repo;
      return {
        meta: { scanId: repo.scanId, committedAt: repo.meta.committedAt, arrivedAt: repo.meta.arrivedAt, repo: { id: repo.meta.repo.id, ...(branchPosition === undefined ? {} : { branchPosition }) } },
        components: list,
      };
    });
  }

  /** The digests of just `componentIds` in each of `scans`; a scan that holds none of them is left out. */
  private async componentDigests(scans: ScanSelection[], componentIds: string[]): Promise<DigestScan[]> {
    if (!scans.length || !componentIds.length) return [];
    const { rows } = await this.client.query<{ scan_id: string; digest: ComponentDigest }>(`
      SELECT scan_id, payload->'fact'->'digest' AS digest FROM scan_component_facts
      WHERE scan_id = ANY($1::text[]) AND component_id = ANY($2::text[]) ORDER BY scan_id, source_ordinal`,
    [scans.map(scan => scan.scan_id), componentIds]);
    const components = new Map<string, ComponentDigest[]>();
    for (const row of rows) {
      const list = components.get(row.scan_id) ?? [];
      list.push(row.digest);
      components.set(row.scan_id, list);
    }
    return scans.flatMap(scan => {
      const list = components.get(scan.scan_id);
      return list ? [{ meta: { scanId: scan.scan_id, committedAt: new Date(scan.committed_at).toISOString(), arrivedAt: new Date(scan.created_at).toISOString(), repo: { id: scan.repo_id } }, components: list }] : [];
    });
  }

  async detail(scans: ScanSelection[], selector: string): Promise<DetailRow | null> {
    this.requireReady(scans, true);
    if (!scans.length) return null;
    const { rows } = await this.client.query<{ payload: DetailRow }>(
      "SELECT payload FROM scan_component_details WHERE scan_id = $1 AND selector = $2", [scans[0]?.scan_id, selector]);
    return rows[0]?.payload ?? null;
  }

  async occurrences(scans: ScanSelection[], componentId: string): Promise<OccurrenceModelRow[]> {
    this.requireReady(scans, true);
    if (!scans.length) return [];
    const { rows } = await this.client.query<{ payload: OccurrenceModelRow }>(
      "SELECT payload FROM scan_occurrence_views WHERE scan_id = $1 AND component_id = $2 ORDER BY source_ordinal", [scans[0]?.scan_id, componentId]);
    return rows.map(row => row.payload);
  }

  async graph(scans: ScanSelection[]): Promise<GraphRow[]> {
    if (!scans.length) return [];
    const { rows } = await this.client.query<{ payload: GraphRow }>(`
      SELECT payload FROM scan_composition_graphs WHERE scan_id = $1 AND kind IN ('graph-node', 'graph-edge')
      ORDER BY kind, source_ordinal`, [scans[0]?.scan_id]);
    const count = (scans[0]?.expected_counts?.["graph-node"] ?? 0) + (scans[0]?.expected_counts?.["graph-edge"] ?? 0);
    if (rows.length !== count) this.unavailable(scans.map(scan => scan.scan_id));
    return rows.map(row => row.payload);
  }
}
