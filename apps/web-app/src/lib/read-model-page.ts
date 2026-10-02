import { ReadModelUnavailableError, type StorageDriver } from "@scoutui/web-shared";
import { getPool } from "@/db/client";
import { getReadModelProgress, skippedNotices, unavailableScans } from "@/lib/read-model-progress";
import type { ReadModelResult } from "@/lib/read-model-state";

export { readModelTitle } from "@/lib/read-model-state";

export async function readModelPage<T>(
  driver: StorageDriver,
  read: (snapshot: StorageDriver) => Promise<T>,
): Promise<ReadModelResult<T>> {
  try {
    const { value, skipped } = await driver.withReadSnapshot(async snapshot => ({ value: await read(snapshot), skipped: snapshot.skippedScans() }));
    if (!skipped.fallbacks.length && !skipped.gaps.length) return { state: "ready", value, fallbacks: [], gaps: [] };
    const notices = await skippedNotices(getPool(), skipped);
    return notices ? { state: "ready", value, ...notices } : { state: "preparing", scans: [], retryable: true };
  } catch (error) {
    if (!(error instanceof ReadModelUnavailableError)) throw error;
    const progress = await getReadModelProgress(getPool(), error.scanIds);
    return unavailableScans(progress) ?? { state: error.state, scans: [], retryable: error.retryable };
  }
}
