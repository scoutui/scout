import type { Pool, PoolClient } from "pg";
import { parseGitRemote, type ParsedRemote } from "@scoutui/scan-format/git-remote";
import type { Refusal } from "./scan-acceptance.ts";

function sameRemote(a: ParsedRemote, b: ParsedRemote): boolean {
  const host = (remote: ParsedRemote) => remote.host.replace(/:\d+$/, "").toLowerCase();
  return host(a) === host(b) && a.path.toLowerCase() === b.path.toLowerCase();
}

/**
 * Why the dashboard won't take a scan under this repository name, or null when it will. A repository name belongs to the
 * remote the dashboard has for it. Two remotes match when both parse to the same host, ignoring any port, and the same path,
 * ignoring case, and otherwise only when they are the same string. A repository the dashboard doesn't have, or a remote missing
 * on either side, never refuses.
 */
export async function repoIdentityRefusal(db: Pool | PoolClient, scan: { repoId: string; remote: string | null }): Promise<Refusal | null> {
  const { rows: [repo] } = await db.query<{ git_remote: string | null }>("SELECT git_remote FROM repos WHERE repo_id = $1", [scan.repoId]);
  const stored = repo?.git_remote;
  if (!stored || !scan.remote) return null;
  const storedRemote = parseGitRemote(stored);
  const incomingRemote = parseGitRemote(scan.remote);
  const same = storedRemote && incomingRemote ? sameRemote(storedRemote, incomingRemote) : stored === scan.remote;
  if (same) return null;
  const from = storedRemote?.display ?? stored;
  return {
    code: "repo_remote_mismatch",
    message: `Couldn't upload the scan: ${scan.repoId} on the dashboard comes from ${from}. Scan a clone of that repository, or choose another repoId in scout.config.json.`,
  };
}
