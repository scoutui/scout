import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBackfill } from "../../src/commands/backfill.js";
import { Logger } from "../../src/util/log.js";
import { assertValidArtifact } from "../helpers/artifact.js";
import { acceptingDashboard } from "../helpers/fake-dashboard.js";
import { pushToOrigin } from "../helpers/git-origin.js";

const monorepoRoot = resolve(import.meta.dirname, "../../../..");
const cli = resolve(monorepoRoot, "packages/cli/dist/cli.js");

const INSTALL_STUB = String.raw`node -e 'const fs = require("fs"); if (process.env.SCOUTUI_TOKEN || fs.existsSync("fail-install")) process.exit(1); if (fs.existsSync("rewrite-on-install")) fs.appendFileSync("src/App.tsx", "\n// changed\n"); if (fs.existsSync("pnp-on-install")) fs.writeFileSync(".pnp.cjs", ""); if (fs.existsSync("hang-on-install")) { fs.writeFileSync("install-pid", String(process.pid)); setTimeout(() => {}, 600000); }'`;

const CONFIG = { repoId: "example/web", include: ["src/**/*.tsx"], host: "https://h.example", install: INSTALL_STUB };

const DEFAULT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "backfill-test", private: true }),
  "src/App.tsx": "export function Box() { return <div />; }\nexport function App() { return <Box />; }\n",
};

type Commit = { date: string; files?: Record<string, string> };

const dirs: string[] = [];

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env,
    stdio: "pipe",
  }).toString();
}

/**
 * A repository whose commits, oldest first, each hold the default files with that commit's `files` on top, committed on
 * `date` and pushed to `origin`, with today's `config` written to `scout.config.json`. Returns its folder and the commits'
 * shas, oldest first.
 */
function pushedRepo(commits: Commit[], config: object = CONFIG): { dir: string; shas: string[] } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-backfill-")));
  dirs.push(dir);
  git(dir, ["init", "-q", "--initial-branch=main"]);
  const shas = commits.map(({ date, files }) => {
    for (const entry of readdirSync(dir)) if (entry !== ".git") rmSync(join(dir, entry), { recursive: true });
    for (const [path, content] of Object.entries({ ...DEFAULT_FILES, ...files })) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--allow-empty", "-m", date], { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return git(dir, ["rev-parse", "HEAD"]).trim();
  });
  dirs.push(pushToOrigin(dir));
  writeFileSync(join(dir, "scout.config.json"), JSON.stringify(config));
  return { dir, shas };
}

function backfill(dir: string, opts: { since: string; log?: Logger }): Promise<number> {
  return runBackfill({
    configPath: join(dir, "scout.config.json"),
    since: opts.since,
    rescan: false,
    log: opts.log ?? new Logger(),
    cliEntry: cli,
  });
}

/** The JSON bodies `fetchSpy` sent to `pathname`, in order. */
function sent(fetchSpy: ReturnType<typeof acceptingDashboard>, pathname: string): unknown[] {
  return fetchSpy.mock.calls
    .filter(([input]) => new URL(String(input)).pathname === pathname)
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function stdout(): string {
  return vi.mocked(process.stdout.write).mock.calls.map(([text]) => String(text)).join("");
}
function stderr(): string {
  return vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text)).join("");
}

function backfillFolders(): string[] {
  return readdirSync(tmpdir()).filter((entry) => entry.startsWith("scout-backfill-"));
}

