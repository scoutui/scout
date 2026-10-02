import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { GovernanceTargetConflictError, ReadModelUnavailableError, type ScanFallback, type SkippedScans, type StorageDriver } from "../storage.js";
import type {
  Tag, TagInput, Dashboard, DashboardInput, DashboardConfig, DashboardScope,
  GovernanceRecord, GovernanceInput, Disposition,
} from "../dto.js";
import {
  CHART_RESULTS_FORMAT_VERSION, chartResultKey, enqueueChartResults, type DashboardPreview, type RegistryResult, type StoredPreview,
} from "../chart-results.js";
import type { GovernanceTracking } from "../governance-tracking.js";
import {
  reduceRepoSummary, reduceRepoDetail, reduceComponentRows, reduceComponentDetailHead,
  reduceOccurrences, reducePackagesAcrossScans, reducePackageDetail,
  reduceComponentsAcrossScans, reduceCrossRepoComponent, reduceCompositionGraph,
} from "../read-model-reducers.js";
import { repoDeltas } from "../scan-diff.js";
import { newestScanFirst, newestScanFirstSql } from "../scan-order.js";
import { ReadModelReader, scanModelReady, type ScanModelHeader } from "./read-model-reader.js";

type DashboardDbRow = {
  id: string; name: string; description: string | null; config: DashboardConfig;
  created_by_user_id: string | null; created_at: string | Date; updated_at: string | Date;
};

function toDashboard(r: DashboardDbRow): Dashboard {
  return {
    id: r.id, name: r.name, description: r.description, config: r.config,
    createdByUserId: r.created_by_user_id,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  };
}

const identityFields = ["identity", "framework", "attribution", "owningPackage"] as const;
const repoFields = ["id", ...identityFields, "stats", "usage"] as const;
const rowFields = [...repoFields, "displayName", "writtenNames", "disambiguator", "version"] as const;
const summaryFields = [...repoFields, "displayName"] as const;
const packageFields = [...summaryFields, "version", "usedIdentityKey"] as const;

export class PostgresDriver implements StorageDriver {
  private readonly db: NodePgDatabase;
  private readonly skipped: SkippedScans = { fallbacks: [], gaps: [] };

  constructor(private readonly pool: Pool, private readonly client?: PoolClient) {
    this.db = drizzle(client ?? pool);
  }

