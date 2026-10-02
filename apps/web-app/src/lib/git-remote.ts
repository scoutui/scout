import { parseGitRemote } from "@scoutui/scan-format/git-remote";

// Hosts whose web UI shows a commit at `<repo href>/commit/<sha>`: github.com,
// gitlab.com, and self-hosted instances on a `github.` / `gitlab.` host. Other
// forges (bitbucket's `/commits/`, gitea, plain git servers) are unknown and get
// no link, because a wrong URL is worse than mono text.
const COMMIT_PATH_HOST_RE = /(^|\.)(github|gitlab)\./;

/** Browseable URL for one commit on a known forge, or null when the remote is
 *  absent, unparseable, or on a host whose commit URL shape is unknown. */
export function commitUrl(remote: string | null | undefined, sha: string): string | null {
  const parsed = parseGitRemote(remote);
  if (!parsed || !COMMIT_PATH_HOST_RE.test(parsed.host)) return null;
  return `${parsed.href}/commit/${sha}`;
}
