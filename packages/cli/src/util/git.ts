import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Logger } from "./log.js";

const exec = promisify(execFile);

const NETWORK_TIMEOUT_MS = 10_000;
const SSH_LOOKUP_TIMEOUT_MS = 3_000;
/** Room for `git status` to list every changed and untracked file in a large checkout. */
/** A commit's first seven characters, as git shows it. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

export const STATUS_MAX_BUFFER = 256 * 1024 * 1024;

/** What git says about the checkout at a folder, each case told apart. */
export type RepositoryProbe =
  | { kind: "outside" }
  | { kind: "no-commits" }
  | { kind: "failed"; detail: string }
  | { kind: "ok"; commit: string; shallow: boolean; initialCommit: string | null };

export type GitRun = { ok: true; stdout: string } | { ok: false; exitCode: unknown; stderr: string; detail: string };

/**
 * Runs git with its messages in English, so a failure can be told apart by its text.
 * `network` turns git's credential prompts off and gives up after `NETWORK_TIMEOUT_MS`.
 * `raw` keeps stdout as git printed it, untrimmed. `maxBuffer` raises the limit on how much stdout git may print.
 */
export async function runGit(
  root: string,
  args: string[],
  opts: { network?: boolean; raw?: boolean; maxBuffer?: number } = {},
): Promise<GitRun> {
  try {
    const env = { ...process.env, LC_ALL: "C", ...(opts.network ? { GIT_TERMINAL_PROMPT: "0" } : {}) };
    const { stdout } = await exec("git", args, {
      cwd: root,
      env,
      ...(opts.network ? { timeout: NETWORK_TIMEOUT_MS } : {}),
      ...(opts.maxBuffer !== undefined ? { maxBuffer: opts.maxBuffer } : {}),
    });
    return { ok: true, stdout: opts.raw ? stdout : stdout.trim() };
  } catch (err) {
    const e = err as { code?: unknown; stderr?: unknown; message?: unknown };
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    const detail = `git ${args.join(" ")}: ${stderr || String(e.message ?? err)}`;
    return { ok: false, exitCode: e.code, stderr, detail };
  }
}

/**
 * Whether `root` is inside a git work tree with a HEAD commit, and whether the
 * clone is shallow. A shallow clone has no first commit to read: git reports
 * the shallow boundary instead, so `initialCommit` is null there.
 */
export async function probeRepository(root: string): Promise<RepositoryProbe> {
  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) return inside.stderr.includes("not a git repository") ? { kind: "outside" } : { kind: "failed", detail: inside.detail };
  if (inside.stdout !== "true") return { kind: "outside" };
  const head = await runGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (!head.ok) return head.exitCode === 1 && head.stderr === "" ? { kind: "no-commits" } : { kind: "failed", detail: head.detail };
  const shallow = await runGit(root, ["rev-parse", "--is-shallow-repository"]);
  if (!shallow.ok) return { kind: "failed", detail: shallow.detail };
  if (shallow.stdout === "true") return { kind: "ok", commit: head.stdout, shallow: true, initialCommit: null };
  const roots = await runGit(root, ["rev-list", "--max-parents=0", "HEAD"]);
  if (!roots.ok) return { kind: "failed", detail: roots.detail };
  return { kind: "ok", commit: head.stdout, shallow: false, initialCommit: roots.stdout.split("\n")[0] ?? null };
}

