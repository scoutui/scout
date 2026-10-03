import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan, scanExitCode } from "../../../src/commands/scan.js";
import { uncommittedRefusal } from "../../../src/upload-policy/git-state.js";
import { Logger } from "../../../src/util/log.js";
import { pushToOrigin } from "../../helpers/git-origin.js";

const { upload, check, createAuthedUploader } = vi.hoisted(() => {
  const upload = vi.fn(async () => ({ status: "inserted" as const, scanId: "S1", url: "/repos/r/scans/S1" }));
  const check = vi.fn(async (): Promise<unknown[] | null> => null);
  return { upload, check, createAuthedUploader: vi.fn(async () => ({ base: "https://h.example", check, upload })) };
});
vi.mock("../../../src/auth/upload-auth.js", () => ({ createAuthedUploader }));

const REFUSED = "Couldn't upload the scan:";
const config = { repoId: "git-state", include: ["src/**/*.tsx"], exclude: [] };
const dirs: string[] = [];
const IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false"];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...IDENTITY, ...args], { cwd, stdio: "pipe" }).toString().trim();
}

/** Commits everything in `dir`. */
function commitAll(dir: string, message: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

/** Adds and commits `src/<name>.tsx`, returning the new commit. */
function addCommit(dir: string, name: string): string {
  writeFileSync(join(dir, "src", `${name}.tsx`), `export function ${name}() { return <div />; }\n`);
  commitAll(dir, name);
  return git(dir, "rev-parse", "HEAD");
}

/**
 * A repository with a component on `main`, pushed to `origin` as a clone has it. The config is committed with it, unless
 * `commitConfig` is false: then it's written after the push and never committed.
 */
function pushedRepo(options: { config?: Record<string, unknown>; commitConfig?: boolean } = {}): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-git-state-")));
  dirs.push(dir);
  const configFile = JSON.stringify(options.config ?? config);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "git-state", private: true }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "App.tsx"), "export function Box() { return <div />; }\nexport function App() { return <Box />; }\n");
  if (options.commitConfig !== false) writeFileSync(join(dir, "scout.config.json"), configFile);
  git(dir, "init", "-q");
  commitAll(dir, "init");
  dirs.push(pushToOrigin(dir));
  if (options.commitConfig === false) writeFileSync(join(dir, "scout.config.json"), configFile);
  return dir;
}

function stderr(): string {
  return vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text)).join("");
}

