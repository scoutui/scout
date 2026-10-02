import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, afterEach, vi } from "vitest";
import { runScan } from "../../src/commands/scan.js";
import { assertValidArtifact } from "../helpers/artifact.js";
import { acceptingDashboard } from "../helpers/fake-dashboard.js";
import { fakeSsh } from "../helpers/fake-ssh.js";
import { pushToOrigin } from "../helpers/git-origin.js";

const exec = promisify(execFile);

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

test("scan stamps meta.repo from git, and the scanner's name and version from the CLI's package.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-meta-"));
  dirs.push(dir);
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "package.json"), '{"name":"meta-test","version":"0.0.0"}');
  await writeFile(
    join(dir, "scout.config.json"),
    JSON.stringify({ include: ["**/*.ts"] }),
  );
  await writeFile(join(dir, "noop.ts"), "export const x = 1;\n");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], { cwd: dir });

  const result = await runScan({ cwd: dir });
  const output = assertValidArtifact(result.output);
  expect(output.meta.repo.commit).toBe(head.trim());
  expect(output.meta.repo.initialCommit).toBe(head.trim());
  expect(output.meta.repo.gitRemote).toBeNull();
  expect(output.meta.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  const cli = JSON.parse(await readFile(resolve(import.meta.dirname, "../../package.json"), "utf8")) as { name: string; version: string };
  expect(output.meta.scannerName).toBe(cli.name);
  expect(output.meta.scannerVersion).toBe(cli.version);
}, 30_000);

test("scan records the HEAD committer date in UTC as meta.repo.committedAt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-committed-at-"));
  dirs.push(dir);
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  await writeFile(join(dir, "package.json"), '{"name":"committed-at","version":"0.0.0"}');
  await writeFile(
    join(dir, "scout.config.json"),
    JSON.stringify({ include: ["**/*.ts"] }),
  );
  await writeFile(join(dir, "noop.ts"), "export const x = 1;\n");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "init"], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-05-01T09:00:00+00:00", GIT_COMMITTER_DATE: "2026-06-01T12:00:00+02:00" },
  });

  const live = assertValidArtifact((await runScan({ cwd: dir })).output);
  expect(live.meta.repo.committedAt).toBe("2026-06-01T10:00:00.000Z");
}, 30_000);

test("scan reads the HEAD commit date when git is set to show signatures and HEAD is signed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-signed-head-"));
  const keyDir = await mkdtemp(join(tmpdir(), "cc-signing-key-"));
  dirs.push(dir, keyDir);
  await exec("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "test@example.com", "-f", join(keyDir, "key")]);
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await exec("git", ["config", "gpg.format", "ssh"], { cwd: dir });
  await exec("git", ["config", "gpg.ssh.program", "ssh-keygen"], { cwd: dir });
  await exec("git", ["config", "user.signingkey", join(keyDir, "key")], { cwd: dir });
  await exec("git", ["config", "log.showSignature", "true"], { cwd: dir });
  await writeFile(join(dir, "package.json"), '{"name":"signed-head","version":"0.0.0"}');
  await writeFile(
    join(dir, "scout.config.json"),
    JSON.stringify({ include: ["**/*.ts"] }),
  );
  await writeFile(join(dir, "noop.ts"), "export const x = 1;\n");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-q", "-S", "-m", "init"], {
    cwd: dir,
    env: { ...process.env, GIT_COMMITTER_DATE: "2026-06-01T12:00:00+02:00" },
  });

  const output = assertValidArtifact((await runScan({ cwd: dir })).output);
  expect(output.meta.repo.committedAt).toBe("2026-06-01T10:00:00.000Z");
}, 30_000);

