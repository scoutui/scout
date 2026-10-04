import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { runInit } from "../../../src/commands/init.js";
import { Logger } from "../../../src/util/log.js";
import { createColor } from "../../../src/util/style.js";
import { fakeSsh } from "../../helpers/fake-ssh.js";
import { stageFixture } from "../../helpers/stage-fixture.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" });
}

/** A repository on `branch` with one commit and the given remotes; `origin/HEAD` points at `main` when there's an origin. */
function repo(dir: string, remotes: Record<string, string>, branch = "main"): void {
  git(dir, "init", "-q", `--initial-branch=${branch}`);
  git(dir, "commit", "-q", "--allow-empty", "-m", "init");
  for (const [name, url] of Object.entries(remotes)) git(dir, "remote", "add", name, url);
  if ("origin" in remotes) git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
}

describe("init command", () => {
  let tmp: string;
  let ssh: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-init-"));
    ssh = fakeSsh();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
    rmSync(ssh, { recursive: true, force: true });
  });

  it("emits valid config without removed fields", async () => {
    await runInit({ cwd: tmp });
    const cfg = JSON.parse(readFileSync(join(tmp, "scout.config.json"), "utf8"));
    expect("manifests" in cfg).toBe(false);
    expect("packageScopes" in cfg).toBe(false);
    expect("tagRules" in cfg).toBe(false);
    expect("includePackageScopeManifests" in cfg).toBe(false);
    expect(cfg.repoId).toBeDefined();
    expect(typeof cfg.repoId).toBe("string");
    expect(cfg.repoId.length).toBeGreaterThan(0);
    expect("include" in cfg).toBe(false);
  });

  it("emitted config passes loadConfig validation", async () => {
    await runInit({ cwd: tmp });
    const { loadConfig } = await import("../../../src/config/loader.js");
    const cfg = await loadConfig(join(tmp, "scout.config.json"));
    expect(cfg.repoId).toBeDefined();
    expect(cfg.include).toBeUndefined();
  });

  it("refuses to overwrite existing config, and says what to do", async () => {
    await runInit({ cwd: tmp });
    await expect(runInit({ cwd: tmp })).rejects.toMatchObject({
      message: `${join(tmp, "scout.config.json")} already exists. Edit it, or delete it and run scout init again.`,
      exitCode: 1,
    });
  });

  const written = () => JSON.parse(readFileSync(join(tmp, "scout.config.json"), "utf8"));

  it.each([
    ["git@github.com:acme/checkout.git", "acme/checkout"],
    ["https://dev.azure.com/acme/shop/_git/checkout", "acme/shop/checkout"],
  ])("names the repository from the remote %s, and saves the remote's default branch", async (remote, repoId) => {
    repo(tmp, { origin: remote });
    await runInit({ cwd: tmp });
    expect(written()).toEqual({
      $schema: "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
      repoId,
      branch: "main",
      exclude: [],
    });
  });

  it("saves --host as the dashboard's full address, and --branch", async () => {
    repo(tmp, { origin: "git@github.com:acme/checkout.git" });
    await runInit({ cwd: tmp, host: "scout.example.com/", branch: "release" });
    expect(written()).toMatchObject({ host: "https://scout.example.com", branch: "release" });
  });

  it("saves --branch when it's the remote's default", async () => {
    repo(tmp, { origin: "git@github.com:acme/checkout.git" });
    await runInit({ cwd: tmp, branch: "main" });
    expect(written()).toMatchObject({ branch: "main" });
  });

  it("writes the checked-out branch when there's no remote to take the default from", async () => {
    repo(tmp, {}, "trunk");
    await runInit({ cwd: tmp });
    expect(written()).toMatchObject({ repoId: basename(tmp), branch: "trunk" });
  });

  it("warns once when several remotes leave it unclear which one the dashboard follows, then says where it wrote the config", async () => {
    repo(tmp, { github: "git@github.com:acme/checkout.git", gitlab: "git@gitlab.com:acme/checkout.git" });
    const stderr: string[] = [];
    const stdout: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    await runInit({ cwd: tmp, log: new Logger({ color: createColor({ isTTY: false, env: {} }) }) });
    vi.restoreAllMocks();
    expect(stderr).toEqual([
      "Warning: this checkout has several remotes and none is called origin, so Scout can't tell which one the dashboard follows. Choose one with git config scout.remote <name>, for example git config scout.remote github.\n",
    ]);
    expect(stdout).toEqual(["Wrote scout.config.json. Run scout scan --dry-run to try it, then scout scan to upload.\n"]);
    expect(written().repoId).toBe(basename(tmp));
  });

  it("writes the config in a workspace package, then says how to scan the whole repository instead", async () => {
    const root = await stageFixture("whole-repo-scope");
    try {
      rmSync(join(root, "scout.config.json"));
      const stdout: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      });
      await runInit({ cwd: join(root, "apps/web"), log: new Logger({ color: createColor({ isTTY: false, env: {} }) }) });
      vi.restoreAllMocks();
      expect(stdout).toEqual([
        "Wrote scout.config.json. Run scout scan --dry-run to try it, then scout scan to upload.\n",
        "To scan the whole repository, run scout init --output ../../scout.config.json.\n",
      ]);
      expect(existsSync(join(root, "apps/web/scout.config.json"))).toBe(true);
      expect(existsSync(join(root, "scout.config.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("warns that a scan needs a git repository, and still writes the config, outside one", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runInit({ cwd: tmp, log: new Logger({ color: createColor({ isTTY: false, env: {} }) }) });
    vi.restoreAllMocks();
    expect(stderr).toEqual([
      "Warning: this folder isn't in a git repository, and scout scan needs one. Run git init, or run scout init inside your repository.\n",
    ]);
    expect(written().repoId).toBe(basename(tmp));
  });

  it("falls back to the folder name, and writes no branch, outside a git repository", async () => {
    await runInit({ cwd: tmp });
    const cfg = JSON.parse(readFileSync(join(tmp, "scout.config.json"), "utf8"));
    // tmp dir basename starts with "cc-init-"
    expect(cfg.repoId).toMatch(/^cc-init-/);
    expect("branch" in cfg).toBe(false);
  });
});