beforeEach(() => {
  vi.stubEnv("SCOUTUI_TOKEN", "ci-secret");
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("scout backfill", () => {
  it("picks the tip and the newest commit of each week since --since, asks the dashboard once, and uploads the rest newest first, with SCOUTUI_TOKEN kept out of the install", async () => {
    const { dir, shas } = pushedRepo([
      { date: "2026-06-02T10:00:00Z" },
      { date: "2026-06-04T10:00:00Z" },
      { date: "2026-05-20T10:00:00Z" },
      { date: "2026-06-10T10:00:00Z" },
      { date: "2026-06-17T23:30:00-02:00" },
      { date: "2026-06-22T09:00:00Z" },
      { date: "2026-06-23T10:00:00Z" },
    ]);
    const [, c2 = "", , c4 = "", c5 = "", , c7 = ""] = shas;
    const fetchSpy = acceptingDashboard((commit) =>
      commit === c4 || commit === c2 ? { decision: "skip", url: `/repos/example%2Fweb/scans/${commit}` } : { decision: "upload" },
    );

    const code = await backfill(dir, { since: "2026-06-01" });

    expect(sent(fetchSpy, "/api/scans/preflight")).toEqual([expect.objectContaining({ commits: [c7, c5, c4, c2], rescan: false })]);
    expect(
      sent(fetchSpy, "/api/scans").map((body) => {
        const { commit, committedAt, branchPosition, branch } = assertValidArtifact(body).meta.repo;
        return { commit, committedAt, branchPosition, branch };
      }),
    ).toEqual([
      { commit: c7, committedAt: "2026-06-23T10:00:00.000Z", branchPosition: 7, branch: "main" },
      { commit: c5, committedAt: "2026-06-18T01:30:00.000Z", branchPosition: 5, branch: "main" },
    ]);
    expect(stderr()).toBe(
      [
        "Found 4 commits on origin/main, one a week since 1 Jun 2026. 2 are already on the dashboard, so Scout will scan 2.\n",
        `Scanning ${c7.slice(0, 7)} (23 Jun 2026), 1 of 2…\n`,
        `Scanning ${c5.slice(0, 7)} (18 Jun 2026), 2 of 2…\n`,
      ].join(""),
    );
    expect(stdout()).toBe("Backfilled main since 1 Jun 2026: 2 uploaded, 2 already there, 0 skipped. See https://h.example/repos/example%2Fweb\n");
    expect(code).toBe(0);
  }, 60_000);

  describe("leaves the user's checkout as it was", () => {
    it("after a run that uploads", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      git(dir, ["checkout", "-q", "-b", "feature/x"]);
      writeFileSync(join(dir, "notes.md"), "unpushed\n");
      git(dir, ["add", "notes.md"]);
      git(dir, ["commit", "-q", "-m", "unpushed"]);
      writeFileSync(join(dir, "staged.md"), "staged\n");
      git(dir, ["add", "staged.md"]);
      writeFileSync(join(dir, "src/App.tsx"), "export function App() { return null; }\n");
      writeFileSync(join(dir, "untracked.md"), "untracked\n");
      const checkout = () => ({
        head: git(dir, ["rev-parse", "HEAD"]),
        branch: git(dir, ["symbolic-ref", "HEAD"]),
        status: git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
        diff: git(dir, ["diff"]),
        staged: git(dir, ["diff", "--cached"]),
        untracked: readFileSync(join(dir, "untracked.md"), "utf8"),
      });
      const before = checkout();
      const foldersBefore = backfillFolders();
      const listeners = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01" });

      expect(checkout()).toEqual(before);
      expect(git(dir, ["worktree", "list", "--porcelain"]).split("\n").filter((line) => line.startsWith("worktree "))).toHaveLength(1);
      expect(backfillFolders()).toEqual(foldersBefore);
      expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(listeners);
      expect(code).toBe(0);
    }, 60_000);
  });

  it("uses today's config at a commit that tracks a different one", async () => {
    const oldConfig = JSON.stringify({ repoId: "example/web", include: ["old/**/*.tsx"] });
    const { dir, shas } = pushedRepo([
      { date: "2026-06-10T10:00:00Z", files: { "scout.config.json": oldConfig } },
      { date: "2026-06-17T10:00:00Z", files: { "scout.config.json": oldConfig } },
    ]);
    const fetchSpy = acceptingDashboard();

    const code = await backfill(dir, { since: "2026-06-01" });

    const uploads = sent(fetchSpy, "/api/scans").map((body) => assertValidArtifact(body));
    const older = uploads.find((artifact) => artifact.meta.repo.commit === shas[0]);
    expect(older?.occurrences.map((occurrence) => occurrence.filePath)).toEqual(["src/App.tsx"]);
    expect(code).toBe(0);
  }, 60_000);

  describe("installs from the lockfile when the config sets no install command", () => {
    const { install: _install, ...configWithoutInstall } = CONFIG;

    beforeEach(() => {
      vi.stubEnv("npm_config_registry", "http://127.0.0.1:9");
      vi.stubEnv("npm_config_fetch_retries", "0");
    });

    it("installs a package-lock.json repo with npm, without downloading Corepack", async () => {
      const lockfile = { name: "backfill-test", lockfileVersion: 3, requires: true, packages: { "": { name: "backfill-test" } } };
      const { dir } = pushedRepo([{ date: "2026-06-17T10:00:00Z", files: { "package-lock.json": JSON.stringify(lockfile) } }], configWithoutInstall);
      const fetchSpy = acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01" });

      expect(sent(fetchSpy, "/api/scans")).toHaveLength(1);
      expect(code).toBe(0);
    }, 60_000);

    it("stops with one line when Corepack can't be downloaded for a yarn.lock repo", async () => {
      const { dir } = pushedRepo(
        [{ date: "2026-06-17T10:00:00Z", files: { "yarn.lock": "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n# yarn lockfile v1\n\n\n" } }],
        configWithoutInstall,
      );
      const fetchSpy = acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }) });

      expect(stderr()).toBe(
        "Error: Couldn't download Corepack, which Scout needs to install Yarn and pnpm projects. Check your connection and npm registry settings, then run scout backfill again.\n",
      );
      expect(sent(fetchSpy, "/api/scans")).toEqual([]);
      expect(stdout()).toBe("");
      expect(code).toBe(1);
    }, 60_000);
  });
});