test.each([
  ["gives no date", undefined],
  ["gives output that isn't a date", 'Good "git" signature for test@example.com\n2026-06-01T12:00:00+02:00'],
])("scan refuses a repository when git %s for the HEAD commit", async (_case, commitDate) => {
  const dir = await mkdtemp(join(tmpdir(), "cc-no-commit-date-"));
  dirs.push(dir);
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "package.json"), '{"name":"no-commit-date","version":"0.0.0"}');
  await writeFile(
    join(dir, "scout.config.json"),
    JSON.stringify({ include: ["**/*.ts"] }),
  );
  await writeFile(join(dir, "noop.ts"), "export const x = 1;\n");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "init"], { cwd: dir });

  const gitModule = await import("../../src/util/git.js");
  vi.spyOn(gitModule, "readGitCommitDate").mockResolvedValue(commitDate);

  await expect(runScan({ cwd: dir })).rejects.toThrow(
    `Couldn't read the date of the current commit in ${await realpath(dir)}. Check that git log -1 works there, then try again.`,
  );
}, 30_000);

test.each([
  ["isn't a git repository", "none"],
  ["is a git repository with no commits", "empty"],
  ["is a git repository git can't read", "broken"],
] as const)("scan refuses a folder that %s, in one line", async (_case, git) => {
  const dir = await mkdtemp(join(tmpdir(), "cc-no-git-"));
  dirs.push(dir);
  if (git !== "none") await exec("git", ["init", "-q"], { cwd: dir });
  if (git === "broken") await writeFile(join(dir, ".git", "config"), "[[[ not a config\n");
  await writeFile(join(dir, "package.json"), '{"name":"no-git","version":"0.0.0"}');
  await writeFile(join(dir, "scout.config.json"), JSON.stringify({ include: ["**/*.ts"] }));
  const at = await realpath(dir);
  const expected = {
    none: { message: `Couldn't scan: ${at} isn't inside a git repository. Run scout scan from a git checkout.` },
    empty: { message: "Couldn't scan: this repository has no commits yet. Commit your files and try again." },
    broken: {
      message: `Couldn't scan: git failed in ${at}. Run git status there to see why, then try again.`,
      detail: expect.stringContaining("bad config line 1"),
    },
  }[git];
  await expect(runScan({ cwd: dir })).rejects.toMatchObject({ ...expected, exitCode: 1 });
}, 30_000);

test("scan of a shallow clone warns once and records no first commit", async () => {
  const origin = await mkdtemp(join(tmpdir(), "cc-meta-origin-"));
  const parent = await mkdtemp(join(tmpdir(), "cc-meta-shallow-"));
  dirs.push(origin, parent);
  await exec("git", ["init", "-q"], { cwd: origin });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: origin });
  await exec("git", ["config", "user.name", "Test"], { cwd: origin });
  await writeFile(join(origin, "package.json"), '{"name":"meta-shallow","version":"0.0.0"}');
  await writeFile(join(origin, "scout.config.json"), JSON.stringify({ include: ["**/*.ts"] }));
  for (const n of [1, 2]) {
    await writeFile(join(origin, "noop.ts"), `export const x = ${n};\n`);
    await exec("git", ["add", "-A"], { cwd: origin });
    await exec("git", ["commit", "-q", "-m", `commit ${n}`], { cwd: origin });
  }
  await exec("git", ["clone", "-q", "--depth", "1", `file://${origin}`, "clone"], { cwd: parent });
  const dir = join(parent, "clone");
  const errors: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => { errors.push(s); return true; }) as typeof process.stderr.write);

  const output = assertValidArtifact((await runScan({ cwd: dir, quiet: true })).output);

  expect(errors).toEqual(["Warning: This checkout doesn't have the full history. Run git fetch --unshallow and scan again.\n"]);
  expect(output.meta.repo.initialCommit).toBeNull();
  const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], { cwd: dir });
  expect(output.meta.repo.commit).toBe(head.trim());
}, 30_000);