export async function readGitCommitDate(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", ["log", "-1", "--no-show-signature", "--format=%cI", "HEAD"], { cwd: root });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** The remote a scan follows, or why there isn't one. */
export type RemoteChoice =
  | { kind: "none" }
  | { kind: "several"; names: string[] }
  | { kind: "ok"; name: string; url: string };

/**
 * Picks the remote a scan follows: the one `git config scout.remote` names when
 * it exists, else `upstream` (a fork clone), else the only remote, else
 * `origin`. `url` is the remote as `git remote get-url` gives it, so `insteadOf`
 * rewrites apply, without any `user:password@`, and with an SSH host alias
 * replaced by the host name `ssh -G` resolves it to.
 */
export async function selectRemote(root: string, log?: Logger): Promise<RemoteChoice> {
  const listed = await runGit(root, ["remote"]);
  const names = listed.ok ? listed.stdout.split("\n").filter((n) => n !== "") : [];
  const saved = await runGit(root, ["config", "--get", "scout.remote"]);
  const chosen = saved.ok && names.includes(saved.stdout) ? saved.stdout : undefined;
  const name =
    chosen ?? (names.includes("upstream") ? "upstream" : names.length === 1 ? names[0] : names.includes("origin") ? "origin" : undefined);
  if (name === undefined) return names.length === 0 ? { kind: "none" } : { kind: "several", names };
  const url = await runGit(root, ["remote", "get-url", name]);
  if (!url.ok || url.stdout === "") return { kind: "none" };
  return { kind: "ok", name, url: await withSshHostName(withoutCredentials(url.stdout), log) };
}

/** Why a checkout with several remotes, none of them chosen, can't tell which one the dashboard follows, and how to choose. */
export function severalRemotesLine(names: readonly string[]): string {
  return `this checkout has several remotes and none is called origin, so Scout can't tell which one the dashboard follows. Choose one with git config scout.remote <name>, for example git config scout.remote ${names[0]}.`;
}

/** An SSH remote split around its host (`[user@]host:path` or `ssh://[user@]host[:port]/path`), or null for any other remote. */
function splitSshHost(url: string): { before: string; host: string; after: string } | null {
  const ssh = /^(ssh:\/\/(?:[^@/]*@)?)([^/:@[\]]+)(.*)$/i.exec(url);
  if (ssh) return { before: ssh[1] ?? "", host: ssh[2] ?? "", after: ssh[3] ?? "" };
  if (url.includes("://") || /^[a-z]:[\\/]/i.test(url)) return null;
  const scp = /^((?:[^@/:]+@)?)([^/:@]+)(:.*)$/.exec(url);
  return scp ? { before: scp[1] ?? "", host: scp[2] ?? "", after: scp[3] ?? "" } : null;
}

/**
 * An SSH remote with its host alias replaced by the host name `ssh -G` gives for it, the host `git fetch` connects to. The
 * user, port and path stay as written. A host name under the written host (`ssh.github.com` for `github.com`, a forge's
 * port-443 endpoint) keeps the host as written. A host starting with `-` isn't looked up. Any other remote, or one `ssh`
 * can't look up, comes back as it is.
 */
async function withSshHostName(url: string, log: Logger | undefined): Promise<string> {
  const parts = splitSshHost(url);
  if (parts === null) return url;
  let output = "";
  if (!parts.host.startsWith("-")) {
    try {
      const { stdout } = await exec("ssh", ["-G", parts.host], { timeout: SSH_LOOKUP_TIMEOUT_MS });
      const hostName = /^hostname (\S+)$/m.exec(stdout)?.[1];
      if (hostName !== undefined) {
        if (hostName.toLowerCase().endsWith(`.${parts.host.toLowerCase()}`)) return url;
        return `${parts.before}${hostName}${parts.after}`;
      }
      output = stdout;
    } catch (err) {
      const e = err as { stderr?: unknown; message?: unknown };
      output = typeof e.stderr === "string" && e.stderr.trim() !== "" ? e.stderr : String(e.message ?? err);
    }
  }
  log?.detail(`Couldn't look up the SSH host ${parts.host}, so the remote is recorded as written.\n${output}`);
  return url;
}

/** Records in this checkout's git config which remote the dashboard follows; returns git's message when it fails. */
export async function saveRemoteChoice(root: string, name: string): Promise<string | undefined> {
  const saved = await runGit(root, ["config", "scout.remote", name]);
  return saved.ok ? undefined : saved.detail;
}

/**
 * Removes credentials from a remote URL: all of `user:password@` from an http(s)
 * URL, where a bare user can be a token, and the password from any other URL
 * with a scheme. `git@host:path` and URLs without credentials come back as they are.
 */
export function withoutCredentials(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^@/]*)@/i.exec(url);
  if (!match) return url;
  const [whole, scheme = "", userinfo = ""] = match;
  const rest = url.slice(whole.length);
  if (/^https?:\/\/$/i.test(scheme)) return `${scheme}${rest}`;
  const colon = userinfo.indexOf(":");
  return colon === -1 ? url : `${scheme}${userinfo.slice(0, colon)}@${rest}`;
}

