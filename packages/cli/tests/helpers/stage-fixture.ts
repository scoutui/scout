import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ScanArtifact } from "@scoutui/scan-format";
import type { Diagnostic } from "../../src/diagnostic.js";
import { assertValidArtifact } from "./artifact.js";

const exec = promisify(execFile);
const monorepoRoot = resolve(import.meta.dirname, "../../../..");
const fixturesRoot = join(monorepoRoot, "test/fixtures");
const cli = join(monorepoRoot, "packages/cli/dist/cli.js");

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function readManifest(dir: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}

let fixturePackages: Promise<Map<string, string>> | undefined;

/** Every fixture under `test/fixtures`, keyed by its package name. */
function fixturePackagesByName(): Promise<Map<string, string>> {
  fixturePackages ??= (async () => {
    const byName = new Map<string, string>();
    for (const entry of await readdir(fixturesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = await readManifest(join(fixturesRoot, entry.name));
      if (manifest?.name) byName.set(manifest.name, join(fixturesRoot, entry.name));
    }
    return byName;
  })();
  return fixturePackages;
}

/**
 * Copies the files git would commit from `source` into `target`, symlinks as
 * they are, except untracked files under a `node_modules` directory.
 */
async function copyTracked(source: string, target: string): Promise<void> {
  const list = async (...args: string[]) =>
    (await exec("git", ["ls-files", "-z", ...args], { cwd: source })).stdout.split("\0").filter(Boolean);
  const tracked = await list("--cached");
  const untracked = (await list("--others", "--exclude-standard")).filter((file) => !/(^|\/)node_modules\//.test(file));
  for (const file of [...tracked, ...untracked]) {
    await mkdir(dirname(join(target, file)), { recursive: true });
    await cp(join(source, file), join(target, file), { verbatimSymlinks: true });
  }
}

/** Installs fixture package `name` into `stage/node_modules`, with the fixture packages it depends on. */
async function install(stage: string, name: string, installed: Set<string>): Promise<void> {
  const source = (await fixturePackagesByName()).get(name);
  if (!source || installed.has(name)) return;
  installed.add(name);
  await copyTracked(source, join(stage, "node_modules", name));
  const manifest = await readManifest(source);
  for (const dependency of Object.keys({ ...manifest?.dependencies, ...manifest?.peerDependencies })) {
    await install(stage, dependency, installed);
  }
}

/**
 * Stages `test/fixtures/<name>` as a repository of its own: a temporary git
 * repo holding the fixture's files, with every fixture package it depends on
 * copied into its `node_modules`, as an install would leave them. Returns the
 * staged directory; the caller removes it.
 */
export async function stageFixture(name: string): Promise<string> {
  const source = join(fixturesRoot, name);
  const stage = await realpath(await mkdtemp(join(tmpdir(), `cc-${name}-`)));
  await copyTracked(source, stage);

  const installed = new Set<string>();
  const manifest = await readManifest(source);
  for (const dependency of Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies })) {
    await install(stage, dependency, installed);
  }

  const git = (...args: string[]) =>
    exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd: stage });
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-q", "-m", "init");
  return stage;
}

/**
 * Stages `test/fixtures/<name>`, scans it with the built CLI's `--dry-run` from `cwd` (relative to the staged repo), and
 * removes the stage. Returns the artefact, its raw JSON and everything the CLI printed.
 */
export async function scanFixture(
  name: string,
  { args = [], cwd = "." }: { args?: string[]; cwd?: string } = {},
): Promise<{ artifact: ScanArtifact<Diagnostic>; raw: string; log: string }> {
  const stage = await stageFixture(name);
  try {
    const from = join(stage, cwd);
    const { stdout, stderr } = await exec(process.execPath, [cli, "scan", "--dry-run", ...args], { cwd: from });
    // A dry run writes scout-scan.json next to the config it read.
    const at = args.indexOf("--config");
    const config = resolve(from, at === -1 ? "scout.config.json" : (args[at + 1] ?? ""));
    const raw = await readFile(join(dirname(config), "scout-scan.json"), "utf8");
    return { artifact: assertValidArtifact(JSON.parse(raw)), raw, log: `${stdout}\n${stderr}` };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
