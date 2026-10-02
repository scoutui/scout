/**
 * Parse a git remote URL into a normalized shape suitable for display + linking.
 *
 * Auth style (`git@host:path` or `ssh://host/path` SSH vs `https://host/path`
 * HTTPS) is only the scanning machine's config: it doesn't say whether the repo
 * is public, private or browseable. All forms are normalized identically. On
 * Bitbucket Data Center and Azure DevOps, where a repository's SSH and HTTPS
 * paths differ, every form gives the HTTPS form's host and repository path.
 *
 * Returns null when the input cannot be parsed.
 */
export type ParsedRemote = {
  /** Hostname only, e.g. `github.com` or `github.example.com`. */
  host: string;
  /** Path under the host, e.g. `example-org/example.app`. No leading slash, no `.git` suffix. */
  path: string;
  /** Display string: `host/path`. */
  display: string;
  /** Browseable URL: `https://host/path`, or the repository page for a Bitbucket Data Center HTTPS remote. */
  href: string;
};

const SSH_RE = /^[^@/\s]+@([^:/\s]+):\/?(.+?)(?:\.git)?\/?$/;
const HTTPS_RE = /^https?:\/\/([^/\s]+)\/(.+?)(?:\.git)?\/?$/;
// `ssh://[user@]host[:port]/path`. The port is SSH's, not the web host's, so it is left out of `host`.
const SSH_URL_RE = /^ssh:\/\/(?:[^@/\s]+@)?([^@:/\s]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/;
// Bitbucket Data Center over HTTPS: `[context/]scm/<project key or ~user>/<repo>`.
const BITBUCKET_SCM_PATH_RE = /^(?:(.+)\/)?scm\/([^/]+)\/([^/]+)$/;
// Azure DevOps over SSH: `v3/<org>/<project>/<repo>`.
const AZURE_SSH_HOSTS = new Set(["ssh.dev.azure.com", "vs-ssh.visualstudio.com"]);
const AZURE_SSH_PATH_RE = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/;
// Azure DevOps over HTTPS on its older host: `<org>.visualstudio.com/<project>/_git/<repo>`.
const VISUALSTUDIO_HOST_RE = /^([^.]+)\.visualstudio\.com$/i;
const AZURE_GIT_PATH_RE = /^[^/]+\/_git\/[^/]+$/;

export function parseGitRemote(input: string | null | undefined): ParsedRemote | null {
  if (!input) return null;
  const raw = input.trim();
  // Whitespace anywhere disqualifies: git remotes never contain spaces.
  if (!raw || /\s/.test(raw)) return null;

  let host: string | undefined;
  let path: string | undefined;
  let overHttp = false;

  const ssh = SSH_RE.exec(raw);
  if (ssh) {
    host = ssh[1];
    path = ssh[2];
    // Reject scp-shorthand with embedded port (`git@host:22:path`). Real git
    // remote paths never contain a colon, and `port:path` can't be told apart
    // from `segment:segment`, so fail closed.
    if (path?.includes(":")) return null;
  } else {
    const https = HTTPS_RE.exec(raw);
    const url = https ?? SSH_URL_RE.exec(raw);
    if (url) {
      host = url[1];
      path = url[2];
      overHttp = https !== null;
    }
  }

  if (!host || !path) return null;

  // Strip userinfo (`user:pass@` or `user@`) from the host so credentials
  // never leak into the rendered text or the outbound href. This applies to
  // HTTPS URLs of the form `https://x-access-token:GHP_xxx@host/path` that
  // can appear in CI git configs.
  host = host.replace(/^[^@]*@/, "");
  if (!host) return null;

  path = path.replace(/\.git$/, "").replace(/\/+$/, "");
  if (!path) return null;

  let href: string | undefined;
  if (overHttp) {
    const bitbucket = BITBUCKET_SCM_PATH_RE.exec(path);
    if (bitbucket) {
      const [, context, owner, repo] = bitbucket;
      path = `${owner}/${repo}`;
      const page = owner?.startsWith("~") ? `users/${owner.slice(1)}` : `projects/${owner}`;
      href = `https://${host}/${context ? `${context}/` : ""}${page}/repos/${repo}`;
    }
    const org = VISUALSTUDIO_HOST_RE.exec(host)?.[1];
    if (org && AZURE_GIT_PATH_RE.test(path)) {
      host = "dev.azure.com";
      path = `${org}/${path}`;
    }
  } else {
    const azure = AZURE_SSH_HOSTS.has(host.toLowerCase()) ? AZURE_SSH_PATH_RE.exec(path) : null;
    if (azure) {
      host = "dev.azure.com";
      path = `${azure[1]}/${azure[2]}/_git/${azure[3]}`;
    }
  }

  return {
    host,
    path,
    display: `${host}/${path}`,
    href: href ?? `https://${host}/${path}`,
  };
}
