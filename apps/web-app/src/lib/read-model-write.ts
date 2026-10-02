import type { PoolClient } from "pg";
import { presentIdentity, type ReadModelRow } from "@scoutui/web-shared";

const BATCH_BYTES = 1024 * 1024;
const BATCH_PARAMETERS = 8192;

const destinations = {
  repo: { table: "scan_repo_views", columns: ["scan_id", "repo_id", "source_ordinal", "payload"] },
  component: { table: "scan_component_facts", columns: ["scan_id", "component_id", "package_name", "file_path", "source_ordinal", "payload"] },
  package: { table: "scan_package_contributions", columns: ["scan_id", "package_name", "component_id", "source_ordinal", "payload"] },
  detail: { table: "scan_component_details", columns: ["scan_id", "selector", "source_ordinal", "payload"] },
  occurrence: { table: "scan_occurrence_views", columns: ["scan_id", "component_id", "file_path", "source_ordinal", "payload"] },
  "graph-node": { table: "scan_composition_graphs", columns: ["scan_id", "kind", "source_id", "target_id", "source_ordinal", "payload"] },
  "graph-edge": { table: "scan_composition_graphs", columns: ["scan_id", "kind", "source_id", "target_id", "source_ordinal", "payload"] },
} satisfies Record<ReadModelRow["kind"], { table: string; columns: string[] }>;

type Value = string | number | null;

function valuesOf(row: ReadModelRow): Value[] {
  const payload = JSON.stringify(row);
  switch (row.kind) {
    case "repo": return [row.scanId, row.meta.repo.id, row.ordinal, payload];
    case "component": {
      const { packageName, filePath } = presentIdentity(row.fact);
      return [row.scanId, row.componentId, packageName, filePath, row.ordinal, payload];
    }
    case "package": return [row.scanId, row.packageName, row.componentId, row.ordinal, payload];
    case "detail": return [row.scanId, row.selector, row.ordinal, payload];
    case "occurrence": return [row.scanId, row.componentId, row.occurrence.filePath, row.ordinal, payload];
    case "graph-node": return [row.scanId, row.kind, row.node.id, null, row.ordinal, payload];
    case "graph-edge": return [row.scanId, row.kind, row.edge.source, row.edge.target, row.ordinal, payload];
  }
}

/** Inserts into the caller's transaction; publication and rollback belong to the caller. */
export async function writeReadModelRows(client: PoolClient, scanId: string, rows: Iterable<ReadModelRow>): Promise<Record<string, number>> {
  const counts = { repo: 0, component: 0, package: 0, detail: 0, occurrence: 0, "graph-node": 0, "graph-edge": 0 };
  const expected = { ...counts };
  const batches = new Map<ReadModelRow["kind"], { values: Value[]; count: number }>();
  let bytes = 0;
  let parameters = 0;

  async function flush() {
    for (const [kind, batch] of batches) {
      const { table, columns } = destinations[kind];
      const placeholders = Array.from({ length: batch.count }, (_, row) =>
        `(${columns.map((_, col) => `$${row * columns.length + col + 1}`).join(",")})`,
      );
      const result = await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders.join(",")}`, batch.values);
      if (result.rowCount !== batch.count) throw new Error(`Read model insert count mismatch for ${kind}: expected ${batch.count}, inserted ${result.rowCount}`);
      counts[kind] += result.rowCount;
    }
    batches.clear();
    bytes = 0;
    parameters = 0;
  }

  for (const row of rows) {
    if (row.scanId !== scanId) throw new Error("Read model row belongs to another scan");
    const encoded = valuesOf(row);
    const rowBytes = encoded.reduce<number>((sum, value) => sum + 4 + (value === null ? 0 : Buffer.byteLength(String(value), "utf8")), 0);
    if (bytes + rowBytes > BATCH_BYTES || parameters + encoded.length > BATCH_PARAMETERS) await flush();
    const batch = batches.get(row.kind) ?? { values: [], count: 0 };
    batch.values.push(...encoded);
    batch.count++;
    batches.set(row.kind, batch);
    bytes += rowBytes;
    parameters += encoded.length;
    expected[row.kind]++;
    if (bytes >= BATCH_BYTES) await flush();
  }
  await flush();
  for (const key of Object.keys(expected) as ReadModelRow["kind"][]) {
    if (counts[key] !== expected[key]) throw new Error(`Read model yielded count mismatch for ${key}`);
  }
  return counts;
}

/** Removes derived children only; the caller owns header and raw scan lifecycle. */
export async function deleteReadModelRows(client: PoolClient, scanId: string): Promise<void> {
  for (const table of new Set(Object.values(destinations).map(destination => destination.table))) {
    await client.query(`DELETE FROM ${table} WHERE scan_id = $1`, [scanId]);
  }
}
