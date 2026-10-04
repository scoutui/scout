import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "../../src/cli/report.js";
import { runBackfill } from "../../src/commands/backfill.js";
import { Logger } from "../../src/util/log.js";
import { createColor } from "../../src/util/style.js";
import { assertValidArtifact } from "../helpers/artifact.js";
import { acceptingDashboard, preScanReply } from "../helpers/fake-dashboard.js";
import { pushToOrigin } from "../helpers/git-origin.js";

const monorepoRoot = resolve(import.meta.dirname, "../../../..");
const cli = resolve(monorepoRoot, "packages/cli/dist/cli.js");

const INSTALL_STUB = String.raw`node -e 'const fs = require("fs"); if (process.env.SCOUTUI_TOKEN || fs.existsSync("fail-install")) process.exit(1); if (fs.existsSync("rewrite-on-install")) fs.appendFileSync("src/App.tsx", "\n// changed\n"); if (fs.existsSync("pnp-on-install")) fs.writeFileSync(".pnp.cjs", ""); if (fs.existsSync("hang-on-install")) { fs.writeFileSync("install-pid", String(process.pid)); setTimeout(() => {}, 600000); }'`;

const CONFIG = { repoId: "example/web", include: ["src/**/*.tsx"], host: "https://h.example", install: INSTALL_STUB };

const RENDERS = "export function Box() { return <div />; }\nexport function App() { return <Box />; }\n";

const DEFAULT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "backfill-test", private: true }),
  "src/App.tsx": RENDERS,
};

const END = "See https://h.example/repos/example%2Fweb\n";

const RETRY = "Run scout backfill --debug to retry the skipped commits and see why they failed.\n";

const NEWER_CLI = "a1c9e04 was scanned with a newer CLI (1.4.0). Upgrade the CLI to 1.4.0 or newer, or run npx @scoutui/cli@1.4.0 scan --rescan.";

const VIEWER = "You can view this dashboard but not upload to it. Ask an admin to make you an Editor.";

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
 * `date` and pushed to `origin`, with today's `config` written to `configAt`. Returns its folder and the commits' shas,
 * oldest first.
 */
function pushedRepo(commits: Commit[], config: object = CONFIG, configAt = "scout.config.json"): { dir: string; shas: string[] } {
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
  mkdirSync(dirname(join(dir, configAt)), { recursive: true });
  writeFileSync(join(dir, configAt), JSON.stringify(config));
  return { dir, shas };
}

function backfill(dir: string, opts: { since: string; log?: Logger; rescan?: boolean; configAt?: string; cliEntry?: string }): Promise<number> {
  return runBackfill({
    configPath: join(dir, opts.configAt ?? "scout.config.json"),
    since: opts.since,
    rescan: opts.rescan ?? false,
    log: opts.log ?? new Logger(),
    cliEntry: opts.cliEntry ?? cli,
  });
}

/** The JSON bodies `fetchSpy` sent to `pathname`, in order. */
function sent(fetchSpy: ReturnType<typeof acceptingDashboard>, pathname: string): unknown[] {
  return fetchSpy.mock.calls
    .filter(([input]) => new URL(String(input)).pathname === pathname)
    .map(([, init]) => JSON.parse(String(init?.body)));
}

/** The commit of each scan `fetchSpy` uploaded, in order. */
function uploadedCommits(fetchSpy: ReturnType<typeof acceptingDashboard>): string[] {
  return sent(fetchSpy, "/api/scans").map((body) => assertValidArtifact(body).meta.repo.commit);
}

/**
 * Stands in for a dashboard that answers the pre-scan check with `answer`, as `preScanReply` takes it, receives each upload
 * under its commit, and answers that upload's status with `status(commit)`. Returns the `fetch` spy.
 */
function dashboard(answer: Parameters<typeof preScanReply>[0], status: (commit: string) => object) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input));
    if (pathname === "/api/scans/preflight") return await preScanReply(answer)(input, init);
    if (pathname === "/api/scans") {
      const commit = assertValidArtifact(JSON.parse(String(init?.body))).meta.repo.commit;
      return Response.json({ uploadId: commit, statusUrl: `/api/scans/uploads/${commit}` }, { status: 202 });
    }
    return Response.json(status(pathname.slice("/api/scans/uploads/".length)));
  });
}

