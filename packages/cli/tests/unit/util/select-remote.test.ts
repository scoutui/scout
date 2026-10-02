import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { remoteDefaultBranch, selectRemote, withoutCredentials } from "../../../src/util/git.js";
import { Logger } from "../../../src/util/log.js";
import { fakeSsh, pathWithoutSsh } from "../../helpers/fake-ssh.js";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    stdio: "pipe",
  }).toString().trim();
}

function repoWithRemotes(remotes: Record<string, string>): string {
  const dir = tempDir("cc-remote-");
  git(dir, "init", "-q");
  for (const [name, url] of Object.entries(remotes)) git(dir, "remote", "add", name, url);
  return dir;
}

/** A bare repository whose HEAD is `trunk`, with one commit on it, cloned as `origin`. */
function cloneOfTrunk(): { clone: string; bare: string } {
  const root = tempDir("cc-default-branch-");
  const bare = join(root, "bare.git");
  git(root, "init", "-q", "--bare", "--initial-branch=trunk", bare);
  const work = join(root, "work");
  git(root, "init", "-q", "--initial-branch=trunk", work);
  writeFileSync(join(work, "a.txt"), "a\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "init");
  git(work, "push", "-q", bare, "trunk");
  git(root, "clone", "-q", bare, "clone");
  return { clone: join(root, "clone"), bare };
}

describe("selectRemote", () => {
  beforeEach(() => {
    dirs.push(fakeSsh({ "github.com-work": "github.com" }));
  });

  it.each<[string, Record<string, string>, Awaited<ReturnType<typeof selectRemote>>]>([
    ["no remote", {}, { kind: "none" }],
    ["one remote not called origin", { github: "git@github.com:acme/web.git" }, { kind: "ok", name: "github", url: "git@github.com:acme/web.git" }],
    ["origin only", { origin: "git@github.com:acme/web.git" }, { kind: "ok", name: "origin", url: "git@github.com:acme/web.git" }],
    [
      "origin and upstream, as in a fork clone",
      { origin: "git@github.com:ben/web.git", upstream: "git@github.com:acme/web.git" },
      { kind: "ok", name: "upstream", url: "git@github.com:acme/web.git" },
    ],
    [
      "origin and another remote",
      { origin: "git@github.com:acme/web.git", mirror: "git@gitlab.com:acme/web.git" },
      { kind: "ok", name: "origin", url: "git@github.com:acme/web.git" },
    ],
    [
      "two remotes, neither origin nor upstream",
      { github: "git@github.com:acme/web.git", gitlab: "git@gitlab.com:acme/web.git" },
      { kind: "several", names: ["github", "gitlab"] },
    ],
  ])("%s", async (_, remotes, expected) => {
    expect(await selectRemote(repoWithRemotes(remotes))).toEqual(expected);
  });

  it.each<[string, Record<string, string>, string, Awaited<ReturnType<typeof selectRemote>>]>([
    [
      "the remote git config scout.remote names",
      { github: "git@github.com:acme/web.git", gitlab: "git@gitlab.com:acme/web.git" },
      "gitlab",
      { kind: "ok", name: "gitlab", url: "git@gitlab.com:acme/web.git" },
    ],
    [
      "the remote git config scout.remote names, over upstream",
      { origin: "git@github.com:ben/web.git", upstream: "git@github.com:acme/web.git" },
      "origin",
      { kind: "ok", name: "origin", url: "git@github.com:ben/web.git" },
    ],
    [
      "the usual rule when git config scout.remote names a remote that doesn't exist",
      { origin: "git@github.com:acme/web.git", mirror: "git@gitlab.com:acme/web.git" },
      "gone",
      { kind: "ok", name: "origin", url: "git@github.com:acme/web.git" },
    ],
  ])("picks %s", async (_, remotes, saved, expected) => {
    const dir = repoWithRemotes(remotes);
    git(dir, "config", "scout.remote", saved);
    expect(await selectRemote(dir)).toEqual(expected);
  });

  it("picks the same remote from a linked worktree", async () => {
    const dir = repoWithRemotes({ origin: "git@github.com:ben/web.git", upstream: "git@github.com:acme/web.git" });
    git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    const linked = join(tempDir("cc-linked-"), "linked");
    git(dir, "worktree", "add", "-q", "--detach", linked);
    expect(await selectRemote(linked)).toEqual({ kind: "ok", name: "upstream", url: "git@github.com:acme/web.git" });
  });

  it("returns none outside a git repository", async () => {
    expect(await selectRemote(tempDir("cc-no-git-"))).toEqual({ kind: "none" });
  });

  it("reads the remote's URL with git's insteadOf rewrites applied", async () => {
    const dir = repoWithRemotes({ origin: "gh:acme/web.git" });
    git(dir, "config", "url.git@github.com:.insteadOf", "gh:");
    expect(await selectRemote(dir)).toEqual({ kind: "ok", name: "origin", url: "git@github.com:acme/web.git" });
  });

  it.each([
    ["an scp-style remote", "git@github.com-work:acme/web.git", "git@github.com:acme/web.git"],
    ["an ssh:// remote, keeping its user and port", "ssh://git@github.com-work:2222/acme/web.git", "ssh://git@github.com:2222/acme/web.git"],
  ])("records %s under the host its SSH alias stands for", async (_, written, recorded) => {
    expect(await selectRemote(repoWithRemotes({ origin: written }))).toEqual({ kind: "ok", name: "origin", url: recorded });
  });

  it("keeps the host as written when ssh resolves it to a host under it, as a port-443 endpoint does", async () => {
    dirs.push(fakeSsh({ "github.com": "ssh.github.com" }));
    const url = "git@github.com:acme/web.git";
    expect(await selectRemote(repoWithRemotes({ origin: url }))).toEqual({ kind: "ok", name: "origin", url });
  });

  it("doesn't look up the host of an https remote", async () => {
    // Any host ssh is asked about comes back as elsewhere.example, so a lookup would show in the URL.
    dirs.push(fakeSsh({}, "elsewhere.example"));
    const url = "https://github.com/acme/web.git";
    expect(await selectRemote(repoWithRemotes({ origin: url }))).toEqual({ kind: "ok", name: "origin", url });
  });

  it("keeps an SSH remote as written when there's no ssh to look it up, and says so under debug", async () => {
    const dir = repoWithRemotes({ origin: "git@github.com-work:acme/web.git" });
    dirs.push(pathWithoutSsh());
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { stderr.push(chunk); return true; }) as typeof process.stderr.write);
    expect(await selectRemote(dir, new Logger({ debug: true }))).toEqual({ kind: "ok", name: "origin", url: "git@github.com-work:acme/web.git" });
    expect(stderr.join("")).toMatch(/^Couldn't look up the SSH host github\.com-work, so the remote is recorded as written\.\n.*ENOENT/);
  });

  it("doesn't hand ssh a host that starts with a dash, and says so under debug", async () => {
    // Any host ssh is asked about comes back as elsewhere.example, so a lookup would show in the URL.
    dirs.push(fakeSsh({}, "elsewhere.example"));
    const url = "ssh://-oProxyCommand=x/acme/web.git";
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { stderr.push(chunk); return true; }) as typeof process.stderr.write);
    expect(await selectRemote(repoWithRemotes({ origin: url }), new Logger({ debug: true }))).toEqual({ kind: "ok", name: "origin", url });
    expect(stderr.join("")).toBe("Couldn't look up the SSH host -oProxyCommand=x, so the remote is recorded as written.\n");
  });
});

