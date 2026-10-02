import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { ScanArtifact } from "@scoutui/scan-format";
import { createProjectionContext, deriveReadModelRows, type ReadModelRow, type GraphRow } from "@scoutui/web-shared";
import { deleteReadModelRows, writeReadModelRows } from "@/lib/read-model-write";
import { withReadModelDatabase } from "../helpers/read-model-db";
import { artifact as v2Artifact, component, packageExport, resolvedAt } from "../../../../packages/web-shared/tests/helpers/builders.js";

const tables = ["scan_repo_views", "scan_component_facts", "scan_package_contributions", "scan_component_details", "scan_occurrence_views", "scan_composition_graphs"];
const emptyCounts = { repo: 0, component: 0, package: 0, detail: 0, occurrence: 0, "graph-node": 0, "graph-edge": 0 };

const button = component(packageExport("@sample/core", "Button"), { usage: "direct" });

function artifact(scanId = "scan-a"): ScanArtifact {
  return v2Artifact({
    scanId, repoId: "repo-a", scannedAt: "2026-09-19T00:00:00Z",
    components: [button],
    occurrences: [resolvedAt(button, "src/é.tsx", 1, {
      occurrenceId: "call", column: 2,
      trace: [{ kind: "import", specifier: "@sample/core", name: "Button" }],
    })],
  });
}

async function seed(pool: Pool, scanId = "scan-a") {
  await pool.query("INSERT INTO repos (repo_id) VALUES ('repo-a') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO scans (scan_id, repo_id, committed_at, commit_sha, scanner_version, artifact) VALUES ($1, 'repo-a', now(), $1, '0', $2)", [scanId, JSON.stringify(artifact(scanId))]);
}

function projected(scanId = "scan-a"): ReadModelRow[] {
  const input = artifact(scanId);
  return [...deriveReadModelRows(input, createProjectionContext(input)), { kind: "graph-edge", scanId, ordinal: 0, edge: { source: button.id, target: "other", count: 1 } }];
}

