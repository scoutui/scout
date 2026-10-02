import type { ParsedRemote } from "@scoutui/scan-format/git-remote";

/** Repo source-location context for deep-linking occurrences to their call site. */
export type SourceRef = { remote: ParsedRemote | null; commit: string };

/**
 * Build a browseable URL to a specific file + line at a specific commit, from a
 * parsed git remote. Provider-aware: GitHub (and GitHub Enterprise) use
 * `/blob/<ref>/<path>#L<n>`, GitLab uses `/-/blob/`, Bitbucket uses `/src/` with
 * a `#lines-<n>` anchor. Unknown hosts fall back to the GitHub shape, which is
 * by far the most common and what self-hosted GHE serves.
 *
 * Returns null when there's no remote or no commit to pin to, and the caller
 * renders the path as plain text.
 *
 * `filePath` is repo-relative, as every provider's blob URL expects.
 */
export function sourceFileUrl(
  remote: ParsedRemote | null,
  commit: string | null | undefined,
  filePath: string,
  line?: number,
): string | null {
  if (!remote || !commit) return null;

  const encodedPath = filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const host = remote.host.toLowerCase();

  if (host.includes("gitlab")) {
    const anchor = line ? `#L${line}` : "";
    return `${remote.href}/-/blob/${commit}/${encodedPath}${anchor}`;
  }
  if (host.includes("bitbucket")) {
    const anchor = line ? `#lines-${line}` : "";
    return `${remote.href}/src/${commit}/${encodedPath}${anchor}`;
  }
  // GitHub / GitHub Enterprise / unknown.
  const anchor = line ? `#L${line}` : "";
  return `${remote.href}/blob/${commit}/${encodedPath}${anchor}`;
}