/** The remote's default branch as the clone recorded it in `<remote>/HEAD`, or null. Never contacts the remote. */
export async function recordedDefaultBranch(root: string, remote: string): Promise<string | null> {
  const local = await runGit(root, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
  return local.ok && local.stdout.startsWith(`${remote}/`) ? local.stdout.slice(remote.length + 1) : null;
}

/**
 * The remote's default branch: the `<remote>/HEAD` the clone recorded, else what
 * the remote itself reports, else null.
 */
export async function remoteDefaultBranch(root: string, remote: string): Promise<string | null> {
  const recorded = await recordedDefaultBranch(root, remote);
  if (recorded !== null) return recorded;
  const reported = await runGit(root, ["ls-remote", "--symref", remote, "HEAD"], { network: true });
  if (!reported.ok) return null;
  return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(reported.stdout)?.[1] ?? null;
}

/** Whether `ref` names a commit in this clone. */
export async function hasCommit(root: string, ref: string): Promise<boolean> {
  return (await runGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).ok;
}

/**
 * `commit`'s place on the first-parent chain of `ref`, counting that chain's first commit as 1, or null when `commit` isn't
 * on the chain. It compares the two chains' lengths and looks up the one commit at that distance from `ref`.
 */
export async function firstParentPosition(root: string, ref: string, commit: string): Promise<number | null> {
  const chain = await runGit(root, ["rev-list", "--first-parent", "--count", ref]);
  const own = await runGit(root, ["rev-list", "--first-parent", "--count", commit]);
  if (!chain.ok || !own.ok) return null;
  const back = Number(chain.stdout) - Number(own.stdout);
  if (!Number.isInteger(back) || back < 0) return null;
  const at = await runGit(root, ["rev-parse", "--verify", "--quiet", `${ref}~${back}^{commit}`]);
  return at.ok && at.stdout === commit ? Number(own.stdout) : null;
}

/** The checkout's uncommitted changes, as absolute paths, or git's message when it can't list them. */
export type LocalChanges =
  | { ok: true; top: string; tracked: string[]; added: string[]; untracked: string[] }
  | { ok: false; detail: string };

/**
 * Lists the checkout's uncommitted changes: `tracked` files changed, staged or deleted, `added` files staged as new, and
 * `untracked` files git doesn't ignore, each file listed on its own rather than by folder. `top` is the repository's top folder.
 */
export async function localChanges(root: string): Promise<LocalChanges> {
  const top = await runGit(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { ok: false, detail: top.detail };
  const status = await runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { raw: true, maxBuffer: STATUS_MAX_BUFFER });
  if (!status.ok) return { ok: false, detail: status.detail };
  const tracked: string[] = [];
  const added: string[] = [];
  const untracked: string[] = [];
  const entries = status.stdout.split("\0");
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] ?? "";
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = resolve(top.stdout, entry.slice(3));
    if (code === "??") untracked.push(path);
    else if (code[0] === "A") added.push(path);
    else tracked.push(path);
    // A rename or a copy is followed by the path it came from.
    if (/[RC]/.test(code)) index++;
  }
  return { ok: true, top: top.stdout, tracked, added, untracked };
}

export async function readGitBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
    const branch = stdout.trim();
    // "HEAD" means a detached HEAD, not a named branch.
    return branch === "HEAD" ? null : branch || null;
  } catch {
    return null;
  }
}

export async function readGitToplevel(root: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