beforeEach(() => {
  upload.mockClear();
  check.mockClear();
  createAuthedUploader.mockClear();
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("an upload refuses a checkout the dashboard can't take, before scanning", () => {
  it.each<[string, () => { dir: string; line: string }]>([
    ["with no remote", () => {
      const dir = pushedRepo();
      git(dir, "remote", "remove", "origin");
      return { dir, line: `${REFUSED} this checkout has no remote, so Scout can't tell which repository it is. Add one with git remote add origin <url> and try again.` };
    }],
    ["with several remotes and none chosen", () => {
      const dir = pushedRepo();
      git(dir, "remote", "rename", "origin", "github");
      git(dir, "remote", "add", "gitlab", join(dir, "..", "elsewhere.git"));
      return { dir, line: `${REFUSED} this checkout has several remotes and none is called origin, so Scout can't tell which one the dashboard follows. Choose one with git config scout.remote <name>, for example git config scout.remote github.` };
    }],
    ["that is a shallow clone", () => {
      const source = pushedRepo();
      addCommit(source, "Later");
      git(source, "push", "-q", "origin", "main");
      const parent = realpathSync(mkdtempSync(join(tmpdir(), "cc-shallow-")));
      dirs.push(parent);
      git(parent, "clone", "-q", "--depth", "1", `file://${git(source, "remote", "get-url", "origin")}`, "clone");
      return { dir: join(parent, "clone"), line: `${REFUSED} this checkout doesn't have the full history. Run git fetch --unshallow and try again.` };
    }],
    ["whose clone didn't record the remote's default branch", () => {
      const dir = pushedRepo();
      git(dir, "remote", "rename", "origin", "github");
      git(dir, "remote", "set-head", "github", "-d");
      return { dir, line: `${REFUSED} couldn't tell which branch the dashboard tracks. Run git remote set-head github --auto and try again.` };
    }],
    ["whose recorded default branch is gone from the remote", () => {
      const dir = pushedRepo();
      git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
      return { dir, line: `${REFUSED} couldn't tell which branch the dashboard tracks. Run git remote set-head origin --auto and try again.` };
    }],
    ["whose configured branch isn't on the remote", () => {
      const dir = pushedRepo({ config: { ...config, branch: "release" } });
      return { dir, line: `${REFUSED} there's no release on origin. If the branch was renamed, update "branch" in scout.config.json.` };
    }],
    ["on the tracked branch, with a commit that isn't pushed", () => {
      const dir = pushedRepo();
      addCommit(dir, "Later");
      return { dir, line: `${REFUSED} this commit isn't on origin/main yet. Push it and try again.` };
    }],
    ["on another branch, with a commit that isn't on the tracked branch", () => {
      const dir = pushedRepo();
      git(dir, "switch", "-q", "-c", "feature/checkout-v2");
      addCommit(dir, "Later");
      return { dir, line: `${REFUSED} you're on feature/checkout-v2, and the dashboard tracks main. Switch to main and try again.` };
    }],
    ["on a detached commit that reached the tracked branch through a merge", () => {
      const dir = pushedRepo();
      git(dir, "switch", "-q", "-c", "feature");
      const feature = addCommit(dir, "Feature");
      git(dir, "switch", "-q", "main");
      git(dir, "merge", "-q", "--no-ff", "-m", "merge feature", "feature");
      git(dir, "push", "-q", "origin", "main");
      git(dir, "switch", "-q", "--detach", feature);
      return { dir, line: `${REFUSED} commit ${feature.slice(0, 7)} isn't on main. Check out main and try again.` };
    }],
  ])("%s", async (_, setup) => {
    const { dir, line } = setup();
    const result = await runScan({ cwd: dir, quiet: true, upload: true });
    expect(stderr()).toBe(`Error: ${line}\n`);
    expect(scanExitCode(result)).toBe(1);
    expect(result.output).toBeNull();
    expect(createAuthedUploader).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
  });
});

describe("an upload refuses uncommitted changes, listing the files under debug", () => {
  it.each<[string, (dir: string) => void, string]>([
    ["a change to a tracked file", (dir) => writeFileSync(join(dir, "src", "App.tsx"), "export function App() { return <div />; }\n"), "src/App.tsx"],
    ["an untracked file the scan would read", (dir) => writeFileSync(join(dir, "src", "New.tsx"), "export function New() { return <div />; }\n"), "src/New.tsx"],
    ["an edit to the committed config", (dir) => writeFileSync(join(dir, "scout.config.json"), JSON.stringify({ ...config, exclude: ["**/*.test.tsx"] })), "scout.config.json"],
  ])("%s", async (_, change, file) => {
    const dir = pushedRepo();
    change(dir);
    const result = await runScan({ cwd: dir, upload: true, log: new Logger({ quiet: true, debug: true }) });
    expect(stderr()).toBe(`Error: ${REFUSED} you have uncommitted changes. Commit or stash them and try again.\n${file}\n`);
    expect(scanExitCode(result)).toBe(1);
    expect(createAuthedUploader).not.toHaveBeenCalled();
  });

  it("a change to a tracked file, even when the edited config is ignored", async () => {
    const dir = pushedRepo();
    writeFileSync(join(dir, "scout.config.json"), JSON.stringify({ ...config, exclude: ["**/*.test.tsx"] }));
    writeFileSync(join(dir, "src", "App.tsx"), "export function App() { return <div />; }\n");
    const refusal = await uncommittedRefusal(dir, { files: [], exempt: [], ignore: [join(dir, "scout.config.json")] });
    expect(refusal).toEqual({
      message: `${REFUSED} you have uncommitted changes. Commit or stash them and try again.`,
      detail: "src/App.tsx",
    });
  });
});

describe("an upload goes ahead", () => {
  it.each<[string, () => string]>([
    ["on a detached checkout of the tracked branch's tip", () => {
      const dir = pushedRepo();
      git(dir, "switch", "-q", "--detach", "origin/main");
      return dir;
    }],
    ["on another branch whose tip is on the tracked branch", () => {
      const dir = pushedRepo();
      git(dir, "switch", "-q", "-c", "feature/checkout-v2");
      return dir;
    }],
    ["from the remote git config scout.remote chooses", () => {
      const dir = pushedRepo();
      git(dir, "remote", "rename", "origin", "gitlab");
      git(dir, "remote", "add", "github", join(dir, "..", "elsewhere.git"));
      git(dir, "config", "scout.remote", "gitlab");
      return dir;
    }],
    ["with an untracked file the scan doesn't read", () => {
      const dir = pushedRepo();
      writeFileSync(join(dir, "notes.md"), "# Notes\n");
      return dir;
    }],
    ["with a config that was never committed, even when include matches it", () =>
      pushedRepo({ config: { ...config, include: ["**/*"] }, commitConfig: false })],
    ["with the scan file of an earlier run inside include", () => {
      const dir = pushedRepo({ config: { ...config, include: ["**/*"] } });
      writeFileSync(join(dir, "scout-scan.json"), "{}\n");
      return dir;
    }],
  ])("%s", async (_, setup) => {
    const result = await runScan({ cwd: setup(), quiet: true, upload: true });
    expect(stderr()).toBe("");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(scanExitCode(result)).toBe(0);
  });
});