  async withReadSnapshot<T>(fn: (driver: StorageDriver) => Promise<T>): Promise<T> {
    if (this.client) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await fn(new PostgresDriver(this.pool, client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  skippedScans(): SkippedScans {
    return { fallbacks: [...this.skipped.fallbacks], gaps: [...this.skipped.gaps] };
  }

  /** The repos whose newest scans aren't ready, as a read of every repo's latest scan skips them, read outside a snapshot. */
  async latestScanFallbacks(): Promise<ScanFallback[]> {
    const client = this.client ?? await this.pool.connect();
    try {
      const skipped: SkippedScans = { fallbacks: [], gaps: [] };
      await new ReadModelReader(client, skipped).select(undefined, { latestOnly: true }).catch((error: unknown) => {
        if (!(error instanceof ReadModelUnavailableError)) throw error;
      });
      return skipped.fallbacks;
    } finally {
      if (!this.client) client.release();
    }
  }

  private async writeWithResults<T>(fn: (db: NodePgDatabase, client: PoolClient) => Promise<T>): Promise<T> {
    if (this.client) throw new Error("Cannot write through a read snapshot");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(drizzle(client), client);
      await enqueueChartResults(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private read<T>(fn: (reader: ReadModelReader, driver: StorageDriver) => Promise<T>): Promise<T> {
    return this.withReadSnapshot(driver => {
      const snapshot = driver as PostgresDriver;
      if (!snapshot.client) throw new Error("Missing snapshot client");
      return fn(new ReadModelReader(snapshot.client, snapshot.skipped), driver);
    });
  }

  async listRepos() {
    return this.read(async (reader, snapshot) => {
      const scans = await reader.select(undefined, { latestOnly: true });
      const tags = await snapshot.listTags();
      const governance = await snapshot.listGovernance();
      const digests = await reader.digests(await reader.select(undefined, { newestPerRepo: 2 }));
      const deltas = repoDeltas(digests, governance, tags);
      const facts = await reader.facts(scans, repoFields);
      return facts.map((fact, index) => ({ fact, scanCount: scans[index]?.scan_count ?? 0 }))
        .sort((a, b) => newestScanFirst(a.fact.meta, b.fact.meta))
        .map(({ fact, scanCount }) => reduceRepoSummary(fact, {
          scanCount, delta: deltas.get(fact.meta.repo.id) ?? null,
        }, governance));
    });
  }

  async listRepoIds() {
    const result = await this.db.execute(sql`SELECT repo_id FROM repos ORDER BY repo_id`);
    return (result.rows as { repo_id: string }[]).map(row => row.repo_id);
  }

  async getRepo(repoId: string, scanId?: string) {
    return this.read(async (reader, snapshot) => {
      const scans = await reader.selectRepoDetail(repoId, scanId);
      const selected = scans[0];
      if (!selected) return null;
      const facts = await reader.facts([selected], repoFields);
      const fact = facts[0];
      if (!fact) return null;
      const tags = await snapshot.listTags();
      const governance = await snapshot.listGovernance();
      const digests = await reader.digests(scans);
      return reduceRepoDetail(fact, { scanCount: selected.scan_count, digests, tags }, governance);
    });
  }

  async getRepoHead(repoId: string) {
    return this.read(async reader => {
      const view = (await reader.repos(await reader.select(repoId, { latestOnly: true })))[0];
      return view ? { gitRemote: view.meta.repo.gitRemote ?? null, commit: view.meta.repo.commit } : null;
    });
  }

  async listScans(repoId: string) {
    const result = await this.db.execute(sql`
      SELECT scans.scan_id, scans.committed_at, scans.created_at, scans.commit_sha, scans.branch, model.projection_version, model.format_version,
        model.state, model.build_revision, model.expected_counts, model.actual_counts, model.details_retained,
        uploader.name AS uploader_name, uploader.email AS uploader_email
      FROM scans LEFT JOIN scan_read_models model USING (scan_id) LEFT JOIN "user" uploader ON uploader.id = scans.uploaded_by_user_id
      WHERE scans.repo_id = ${repoId}
      ORDER BY ${sql.raw(newestScanFirstSql("scans"))}`);
    return (result.rows as ({
      scan_id: string; committed_at: string | Date; created_at: string | Date; commit_sha: string; branch: string | null;
      uploader_name: string | null; uploader_email: string | null;
    } & ScanModelHeader)[]).map(row => ({
      scanId: row.scan_id, committedAt: new Date(row.committed_at).toISOString(), arrivedAt: new Date(row.created_at).toISOString(),
      commit: row.commit_sha, branch: row.branch,
      uploadedBy: row.uploader_email === null ? null : { name: row.uploader_name, email: row.uploader_email },
      ready: scanModelReady(row),
    }));
  }

  async listScanDigests(repoId?: string, opts?: { latestOnly?: boolean; newestPerRepo?: number; componentIds?: string[] }) {
    return this.read(async reader => reader.digests(await reader.select(repoId, { ...opts, record: !opts?.componentIds }), opts?.componentIds));
  }

  async listComponentsForRepo(repoId: string, q: string, scanId?: string) {
    return this.read(async (reader, snapshot) => {
      const scans = await reader.select(repoId, scanId ? { scanId } : { latestOnly: true });
      const fact = (await reader.facts(scans, rowFields))[0];
      if (!fact) return [];
      return reduceComponentRows(fact, q, await snapshot.listGovernance(), await snapshot.listTags());
    });
  }

  async getComponentDetailHead(repoId: string, componentId: string) {
    return this.read(async (reader, snapshot) => {
      const row = await reader.detail(await reader.select(repoId, { latestOnly: true }), componentId);
      return row ? reduceComponentDetailHead(row, await snapshot.listGovernance()) : null;
    });
  }

  async getComponentUsage(repoId: string, componentId: string) {
    return this.read(async reader => {
      return reduceOccurrences(await reader.occurrences(await reader.select(repoId, { latestOnly: true }), componentId), componentId);
    });
  }

  async getCompositionGraph(repoId: string) {
    return this.read(async (reader, snapshot) => {
      const scans = await reader.select(repoId, { latestOnly: true });
      if (!scans.length) return null;
      return reduceCompositionGraph(await reader.graph(scans), await snapshot.listGovernance());
    });
  }

  async listPackages(repoId?: string) {
    return this.read(async (reader, snapshot) => {
      const scans = await reader.select(repoId, { latestOnly: true });
      const facts = await reader.facts(scans, ["packages", "usedIdentityKey", "stats", ...identityFields]);
      return reducePackagesAcrossScans(facts, await snapshot.listGovernance());
    });
  }

  async getPackage(packageName: string) {
    return this.read(async (reader, snapshot) => {
      const scans = await reader.select(undefined, { latestOnly: true });
      const facts = await reader.facts(scans, packageFields, { packageName });
      return reducePackageDetail(facts, packageName, await snapshot.listGovernance());
    });
  }

  async listComponents() {
    return this.read(async (reader, snapshot) => {
      const facts = await reader.facts(await reader.select(undefined, { latestOnly: true }), summaryFields);
      return reduceComponentsAcrossScans(facts, await snapshot.listGovernance());
    });
  }

  async getCrossRepoComponent(componentId: string) {
    return this.read(async (reader, snapshot) => {
      const facts = await reader.facts(await reader.select(undefined, { latestOnly: true }), ["id", ...identityFields, "stats", "displayName", "version"], { componentId });
      return reduceCrossRepoComponent(facts, componentId, await snapshot.listGovernance());
    });
  }

  // ---- Tags ----

  async listTags(): Promise<Tag[]> {
    const result = await this.db.execute(sql<{
      id: string; value: string; category: string | null; color: string;
      rule: { glob: string[]; exact: string[] };
    }>`SELECT id, value, category, color, rule FROM tags ORDER BY value`);
    return (result.rows as {
      id: string; value: string; category: string | null; color: string;
      rule: { glob: string[]; exact: string[] };
    }[]).map((r) => ({ id: r.id, value: r.value, category: r.category, color: r.color, rule: r.rule }));
  }

  async upsertTag(input: TagInput): Promise<Tag> {
    const id = input.id ?? randomUUID();
    const ruleJson = JSON.stringify(input.rule);
    await this.writeWithResults(db => db.execute(sql`
      INSERT INTO tags (id, value, category, color, rule, updated_at)
      VALUES (${id}, ${input.value}, ${input.category}, ${input.color}, ${ruleJson}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET
        value = EXCLUDED.value, category = EXCLUDED.category,
        color = EXCLUDED.color, rule = EXCLUDED.rule, updated_at = now()
    `));
    return { id, value: input.value, category: input.category, color: input.color, rule: input.rule };
  }

  async deleteTag(id: string): Promise<void> {
    await this.writeWithResults(db => db.execute(sql`DELETE FROM tags WHERE id = ${id}`));
  }

  // ---- Governance ----

  async listGovernance(): Promise<GovernanceRecord[]> {
    const result = await this.db.execute(sql<{
      id: string; grain: "package" | "component"; target_package: string;
      target_export: string | null; disposition: Disposition;
      created_at: string | Date; updated_at: string | Date;
    }>`SELECT id, grain, target_package, target_export, disposition, created_at, updated_at FROM governance`);
    return (result.rows as {
      id: string; grain: "package" | "component"; target_package: string;
      target_export: string | null; disposition: Disposition;
      created_at: string | Date; updated_at: string | Date;
    }[]).map((r) => ({
      id: r.id, grain: r.grain, targetPackage: r.target_package, targetExport: r.target_export,
      disposition: r.disposition,
      createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  async createGovernance(input: GovernanceInput): Promise<GovernanceRecord> {
    const id = randomUUID();
    const dispJson = JSON.stringify(input.disposition);
    return this.writeWithResults(async (db, client) => {
      const result = await db.execute(sql`
        INSERT INTO governance (id, grain, target_package, target_export, disposition, updated_at)
        VALUES (${id}, ${input.grain}, ${input.targetPackage}, ${input.targetExport}, ${dispJson}::jsonb, now())
        ON CONFLICT (target_package, target_export) DO NOTHING
        RETURNING id
      `);
      if (result.rows.length === 0) {
        throw new GovernanceTargetConflictError(input.targetPackage, input.targetExport);
      }
      return this.governanceById(client, id);
    });
  }

  async updateGovernance(id: string, input: GovernanceInput): Promise<GovernanceRecord> {
    const dispJson = JSON.stringify(input.disposition);
    return this.writeWithResults(async (db, client) => {
      const result = await db
        .execute(sql`
          UPDATE governance SET
            grain = ${input.grain},
            target_package = ${input.targetPackage},
            target_export = ${input.targetExport},
            disposition = ${dispJson}::jsonb,
            updated_at = now()
          WHERE id = ${id}
          RETURNING id
        `)
        .catch((err: { cause?: { code?: string } }) => {
          // 23505 = unique_violation: the new target belongs to another record.
          // drizzle wraps the pg error in a DrizzleQueryError, and the pg error
          // code lives on `.cause.code`, not `.code` on the wrapper itself.
          if (err.cause?.code === "23505") {
            throw new GovernanceTargetConflictError(input.targetPackage, input.targetExport);
          }
          throw err;
        });
      if (result.rows.length === 0) throw new Error(`updateGovernance: no record with id ${id}`);
      return this.governanceById(client, id);
    });
  }

  private async governanceById(client: PoolClient, id: string): Promise<GovernanceRecord> {
    const stored = (await new PostgresDriver(this.pool, client).listGovernance()).find((r) => r.id === id);
    if (!stored) throw new Error(`governance row ${id} missing after write`);
    return stored;
  }

  async deleteGovernance(id: string): Promise<void> {
    await this.writeWithResults(db => db.execute(sql`DELETE FROM governance WHERE id = ${id}`));
  }

  // ---- Dashboards ----

  async listDashboards(): Promise<Dashboard[]> {
    const result = await this.db.execute(sql<DashboardDbRow>`
      SELECT id, name, description, config, created_by_user_id, created_at, updated_at FROM dashboards ORDER BY name`);
    return (result.rows as DashboardDbRow[]).map(toDashboard);
  }

  async getDashboard(id: string): Promise<Dashboard | null> {
    const result = await this.db.execute(sql<DashboardDbRow>`
      SELECT id, name, description, config, created_by_user_id, created_at, updated_at FROM dashboards WHERE id = ${id}`);
    const row = (result.rows as DashboardDbRow[])[0];
    return row ? toDashboard(row) : null;
  }

  async upsertDashboard(input: DashboardInput): Promise<Dashboard> {
    const id = input.id ?? randomUUID();
    const configJson = JSON.stringify(input.config);
    return this.writeWithResults(async (db, client) => {
      await db.execute(sql`
        INSERT INTO dashboards (id, name, description, config, created_by_user_id, updated_at)
        VALUES (${id}, ${input.name}, ${input.description}, ${configJson}::jsonb, ${input.createdByUserId ?? null}, now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, description = EXCLUDED.description, config = EXCLUDED.config, updated_at = now()
      `);
      const stored = await new PostgresDriver(this.pool, client).getDashboard(id);
      if (!stored) throw new Error(`upsertDashboard: row ${id} missing after write`);
      return stored;
    });
  }

  async deleteDashboard(id: string): Promise<void> {
    await this.writeWithResults(db => db.execute(sql`DELETE FROM dashboards WHERE id = ${id}`));
  }

  // ---- Stored chart results ----

  private async storedResult<T>(key: string): Promise<T | null> {
    const result = await this.db.execute(sql`
      SELECT payload FROM chart_results WHERE key = ${key} AND format_version = ${CHART_RESULTS_FORMAT_VERSION}`);
    const row = (result.rows as { payload: T }[])[0];
    return row ? row.payload : null;
  }

  async getStoredTracking(scope: DashboardScope): Promise<GovernanceTracking[] | null> {
    return this.storedResult(scope.kind === "all" ? chartResultKey.tracking : chartResultKey.repoTracking(scope.repoId));
  }

  async getStoredRegistry(): Promise<RegistryResult | null> {
    return this.storedResult(chartResultKey.registry);
  }

  async getStoredPreviews(): Promise<Record<string, StoredPreview>> {
    const prefix = chartResultKey.preview("");
    const result = await this.db.execute(sql`
      SELECT key, payload, snapshot_at FROM chart_results
      WHERE starts_with(key, ${prefix}) AND format_version = ${CHART_RESULTS_FORMAT_VERSION}`);
    return Object.fromEntries((result.rows as { key: string; payload: DashboardPreview; snapshot_at: string | Date }[])
      .map(row => [row.key.slice(prefix.length), { ...row.payload, snapshotAt: new Date(row.snapshot_at).toISOString() }]));
  }

  async latestScanArrivedAt(): Promise<string | null> {
    const result = await this.db.execute(sql`SELECT max(created_at) AS arrived_at FROM scans`);
    const latest = (result.rows as { arrived_at: string | Date | null }[])[0]?.arrived_at;
    return latest ? new Date(latest).toISOString() : null;
  }
}