test.each([
  ["a clone with only origin records origin's URL", { origin: "git@github.com:acme/checkout.git" }, "git@github.com:acme/checkout.git", "checkout"],
  [
    "a fork clone records upstream's URL and takes its name from it",
    { origin: "git@github.com:ben/fork.git", upstream: "git@github.com:acme/checkout.git" },
    "git@github.com:acme/checkout.git",
    "checkout",
  ],
  [
    "a clone URL with a token in it is recorded without the token",
    { origin: "https://gitlab-ci-token:FAKE_TOKEN@gitlab.com/acme/checkout.git" },
    "https://gitlab.com/acme/checkout.git",
    "checkout",
  ],
])("scan: %s", async (_, remotes, gitRemote, repoId) => {
  dirs.push(fakeSsh());
  const dir = await mkdtemp(join(tmpdir(), "cc-remote-meta-"));
  dirs.push(dir);
  await exec("git", ["init", "-q"], { cwd: dir });
  for (const [name, url] of Object.entries(remotes)) await exec("git", ["remote", "add", name, url], { cwd: dir });
  await writeFile(join(dir, "scout.config.json"), JSON.stringify({ include: ["**/*.ts"] }));
  await writeFile(join(dir, "noop.ts"), "export const x = 1;\n");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"], { cwd: dir });

  const output = assertValidArtifact((await runScan({ cwd: dir })).output);
  expect(output.meta.repo.gitRemote).toBe(gitRemote);
  expect(output.meta.repo.id).toBe(repoId);
  expect(JSON.stringify(output)).not.toContain("FAKE_TOKEN");
}, 30_000);

test("scan applies config repoId to meta.repo.id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-repoid-"));
  dirs.push(dir);
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "package.json"), '{"name":"repoid-test","version":"0.0.0"}');
  await writeFile(
    join(dir, "scout.config.json"),
    JSON.stringify({ include: ["**/*.ts"], repoId: "my-org/my-app" }),
  );
  await writeFile(join(dir, "noop.ts"), "export const x = 1;\n");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "init"], { cwd: dir });

  const result = await runScan({ cwd: dir });
  const output = assertValidArtifact(result.output);
  expect(output.meta.repo.id).toBe("my-org/my-app");
}, 30_000);

test("scan --repo-id flag overrides config repoId", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-repoid-flag-"));
  dirs.push(dir);
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(join(dir, "package.json"), '{"name":"repoid-flag","version":"0.0.0"}');
  await writeFile(
    join(dir, "scout.config.json"),
    JSON.stringify({ include: ["**/*.ts"], repoId: "from-config" }),
  );
  await writeFile(join(dir, "noop.ts"), "export const x = 1;\n");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "init"], { cwd: dir });

  const result = await runScan({ cwd: dir, repoId: "from-flag" });
  const output = assertValidArtifact(result.output);
  expect(output.meta.repo.id).toBe("from-flag");
}, 30_000);

test("an upload records the branch the dashboard tracks and the commit's place on it; a dry run records the checked-out branch", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "cc-tracked-branch-")));
  dirs.push(dir);
  const git = (...args: string[]) =>
    exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
  await git("init", "-q");
  await writeFile(join(dir, "scout.config.json"), JSON.stringify({ include: ["**/*.tsx"] }));
  await writeFile(join(dir, "App.tsx"), "export function Box() { return <div />; }\nexport function App() { return <Box />; }\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "one");
  await git("commit", "-q", "--allow-empty", "-m", "two");
  dirs.push(pushToOrigin(dir));
  await git("switch", "-q", "-c", "feature");
  vi.stubEnv("SCOUTUI_TOKEN", "ci-secret");
  vi.stubEnv("SCOUTUI_HOST", "https://h.example");
  acceptingDashboard();
  vi.spyOn(process.stdout, "write").mockReturnValue(true);

  const uploaded = assertValidArtifact((await runScan({ cwd: dir, quiet: true, upload: true })).output);
  expect(uploaded.meta.repo).toMatchObject({ branch: "main", branchPosition: 2 });

  const local = assertValidArtifact((await runScan({ cwd: dir, quiet: true })).output);
  expect(local.meta.repo.branch).toBe("feature");
  expect(local.meta.repo).not.toHaveProperty("branchPosition");
}, 30_000);
