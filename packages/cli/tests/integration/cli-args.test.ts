import { describe, it, expect, afterEach } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pushToOrigin } from "../helpers/git-origin.js";

const exec = promisify(execFile);
const monorepoRoot = resolve(import.meta.dirname, "../../../..");
const cli = resolve(monorepoRoot, "packages/cli/dist/cli.js");
const pkgPath = resolve(monorepoRoot, "packages/cli/package.json");

async function run(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec("node", [cli, ...args], options);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function emptyDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-cli-empty-")));
  dirs.push(dir);
  return dir;
}

/**
 * A repository with one component under `<at>/src` and its config at `<at>/scout.config.json`, committed and pushed to an
 * `origin`, as a clone has it.
 */
function pushedRepo(at: string): string {
  const dir = emptyDir();
  mkdirSync(join(dir, at, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "cli-scan", private: true }));
  writeFileSync(join(dir, at, "scout.config.json"), JSON.stringify({ repoId: "cli-scan", include: ["src/**/*.tsx"] }));
  writeFileSync(join(dir, at, "src", "App.tsx"), "export function Box() { return <div />; }\nexport function App() { return <Box />; }\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  dirs.push(pushToOrigin(dir));
  return dir;
}

/** The environment with no dashboard address and no saved sign-in. */
function withoutDashboard(): NodeJS.ProcessEnv {
  return { ...process.env, SCOUTUI_HOST: "", SCOUTUI_TOKEN: "", SCOUTUI_DEBUG: "", XDG_CONFIG_HOME: emptyDir() };
}

describe("cli argument handling", () => {
  it("--version prints the package.json version", async () => {
    const expected = (JSON.parse(await readFile(pkgPath, "utf8")) as { version: string }).version;
    const { code, stdout } = await run(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(expected);
  });

  it("rejects an unknown flag with a suggestion and exit 2", async () => {
    const { code, stderr } = await run(["scan", "--dry-rn"]);
    expect(code).toBe(2);
    expect(stderr).toBe("Error: Unknown option '--dry-rn' for `scout scan`. Did you mean '--dry-run'?\n");
  });

  it.each(["--output", "--upload", "--commit-date"])("rejects the removed %s flag with exit 2", async (flag) => {
    const { code, stderr } = await run(["scan", flag]);
    expect(code).toBe(2);
    expect(stderr).toBe(`Error: Unknown option '${flag}' for \`scout scan\`.\n`);
  });

  it("refuses --rescan with --dry-run, with one line and exit 2", async () => {
    const { code, stdout, stderr } = await run(["scan", "--rescan", "--dry-run"], { cwd: emptyDir() });
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe("Error: --rescan and --dry-run can't be used together: --dry-run doesn't upload.\n");
  });

  it("refuses a --since that isn't a date, with one line and exit 2", async () => {
    const { code, stderr } = await run(["backfill", "--since", "2026-02-30"], { cwd: emptyDir() });
    expect(stderr).toBe("Error: --since must be a date in the form YYYY-MM-DD, for example 2026-04-02.\n");
    expect(code).toBe(2);
  });

  it.each([[[]], [["--rescan"]]])(
    "uploads by default, so with no dashboard address set it says how to add one or scan without uploading, exits 1 and writes no file (flags %j)",
    async (flags) => {
      const dir = pushedRepo(".");
      const { code, stdout, stderr } = await run(["scan", ...flags], { cwd: dir, env: withoutDashboard() });
      expect(stderr).toBe(
        `Error: Couldn't upload the scan: no dashboard address is set. Add "host" to scout.config.json, or run scout scan --dry-run to scan without uploading.\n`,
      );
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(existsSync(join(dir, "scout-scan.json"))).toBe(false);
    },
  );

  it("writes scout-scan.json next to the config on --dry-run, names it relative to the current folder under --quiet, and ignores --host", async () => {
    const dir = pushedRepo("apps/web");
    const { code, stdout, stderr } = await run(
      ["scan", "--dry-run", "--quiet", "--config", "apps/web/scout.config.json", "--host", "https://scout.invalid"],
      { cwd: dir, env: withoutDashboard() },
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("Wrote apps/web/scout-scan.json (not uploaded).\n");
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "apps/web/scout-scan.json"), "utf8")).meta.repo.id).toBe("cli-scan");
  });

  it("suggests the nearest command for an unknown command", async () => {
    const { code, stderr } = await run(["scn"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/unknown command 'scn'/i);
    expect(stderr).toMatch(/did you mean 'scan'\?/i);
  });

  it("prints scan-only help for `scan --help`", async () => {
    const { code, stdout } = await run(["scan", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("--dry-run");
    expect(stdout).not.toContain("login");
  });

  it("refuses an init --host that isn't https, with one line and exit 2", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "cc-cli-init-host-")));
    try {
      const { code, stderr } = await run(["init", "--yes", "--host", "http://scout.example.com"], { cwd: dir });
      expect(code).toBe(2);
      expect(stderr).toBe(
        "Error: http://scout.example.com doesn't use https://, so your sign-in would be sent unencrypted. Use the dashboard's https:// address. Plain http:// works only for localhost.\n",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each<[label: string, args: (target: string) => string[], env: NodeJS.ProcessEnv]>([
    ["no debug", (target) => ["init", "--yes", "--output", target], {}],
    ["--debug before the command", (target) => ["--debug", "init", "--yes", "--output", target], {}],
    ["--debug after the command", (target) => ["init", "--yes", "--output", target, "--debug"], {}],
    ["SCOUTUI_DEBUG", (target) => ["init", "--yes", "--output", target], { SCOUTUI_DEBUG: "1" }],
  ])("prints an error as one line, with the detail only under debug (%s)", async (label, args, env) => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "cc-cli-error-")));
    try {
      await writeFile(join(dir, "a-file"), "");
      const target = join(dir, "a-file", "scout.config.json");
      const { code, stderr } = await run(args(target), { cwd: dir, env: { ...process.env, SCOUTUI_DEBUG: "", ...env } });
      const line = `Error: Couldn't create ${target}. Check that its folder exists and that you can write to it.\n`;
      expect(code).toBe(1);
      if (label === "no debug") expect(stderr).toBe(line);
      else expect(stderr).toMatch(new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}Error: ENOTDIR: not a directory`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