const { DATABASE_URL: databaseUrl } = process.env;
describe.skipIf(!databaseUrl)("scan read model storage", () => {
  it("rolls back every derived row with the caller transaction", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const counts = await writeReadModelRows(client, "scan-a", projected());
        expect(counts).toEqual({ repo: 1, component: 1, package: 1, detail: 1, occurrence: 1, "graph-node": 1, "graph-edge": 1 });
        await client.query("ROLLBACK");
        for (const table of tables) expect((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
      } finally { client.release(); }
    });
  });

  it("round-trips row payloads and indexed keys and deletes only the selected scan children", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      await seed(pool, "scan-b");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const rows = projected();
        await writeReadModelRows(client, "scan-a", rows);
        await writeReadModelRows(client, "scan-b", projected("scan-b"));
        const persisted = [];
        for (const table of tables) persisted.push(...(await client.query(`SELECT payload FROM ${table} WHERE scan_id = 'scan-a'`)).rows.map(r => r.payload));
        expect(persisted).toEqual(expect.arrayContaining(rows));
        expect(persisted).toHaveLength(rows.length);
        expect((await client.query("SELECT component_id, file_path, source_ordinal FROM scan_occurrence_views WHERE scan_id = 'scan-a'")).rows).toEqual([{ component_id: button.id, file_path: "src/é.tsx", source_ordinal: 0 }]);
        await client.query("INSERT INTO scan_read_models (scan_id, projection_version, format_version, state, build_revision, expected_counts, actual_counts, details_retained) VALUES ('scan-a', 1, 1, 'ready', 1, $1, $1, true)", [JSON.stringify(emptyCounts)]);
        await deleteReadModelRows(client, "scan-a");
        for (const table of tables) {
          expect((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE scan_id = 'scan-a'`)).rows[0].n).toBe(0);
          expect((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE scan_id = 'scan-b'`)).rows[0].n).toBeGreaterThan(0);
        }
        expect((await client.query("SELECT count(*)::int AS n FROM scan_read_models")).rows[0].n).toBe(1);
        expect((await client.query("SELECT count(*)::int AS n FROM scans")).rows[0].n).toBe(2);
        await client.query("COMMIT");
      } finally { client.release(); }
    });
  });

  it("records a complete empty scan independently of its child rows", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        expect(await writeReadModelRows(client, "scan-a", [])).toEqual(emptyCounts);
        await client.query("INSERT INTO scan_read_models (scan_id, projection_version, format_version, state, build_revision, expected_counts, actual_counts, details_retained) VALUES ('scan-a', 1, 1, 'ready', 2, $1, $1, false)", [JSON.stringify(emptyCounts)]);
        await client.query("COMMIT");
        expect((await pool.query("SELECT projection_version, format_version, state, build_revision, built_at IS NOT NULL AS built, expected_counts, actual_counts, details_retained FROM scan_read_models")).rows).toEqual([{ projection_version: 1, format_version: 1, state: "ready", build_revision: 2, built: true, expected_counts: emptyCounts, actual_counts: emptyCounts, details_retained: false }]);
      } finally { client.release(); }
    });
  });

  it("batches UTF-8 bytes sequentially and sends an oversized row alone without truncation", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const client = await pool.connect();
      const base = projected().find(row => row.kind === "component");
      if (!base || base.kind !== "component") throw new Error("Missing component fixture");
      const descriptions = ["😀".repeat(145_000), "界".repeat(190_000), "é".repeat(650_000), "small", "a".repeat(450_000), "b".repeat(450_000)];
      const rows = descriptions.map((displayName, ordinal) => ({ ...base, ordinal, componentId: `c${ordinal}`, fact: { ...base.fact, displayName } }));
      let inFlight = 0;
      const batches: unknown[][] = [];
      const observed = { query: async (sql: string, values: unknown[]) => {
        expect(inFlight++).toBe(0);
        batches.push(values);
        try { return await client.query(sql, values); } finally { inFlight--; }
      } } as PoolClient;
      try {
        await client.query("BEGIN");
        expect(await writeReadModelRows(observed, "scan-a", rows)).toEqual({ ...emptyCounts, component: 6 });
        expect(batches).toHaveLength(4);
        expect(batches.map(values => values.length)).toEqual([6, 6, 6, 18]);
        const stored = await client.query("SELECT payload FROM scan_component_facts ORDER BY source_ordinal");
        expect(stored.rows.map(r => r.payload.fact.displayName)).toEqual(descriptions);
        await client.query("ROLLBACK");
      } finally { client.release(); }
    });
  });

  it("flushes bind-limited batches before the protocol ceiling and counts all yielded rows", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const client = await pool.connect();
      let yielded = 0;
      function* rows(): Iterable<GraphRow> {
        for (let ordinal = 0; ordinal < 12_000; ordinal++) {
          yielded++;
          yield { kind: "graph-edge", scanId: "scan-a", ordinal, edge: { source: "a", target: String(ordinal), count: 1 } };
        }
      }
      let batches = 0;
      const observed = { query: async (sql: string, values: unknown[]) => {
        expect(values.length).toBeLessThan(65_535);
        expect(values.length).toBeLessThanOrEqual(8192);
        if (batches++ === 0) {
          expect(values.length).toBe(8190);
          expect(yielded).toBeLessThan(12_000);
          expect(values.reduce<number>((sum, value) => sum + Buffer.byteLength(String(value ?? "")) + 4, 0)).toBeLessThan(1024 * 1024);
        }
        return client.query(sql, values);
      } } as PoolClient;
      try {
        await client.query("BEGIN");
        expect(await writeReadModelRows(observed, "scan-a", rows())).toEqual({ ...emptyCounts, "graph-edge": 12_000 });
        expect(batches).toBeGreaterThan(1);
        expect((await client.query("SELECT count(*)::int AS n FROM scan_composition_graphs")).rows[0].n).toBe(yielded);
        await client.query("ROLLBACK");
      } finally { client.release(); }
    });
  });

  it("rejects a scan mismatch and a database insert count mismatch", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await expect(writeReadModelRows(client, "scan-a", projected("scan-b"))).rejects.toThrow(/scan/i);
        await client.query("CREATE FUNCTION skip_fact() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'");
        await client.query("CREATE TRIGGER skip_fact BEFORE INSERT ON scan_component_facts FOR EACH ROW EXECUTE FUNCTION skip_fact()");
        await expect(writeReadModelRows(client, "scan-a", projected())).rejects.toThrow(/count/i);
        await client.query("ROLLBACK");
        expect((await client.query("SELECT count(*)::int AS n FROM scan_repo_views")).rows[0].n).toBe(0);
      } finally { client.release(); }
    });
  });

  it("coalesces interleaved component and package rows within one shared buffer budget", async () => {
    await withReadModelDatabase(async pool => {
      await seed(pool);
      const client = await pool.connect();
      const component = projected().find(row => row.kind === "component");
      const contribution = projected().find(row => row.kind === "package");
      if (!component || !contribution) throw new Error("Missing fixture rows");
      const rows = function* (): Iterable<ReadModelRow> {
        for (let ordinal = 0; ordinal < 100; ordinal++) {
          yield { ...component, componentId: `c${ordinal}`, ordinal };
          yield { ...contribution, componentId: `c${ordinal}`, ordinal };
        }
      };
      let queries = 0;
      const observed = { query: async (sql: string, values: unknown[]) => {
        queries++;
        return client.query(sql, values);
      } } as PoolClient;
      try {
        await client.query("BEGIN");
        expect(await writeReadModelRows(observed, "scan-a", rows())).toEqual({ ...emptyCounts, component: 100, package: 100 });
        expect(queries).toBeLessThan(10);
        expect((await client.query("SELECT count(*)::int AS n FROM scan_component_facts")).rows[0].n).toBe(100);
        await client.query("ROLLBACK");
      } finally { client.release(); }
    });
  });
});