describe("withoutCredentials", () => {
  it.each([
    ["a token as the user of an https URL", "https://ghp_FAKE@github.com/acme/web.git", "https://github.com/acme/web.git"],
    ["a password in an ssh URL", "ssh://deploy:hunter2@git.example.com/acme/web.git", "ssh://deploy@git.example.com/acme/web.git"],
    ["a user without a password in an ssh URL", "ssh://git@github.com/acme/web.git", "ssh://git@github.com/acme/web.git"],
    ["scp-style ssh", "git@github.com:acme/web.git", "git@github.com:acme/web.git"],
    ["an https URL without credentials", "https://github.com/acme/web.git", "https://github.com/acme/web.git"],
  ])("%s", (_, url, expected) => {
    expect(withoutCredentials(url)).toBe(expected);
  });
});

describe("remoteDefaultBranch", () => {
  it("reads the branch the clone recorded as the remote's HEAD", async () => {
    const { clone } = cloneOfTrunk();
    expect(await remoteDefaultBranch(clone, "origin")).toBe("trunk");
  });

  it("asks the remote when the clone recorded no HEAD for it", async () => {
    const { clone } = cloneOfTrunk();
    git(clone, "remote", "set-head", "origin", "-d");
    expect(await remoteDefaultBranch(clone, "origin")).toBe("trunk");
  });

  it("returns null when the remote can't be reached", async () => {
    const dir = repoWithRemotes({ origin: join(tempDir("cc-gone-"), "missing.git") });
    expect(await remoteDefaultBranch(dir, "origin")).toBeNull();
  });
});