const READY = { state: "ready", readable: true, scanId: "S1", url: "/repos/r/scans/S1" };

function stdout(): string {
  return vi.mocked(process.stdout.write).mock.calls.map(([text]) => String(text)).join("");
}
function stderr(): string {
  return vi.mocked(process.stderr.write).mock.calls.map(([text]) => String(text)).join("");
}

function backfillFolders(): string[] {
  return readdirSync(tmpdir()).filter((entry) => entry.startsWith("scout-backfill-"));
}

function worktrees(dir: string): string[] {
  return git(dir, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/** `sha`'s first seven characters and the day it was committed, as a skip line names a commit. */
function named(sha: string, day: string): string {
  return `${sha.slice(0, 7)} (${day})`;
}

beforeEach(() => {
  vi.stubEnv("SCOUTUI_TOKEN", "ci-secret");
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
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
    expect(stdout()).toBe("Backfilled main since 1 Jun 2026: 2 uploaded, 2 already on the dashboard, 0 skipped. See https://h.example/repos/example%2Fweb\n");
    expect(code).toBe(0);
  }, 60_000);

  it("when styled, shows the commit and its step on one line rewritten in place, then the outcome with the link on its own line", async () => {
    const { dir, shas } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
    const [c1 = "", c2 = ""] = shas;
    acceptingDashboard(() => ({ decision: "upload" }));

    const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ styled: true, color: createColor({ isTTY: false, env: {} }), isTTY: true }) });

    expect(stderr()).not.toContain("Scanning ");
    const barred = stderr().replace(/[━╸─]+/g, "<bar>");
    for (const [what, sha, day, count] of [
      ["installing dependencies…", c2, "17 Jun 2026", "1 of 2"],
      ["scanning…", c2, "17 Jun 2026", "1 of 2"],
      ["uploading the scan…", c2, "17 Jun 2026", "1 of 2"],
      ["installing dependencies…", c1, "10 Jun 2026", "2 of 2"],
    ] as const) {
      expect(barred).toContain(`\r⠋ ${named(sha, day)}: ${what}  <bar>  ${count}\x1b[K`);
    }
    expect(stdout()).toBe(`✓ Backfilled main since 1 Jun 2026: 2 uploaded, 0 already on the dashboard, 0 skipped.\n  ${END}`);
    expect(code).toBe(0);
  }, 60_000);

  describe("leaves the user's checkout as it was", () => {
    /** Moves `dir`'s checkout to a branch of its own with an unpushed commit, a staged file, a changed file and an untracked file. */
    function divergeCheckout(dir: string): void {
      git(dir, ["checkout", "-q", "-b", "feature/x"]);
      writeFileSync(join(dir, "notes.md"), "unpushed\n");
      git(dir, ["add", "notes.md"]);
      git(dir, ["commit", "-q", "-m", "unpushed"]);
      writeFileSync(join(dir, "staged.md"), "staged\n");
      git(dir, ["add", "staged.md"]);
      writeFileSync(join(dir, "src/App.tsx"), "export function App() { return null; }\n");
      writeFileSync(join(dir, "untracked.md"), "untracked\n");
    }

    /** What a run must leave as it found it: `dir`'s checkout and worktree list, the temp folder's run folders and the signal listeners. */
    function surroundings(dir: string) {
      return {
        head: git(dir, ["rev-parse", "HEAD"]),
        branch: git(dir, ["symbolic-ref", "HEAD"]),
        status: git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
        diff: git(dir, ["diff"]),
        staged: git(dir, ["diff", "--cached"]),
        untracked: readFileSync(join(dir, "untracked.md"), "utf8"),
        worktrees: worktrees(dir),
        folders: backfillFolders(),
        listeners: [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM"), process.listenerCount("SIGHUP")],
      };
    }

    it("after a run that uploads", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      divergeCheckout(dir);
      const before = surroundings(dir);
      const fetchSpy = acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01" });

      expect(sent(fetchSpy, "/api/scans")).toHaveLength(2);
      expect(surroundings(dir)).toEqual(before);
      expect(code).toBe(0);
    }, 60_000);

    it("after a failed install", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-17T10:00:00Z", files: { "fail-install": "" } }]);
      divergeCheckout(dir);
      const before = surroundings(dir);
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01" });

      expect(surroundings(dir)).toEqual(before);
      expect(code).toBe(1);
    }, 60_000);

    it("after Ctrl-C during the install", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z", files: { "hang-on-install": "" } }]);
      divergeCheckout(dir);
      const before = surroundings(dir);
      const configHome = realpathSync(mkdtempSync(join(tmpdir(), "cc-backfill-config-")));
      dirs.push(configHome);
      const server = createServer((request, response) => {
        let body = "";
        request.setEncoding("utf8").on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", async () => {
          if (request.method !== "POST" || request.url !== "/api/scans/preflight") {
            response.writeHead(404).end();
            return;
          }
          const reply = await preScanReply()(String(request.url), { body });
          response.writeHead(reply.status, { "Content-Type": "application/json" }).end(await reply.text());
        });
      });
      await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
      const { port } = server.address() as AddressInfo;
      let pid = 0;
      try {
        const run = spawn(process.execPath, [cli, "backfill", "--since", "2026-06-01", "--host", `http://127.0.0.1:${port}`], {
          cwd: dir,
          env: { ...process.env, SCOUTUI_TOKEN: "test-token", XDG_CONFIG_HOME: configHome },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        run.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          output += chunk;
        });
        const exited = new Promise<number | null>((closed) => run.on("close", closed));

        pid = await vi.waitFor(
          () => {
            const written = Number(
              worktrees(dir)
                .filter((path) => path !== dir)
                .map((path) => readFileSync(join(path, "install-pid"), "utf8"))[0],
            );
            if (!(written > 0)) throw new Error("The install hasn't started yet.");
            return written;
          },
          { timeout: 20_000, interval: 100 },
        );
        run.kill("SIGINT");

        expect(await exited).toBe(130);
        const stopped = "Stopped. Run scout backfill again to continue: it skips what's already on the dashboard.\n";
        expect(output.slice(-stopped.length)).toBe(stopped);
        expect(surroundings(dir)).toEqual(before);
        await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 2_000, interval: 50 });
      } finally {
        server.close();
        if (pid > 0) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
    }, 60_000);
  });

  describe("skips commits that won't install, and stops after three in a row", () => {
    it("goes on after each failed install while uploads come between them, says to retry with --debug, and exits 1", async () => {
      const fails = { "fail-install": "" };
      const { dir, shas } = pushedRepo([
        { date: "2026-05-13T10:00:00Z" },
        { date: "2026-05-20T10:00:00Z", files: fails },
        { date: "2026-05-27T10:00:00Z" },
        { date: "2026-06-03T10:00:00Z", files: fails },
        { date: "2026-06-10T10:00:00Z", files: fails },
        { date: "2026-06-17T10:00:00Z" },
      ]);
      const [c1 = "", c2 = "", c3 = "", c4 = "", c5 = "", c6 = ""] = shas;
      const fetchSpy = acceptingDashboard();

      const code = await backfill(dir, { since: "2026-05-01" });

      const failed = (sha: string, day: string) => `Warning: Skipped ${named(sha, day)}: the install command in scout.config.json failed.\n`;
      expect(stderr()).toBe(
        [
          "Found 6 commits on origin/main, one a week since 1 May 2026. Scout will scan all 6.\n",
          `Scanning ${named(c6, "17 Jun 2026")}, 1 of 6…\n`,
          `Scanning ${named(c5, "10 Jun 2026")}, 2 of 6…\n`,
          failed(c5, "10 Jun 2026"),
          `Scanning ${named(c4, "3 Jun 2026")}, 3 of 6…\n`,
          failed(c4, "3 Jun 2026"),
          `Scanning ${named(c3, "27 May 2026")}, 4 of 6…\n`,
          `Scanning ${named(c2, "20 May 2026")}, 5 of 6…\n`,
          failed(c2, "20 May 2026"),
          `Scanning ${named(c1, "13 May 2026")}, 6 of 6…\n`,
          RETRY,
        ].join(""),
      );
      expect(uploadedCommits(fetchSpy)).toEqual([c6, c3, c1]);
      expect(stdout()).toBe(`Backfilled main since 1 May 2026: 3 uploaded, 0 already on the dashboard, 3 skipped. ${END}`);
      expect(code).toBe(1);
    }, 60_000);

    it("stops at the history line after three failed installs with only an empty scan between them, and exits 0", async () => {
      const fails = { "fail-install": "" };
      const { dir, shas } = pushedRepo([
        { date: "2026-05-13T10:00:00Z" },
        { date: "2026-05-20T10:00:00Z", files: fails },
        { date: "2026-05-27T10:00:00Z", files: fails },
        { date: "2026-06-03T10:00:00Z", files: { "src/App.tsx": "export const answer = 42;\n" } },
        { date: "2026-06-10T10:00:00Z", files: fails },
        { date: "2026-06-17T10:00:00Z" },
      ]);
      const [c1 = "", , , , , c6 = ""] = shas;
      const fetchSpy = acceptingDashboard();

      const code = await backfill(dir, { since: "2026-05-01" });

      expect(stderr()).not.toContain(`Scanning ${c1.slice(0, 7)}`);
      expect(uploadedCommits(fetchSpy)).toEqual([c6]);
      expect(stdout()).toBe(
        [
          `3 commits in a row wouldn't install, so the charts start at 17 Jun 2026. Check the lines above, or set "install" in scout.config.json.\n`,
          `Backfilled main since 1 May 2026: 1 uploaded, 0 already on the dashboard, 4 skipped. ${END}`,
        ].join(""),
      );
      expect(code).toBe(0);
    }, 60_000);

    it("stops at the history line after an earlier failed install, without saying to retry with --debug, and exits 1", async () => {
      const fails = { "fail-install": "" };
      const { dir, shas } = pushedRepo([
        { date: "2026-05-20T10:00:00Z", files: fails },
        { date: "2026-05-27T10:00:00Z", files: fails },
        { date: "2026-06-03T10:00:00Z", files: fails },
        { date: "2026-06-10T10:00:00Z" },
        { date: "2026-06-17T10:00:00Z", files: fails },
        { date: "2026-06-24T10:00:00Z" },
      ]);
      const [c1 = "", c2 = "", c3 = "", c4 = "", c5 = "", c6 = ""] = shas;
      const fetchSpy = acceptingDashboard();

      const code = await backfill(dir, { since: "2026-05-01", log: new Logger({ quiet: true }) });

      const failed = (sha: string, day: string) => `Warning: Skipped ${named(sha, day)}: the install command in scout.config.json failed.\n`;
      expect(stderr()).toBe(
        [failed(c5, "17 Jun 2026"), failed(c3, "3 Jun 2026"), failed(c2, "27 May 2026"), failed(c1, "20 May 2026")].join(""),
      );
      expect(uploadedCommits(fetchSpy)).toEqual([c6, c4]);
      expect(stdout()).toBe(
        [
          `3 commits in a row wouldn't install, so the charts start at 10 Jun 2026. Check the lines above, or set "install" in scout.config.json.\n`,
          `Backfilled main since 1 May 2026: 2 uploaded, 0 already on the dashboard, 4 skipped. ${END}`,
        ].join(""),
      );
      expect(code).toBe(1);
    }, 60_000);

    it("stops with nothing backfilled when the three newest fail, and exits 1", async () => {
      const fails = { "fail-install": "" };
      const { dir, shas } = pushedRepo([
        { date: "2026-05-27T10:00:00Z" },
        { date: "2026-06-03T10:00:00Z", files: fails },
        { date: "2026-06-10T10:00:00Z", files: fails },
        { date: "2026-06-17T10:00:00Z", files: fails },
      ]);
      const [, c2 = "", c3 = "", c4 = ""] = shas;
      const fetchSpy = acceptingDashboard();

      const code = await backfill(dir, { since: "2026-05-01", log: new Logger({ quiet: true }) });

      const failed = (sha: string, day: string) => `Warning: Skipped ${named(sha, day)}: the install command in scout.config.json failed.\n`;
      expect(stderr()).toBe(
        [
          failed(c4, "17 Jun 2026"),
          failed(c3, "10 Jun 2026"),
          failed(c2, "3 Jun 2026"),
          `Error: Couldn't install the 3 newest commits, so nothing was uploaded. Check the lines above, or set "install" in scout.config.json.\n`,
        ].join(""),
      );
      expect(sent(fetchSpy, "/api/scans")).toEqual([]);
      expect(stdout()).toBe("");
      expect(code).toBe(1);
    }, 60_000);
  });

  it("skips a commit whose install changes a tracked file, and resets the checkout for the next", async () => {
    const { dir, shas } = pushedRepo([
      { date: "2026-06-03T10:00:00Z" },
      { date: "2026-06-10T10:00:00Z", files: { "rewrite-on-install": "" } },
      { date: "2026-06-17T10:00:00Z" },
    ]);
    const [c1 = "", c2 = "", c3 = ""] = shas;
    const fetchSpy = acceptingDashboard();

    const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ debug: true }) });

    expect(stderr()).toContain(
      `Warning: Skipped ${named(c2, "10 Jun 2026")}: the install changed tracked files. Set "install" in scout.config.json to the command this repo installs with.\nsrc/App.tsx\n`,
    );
    expect(uploadedCommits(fetchSpy)).toEqual([c3, c1]);
    expect(code).toBe(1);
  }, 60_000);

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

    it("skips a commit with no lockfile, and exits 1", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-17T10:00:00Z" }], configWithoutInstall);
      const [c1 = ""] = shas;
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }) });

      expect(stderr()).toBe(`Warning: Skipped ${named(c1, "17 Jun 2026")}: there's no lockfile to install from.\n${RETRY}`);
      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 0 uploaded, 0 already on the dashboard, 1 skipped. ${END}`);
      expect(code).toBe(1);
    }, 60_000);
  });

  describe("how other outcomes end the run", () => {
    it("stops at the first commit without the config's folder, dated by the next newer commit, and exits 0", async () => {
      const ignored = { ".gitignore": "node_modules\n" };
      const app = { ...ignored, "apps/web/src/App.tsx": RENDERS };
      const { dir } = pushedRepo(
        [
          { date: "2026-06-03T10:00:00Z", files: ignored },
          { date: "2026-06-10T10:00:00Z", files: app },
          { date: "2026-06-17T10:00:00Z", files: app },
        ],
        { ...CONFIG, install: "mkdir -p apps/web/node_modules && touch apps/web/node_modules/.keep" },
        "apps/web/scout.config.json",
      );
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", configAt: "apps/web/scout.config.json" });

      expect(stdout()).toBe(
        [
          "apps/web doesn't exist before 10 Jun 2026, so the charts start there.\n",
          `Backfilled main since 1 Jun 2026: 2 uploaded, 0 already on the dashboard, 0 skipped. ${END}`,
        ].join(""),
      );
      expect(code).toBe(0);
    }, 60_000);

    it("stops with an error when the tip doesn't have the config's folder yet, and exits 1", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-17T10:00:00Z" }], CONFIG, "apps/web/scout.config.json");
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }), configAt: "apps/web/scout.config.json" });

      expect(stderr()).toBe("Error: apps/web isn't on origin/main yet, so there's nothing to backfill. Merge it, run git fetch, then run scout backfill again.\n");
      expect(stdout()).toBe("");
      expect(code).toBe(1);
    }, 60_000);

    it("stops at an upload error with its line and the line that says to run it again, and exits 1", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
        if (new URL(String(input)).pathname === "/api/scans/preflight") return await preScanReply()(input, init);
        return new Response("Internal Server Error", { status: 500 });
      });

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }) });

      expect(stderr()).toBe(
        [
          "Error: Couldn't upload the scan: the dashboard returned an error. Try again, or ask your dashboard administrator to check its logs.\n",
          "Run scout backfill again to continue: it skips what's already on the dashboard.\n",
        ].join(""),
      );
      expect(sent(fetchSpy, "/api/scans")).toHaveLength(1);
      expect(stdout()).toBe("");
      expect(code).toBe(1);
    }, 60_000);

    it("stops before scanning when the dashboard won't take uploads from this account, and exits 1", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        Response.json({ refusal: { code: "upload_not_allowed", message: VIEWER }, commits: [], warning: null }),
      );

      const code = await backfill(dir, { since: "2026-06-01" });

      expect(stderr()).toBe(`Error: ${VIEWER}\n`);
      expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual(["https://h.example/api/scans/preflight"]);
      expect(stdout()).toBe("");
      expect(code).toBe(1);
    }, 60_000);

    it("stops at the first upload the dashboard refuses because the account can't upload, without scanning the next commit, and exits 1", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-03T10:00:00Z" }, { date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      const [, c2 = "", c3 = ""] = shas;
      let uploads = 0;
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
        const { pathname } = new URL(String(input));
        if (pathname === "/api/scans/preflight") return await preScanReply()(input, init);
        if (pathname === "/api/scans" && ++uploads > 1) {
          return Response.json({ error: "upload_not_allowed", refusal: { code: "upload_not_allowed", message: VIEWER } }, { status: 403 });
        }
        if (pathname === "/api/scans") return Response.json({ uploadId: "U1", statusUrl: "/api/scans/uploads/U1" }, { status: 202 });
        return Response.json(READY);
      });

      const code = await backfill(dir, { since: "2026-06-01" });

      expect(stderr()).toBe(
        [
          "Found 3 commits on origin/main, one a week since 1 Jun 2026. Scout will scan all 3.\n",
          `Scanning ${named(c3, "17 Jun 2026")}, 1 of 3…\n`,
          `Scanning ${named(c2, "10 Jun 2026")}, 2 of 3…\n`,
          `Error: ${VIEWER}\n`,
        ].join(""),
      );
      expect(uploadedCommits(fetchSpy)).toEqual([c3, c2]);
      expect(stdout()).toBe("");
      expect(code).toBe(1);
    }, 60_000);

    it("waits as long as a 429 asks, then uploads the scan again, and exits 0", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-17T10:00:00Z" }]);
      const [c1 = ""] = shas;
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockImplementationOnce(preScanReply())
        .mockImplementationOnce(async () => {
          vi.useFakeTimers();
          return new Response("", { status: 429, headers: { "Retry-After": "180" } });
        })
        .mockImplementationOnce(async () => {
          vi.useRealTimers();
          return Response.json({ uploadId: "U1", statusUrl: "/api/scans/uploads/U1" }, { status: 202 });
        })
        .mockResolvedValueOnce(Response.json(READY));

      const run = backfill(dir, { since: "2026-06-01" });
      const waiting = "The dashboard asked Scout to slow down. Continuing in 3 minutes…\n";
      await vi.waitFor(() => expect(stderr()).toContain(waiting), { timeout: 30_000, interval: 50 });
      await vi.advanceTimersByTimeAsync(179_000);
      expect(sent(fetchSpy, "/api/scans")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_000);
      const code = await run;

      const [first, second] = sent(fetchSpy, "/api/scans");
      expect(second).toEqual(first);
      expect(stderr()).toBe(
        [
          "Found 1 commit on origin/main since 1 Jun 2026. Scout will scan it.\n",
          `Scanning ${named(c1, "17 Jun 2026")}, 1 of 1…\n`,
          waiting,
        ].join(""),
      );
      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 1 uploaded, 0 already on the dashboard, 0 skipped. ${END}`);
      expect(code).toBe(0);
    }, 60_000);

    it("with --rescan, scans the commits already on the dashboard too and counts them as replaced, and exits 0", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      const [c1 = ""] = shas;
      const fetchSpy = dashboard(
        (commit) => (commit === c1 ? { decision: "skip", url: `/repos/example%2Fweb/scans/${commit}` } : { decision: "upload" }),
        (commit) => (commit === c1 ? { ...READY, replaced: true } : READY),
      );

      const code = await backfill(dir, { since: "2026-06-01", rescan: true });

      expect(sent(fetchSpy, "/api/scans/preflight")).toEqual([expect.objectContaining({ rescan: false })]);
      expect(fetchSpy.mock.calls.map(([input]) => String(input)).filter((url) => new URL(url).pathname === "/api/scans")).toEqual([
        "https://h.example/api/scans?rescan=1",
        "https://h.example/api/scans?rescan=1",
      ]);
      expect(stderr()).toContain(
        "Found 2 commits on origin/main, one a week since 1 Jun 2026. Scout will scan all 2, replacing the 1 already on the dashboard.\n",
      );
      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 1 uploaded, 1 replaced, 0 already on the dashboard, 0 skipped. ${END}`);
      expect(code).toBe(0);
    }, 60_000);

    it("skips a commit that installs with Plug'n'Play, and exits 0", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-17T10:00:00Z", files: { "pnp-on-install": "" } }]);
      const [c1 = ""] = shas;
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }) });

      expect(stderr()).toBe(`Warning: Skipped ${named(c1, "17 Jun 2026")}: it installs with Yarn Plug'n'Play, which Scout can't read.\n`);
      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 0 uploaded, 0 already on the dashboard, 1 skipped. ${END}`);
      expect(code).toBe(0);
    }, 60_000);

    it("skips a commit whose dependencies are still missing after the install, and exits 1", async () => {
      const declaresMissing = JSON.stringify({ name: "backfill-test", private: true, dependencies: { "@example/missing": "1.0.0" } });
      const { dir, shas } = pushedRepo([{ date: "2026-06-17T10:00:00Z", files: { "package.json": declaresMissing } }]);
      const [c1 = ""] = shas;
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }) });

      expect(stderr()).toBe(`Warning: Skipped ${named(c1, "17 Jun 2026")}: some dependencies are missing after the install.\n${RETRY}`);
      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 0 uploaded, 0 already on the dashboard, 1 skipped. ${END}`);
      expect(code).toBe(1);
    }, 60_000);

    it("skips a commit whose scan finds no components, and exits 0", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-17T10:00:00Z", files: { "src/App.tsx": "export const answer = 42;\n" } }]);
      const [c1 = ""] = shas;
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }) });

      expect(stderr()).toBe(`Warning: Skipped ${named(c1, "17 Jun 2026")}: the scan found no components.\n`);
      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 0 uploaded, 0 already on the dashboard, 1 skipped. ${END}`);
      expect(code).toBe(0);
    }, 60_000);

    it("skips a commit whose upload the dashboard refuses, goes on, and exits 0", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      const [c1 = "", c2 = ""] = shas;
      const fetchSpy = dashboard({ decision: "upload" }, (commit) =>
        commit === c2
          ? { state: "failed", readable: false, error: { code: "scanned_with_newer_cli", message: `Couldn't upload the scan: ${NEWER_CLI}` } }
          : READY,
      );

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }) });

      expect(stderr()).toBe(`Warning: Skipped ${named(c2, "17 Jun 2026")}: ${NEWER_CLI}\n`);
      expect(uploadedCommits(fetchSpy)).toEqual([c2, c1]);
      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 1 uploaded, 0 already on the dashboard, 1 skipped. ${END}`);
      expect(code).toBe(0);
    }, 60_000);

    it("skips a commit the dashboard refuses before it's scanned, right after the start line, and exits 0", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      const [c1 = "", c2 = ""] = shas;
      const fetchSpy = acceptingDashboard((commit) =>
        commit === c2 ? { decision: "refuse", code: "scanned_with_newer_cli", message: `Couldn't upload the scan: ${NEWER_CLI}` } : { decision: "upload" },
      );

      const code = await backfill(dir, { since: "2026-06-01" });

      expect(stderr()).toBe(
        [
          "Found 2 commits on origin/main, one a week since 1 Jun 2026. Scout will scan 1.\n",
          `Warning: Skipped ${named(c2, "17 Jun 2026")}: ${NEWER_CLI}\n`,
          `Scanning ${named(c1, "10 Jun 2026")}, 1 of 1…\n`,
        ].join(""),
      );
      expect(uploadedCommits(fetchSpy)).toEqual([c1]);
      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 1 uploaded, 0 already on the dashboard, 1 skipped. ${END}`);
      expect(code).toBe(0);
    }, 60_000);

    it("prints only the end line when every commit is already on the dashboard, and exits 0", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-10T10:00:00Z" }, { date: "2026-06-17T10:00:00Z" }]);
      acceptingDashboard((commit) => ({ decision: "skip", url: `/repos/example%2Fweb/scans/${commit}` }));

      const code = await backfill(dir, { since: "2026-06-01" });

      expect(stdout()).toBe(`Backfilled main since 1 Jun 2026: 0 uploaded, 2 already on the dashboard, 0 skipped. ${END}`);
      expect(stderr()).toBe("");
      expect(code).toBe(0);
    }, 60_000);

    it("stops with the scan's output when a commit's scan ends without a result, and exits 1", async () => {
      const { dir } = pushedRepo([{ date: "2026-06-17T10:00:00Z" }]);
      const stubDir = realpathSync(mkdtempSync(join(tmpdir(), "cc-backfill-stub-")));
      dirs.push(stubDir);
      const stub = join(stubDir, "scan.cjs");
      writeFileSync(
        stub,
        String.raw`require("fs").writeFileSync(require("path").join(__dirname, "out-dir"), process.argv[4]); process.stderr.write("Error: Scout stopped unexpectedly (boom).\n"); process.exit(1);`,
      );
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }), cliEntry: stub });

      expect(stderr()).toBe("Error: Scout stopped unexpectedly (boom).\n");
      expect(stdout()).toBe("");
      expect(code).toBe(1);
      expect(existsSync(dirname(readFileSync(join(stubDir, "out-dir"), "utf8")))).toBe(false);
    }, 60_000);

    it("stops with the scan's output and a line naming the commit when its scan is killed before writing a result, and exits 1", async () => {
      const { dir, shas } = pushedRepo([{ date: "2026-06-17T10:00:00Z" }]);
      const [c1 = ""] = shas;
      const stubDir = realpathSync(mkdtempSync(join(tmpdir(), "cc-backfill-stub-")));
      dirs.push(stubDir);
      const stub = join(stubDir, "scan.cjs");
      writeFileSync(
        stub,
        String.raw`const fs = require("fs"); fs.writeFileSync(require("path").join(__dirname, "out-dir"), process.argv[4]); fs.writeSync(2, "Warning: partial\n"); process.kill(process.pid, "SIGKILL");`,
      );
      acceptingDashboard();

      const code = await backfill(dir, { since: "2026-06-01", log: new Logger({ quiet: true }), cliEntry: stub });

      expect(stderr()).toBe(
        [
          "Warning: partial\n",
          `Error: Couldn't scan ${named(c1, "17 Jun 2026")}: the scan stopped unexpectedly. Run scout backfill --debug to see how far it got.\n`,
        ].join(""),
      );
      expect(stdout()).toBe("");
      expect(code).toBe(1);
      expect(existsSync(dirname(readFileSync(join(stubDir, "out-dir"), "utf8")))).toBe(false);
    }, 60_000);

    it("stops with a line naming the commit when git can't check it out, and exits 1", async () => {
      const { dir, shas } = pushedRepo([
        { date: "2026-06-10T10:00:00Z", files: { "notes.md": "only in the older commit\n" } },
        { date: "2026-06-17T10:00:00Z" },
      ]);
      const [c1 = ""] = shas;
      const blob = git(dir, ["rev-parse", `${c1}:notes.md`]).trim();
      rmSync(join(dir, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
      const before = { folders: backfillFolders(), worktrees: worktrees(dir) };
      acceptingDashboard();
      const log = new Logger({ quiet: true });

      const code = await backfill(dir, { since: "2026-06-01", log }).catch((err: unknown) => reportError(err, log, undefined));

      expect(stderr()).toBe(
        `Error: Couldn't check out ${named(c1, "10 Jun 2026")} in a temporary folder. Run scout backfill --debug to see git's output.\n`,
      );
      expect(stdout()).toBe("");
      expect(code).toBe(1);
      expect({ folders: backfillFolders(), worktrees: worktrees(dir) }).toEqual(before);
    }, 60_000);
  });
});
