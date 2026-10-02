import type { Pool } from "pg";

export declare function rebuild(
  pool: Pool,
  options: {
    repair?: boolean;
    scanIds?: string[];
    retryFailed?: boolean;
    wait?: boolean;
    timeoutMs?: number;
    pollMs?: number;
    log?: (line: string) => void;
  },
): Promise<{ queued: number; processing: number; ready: number; failed: number; timedOut: boolean }>;
