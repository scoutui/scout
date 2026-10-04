import { existsSync } from "node:fs";
import { realpath, writeFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { posixPath } from "@scoutui/reference-graph";
import { parseGitRemote } from "@scoutui/scan-format/git-remote";
import { assertNotCancelled, type PromptAdapter, type SelectOption } from "../prompts/adapter.js";
import { CliError } from "../cli/parse.js";
import { InvalidHostError, isValidUrl, normalizeHost } from "../auth/store.js";
import { probeRepository, readGitBranch, readGitToplevel, remoteDefaultBranch, saveRemoteChoice, selectRemote, severalRemotesLine } from "../util/git.js";
import { Logger } from "../util/log.js";
import { wordmark } from "../util/style.js";
import { DEFAULT_INCLUDE, walkFiles } from "../walker/files.js";
import { detectWorkspacePackages, readJsonSafely } from "../workspace/build-graph.js";
import { findWorkspaceRoot } from "../workspace/find-workspace-root.js";

export type InitOptions = {
  cwd: string;
  outputPath?: string;
  repoId?: string;
  host?: string;
  branch?: string;
  exclude?: string[];
  interactive?: boolean;
  prompts?: PromptAdapter;
  log?: Logger;
};

type Answers = { repoId: string; host: string | undefined; branch: string | null; exclude: string[] };

/** What git suggests for the config: the repository name the remote gives, the remote's default branch and the checked-out one. */
type GitDefaults = { repoId: string | null; defaultBranch: string | null; checkedOut: string | null };

function buildConfig(answers: Answers) {
  // `branch` is written whenever a branch is known.
  return {
    $schema: "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
    repoId: answers.repoId,
    ...(answers.host !== undefined ? { host: answers.host } : {}),
    ...(answers.branch !== null ? { branch: answers.branch } : {}),
    exclude: answers.exclude,
  };
}

export async function runInit(opts: InitOptions): Promise<void> {
  const cwd = isAbsolute(opts.cwd) ? opts.cwd : resolve(opts.cwd);
  let out = opts.outputPath ?? resolve(cwd, "scout.config.json");
  const log = opts.log ?? new Logger();
  const prompts = opts.interactive ? opts.prompts : undefined;
  const rootConfig = opts.outputPath === undefined ? await suggestedRootConfig(cwd) : null;
  await assertNoExistingConfig(out);
  const above = opts.outputPath === undefined ? await configAbove(cwd) : null;
  if (above !== null) throw new CliError(`This repository already has a config: ${above}. Run scout scan in ${dirname(above)} to use it.`, 1);
  const asksRoot = prompts !== undefined && rootConfig !== null;
  const host = opts.host !== undefined ? savedHost(opts.host) : undefined;
  const outsideGit = (await probeRepository(cwd)).kind === "outside";
  if (outsideGit) {
    log.warn("this folder isn't in a git repository, and scout scan needs one. Run git init, or run scout init inside your repository.");
  }
  prompts?.intro(wordmark(log.color, "init"));
  const defaults = await gitDefaults(cwd, log, prompts);
  if (asksRoot) {
    const whole = assertNotCancelled(
      await prompts.confirm({ message: "Scan the whole repository instead of only this package?", initialValue: true }),
      prompts,
    );
    if (whole) out = rootConfig;
    await assertNoExistingConfig(out);
  }
  const runIn = relative(cwd, dirname(out));
  const done = outsideGit
    ? `Wrote ${relative(cwd, out)}.`
    : `Wrote ${relative(cwd, out)}. Run scout scan --dry-run${runIn === "" ? "" : ` in ${runIn}`} to try it, then scout scan to upload.`;

  if (opts.interactive && opts.prompts) {
    const answers = await runWizard(opts.prompts, defaults, { ...opts, host }, dirname(out));
    await writeConfig(out, buildConfig(answers));
    opts.prompts.outro(done);
    return;
  }

  const answers: Answers = {
    repoId: opts.repoId ?? suggestedRepoId(defaults, dirname(out)),
    host,
    branch: opts.branch ?? defaults.defaultBranch ?? defaults.checkedOut,
    exclude: opts.exclude ?? [],
  };
  await writeConfig(out, buildConfig(answers));
  log.success(done);
  if (rootConfig !== null) log.info(`To scan the whole repository, run scout init --output ${relative(cwd, rootConfig)}.`);
}

/** The workspace root's config path when `cwd` is a workspace package, else null. */
async function suggestedRootConfig(cwd: string): Promise<string | null> {
  const root = findWorkspaceRoot(cwd, (await readGitToplevel(cwd)) ?? undefined);
  return root === null ? null : join(root, "scout.config.json");
}

/** The nearest config in a folder above `cwd`, up to the git root, as a path from `cwd`; else null. */
async function configAbove(cwd: string): Promise<string | null> {
  const top = await readGitToplevel(cwd);
  if (top === null) return null;
  const from = await realpath(cwd);
  for (let dir = from; dir !== top && dirname(dir) !== dir; ) {
    dir = dirname(dir);
    const config = join(dir, "scout.config.json");
    if (existsSync(config)) return relative(from, config);
  }
  return null;
}

/** The repository name the remote gives, else the name of the folder that holds the config. */
function suggestedRepoId(defaults: GitDefaults, configDir: string): string {
  return defaults.repoId ?? (basename(configDir) || "unknown");
}

async function gitDefaults(cwd: string, log: Logger, prompts: PromptAdapter | undefined): Promise<GitDefaults> {
  let remote = await selectRemote(cwd, log);
  if (remote.kind === "several" && prompts) {
    const name = assertNotCancelled(
      await prompts.select<string>({
        message: "Which remote does the dashboard follow?",
        options: remote.names.map((n) => ({ value: n, label: n })),
      }),
      prompts,
    );
    const failure = await saveRemoteChoice(cwd, name);
    if (failure !== undefined) {
      throw new CliError(`Couldn't save the remote: git config scout.remote ${name} failed. Run it yourself in this checkout.`, 1, {
        detail: failure,
      });
    }
    remote = await selectRemote(cwd, log);
  } else if (remote.kind === "several") {
    log.warn(severalRemotesLine(remote.names));
  }
  const chosen = remote.kind === "ok" ? remote : undefined;
  return {
    // Azure DevOps paths put `_git` between the project and the repository.
    repoId: (chosen && parseGitRemote(chosen.url)?.path.replace("/_git/", "/")) || null,
    defaultBranch: chosen ? await remoteDefaultBranch(cwd, chosen.name) : null,
    checkedOut: await readGitBranch(cwd),
  };
}

function savedHost(raw: string): string {
  try {
    return normalizeHost(raw);
  } catch (err) {
    if (err instanceof InvalidHostError) throw new CliError(err.message, 2);
    throw err;
  }
}

async function runWizard(
  prompts: PromptAdapter,
  defaults: GitDefaults,
  given: { host: string | undefined; repoId?: string; branch?: string; exclude?: string[] },
  configDir: string,
): Promise<Answers> {
  let host = given.host;
  if (host === undefined) {
    const entered = assertNotCancelled(
      await prompts.text({
        message: "Dashboard address (optional)",
        placeholder: "https://scout.example.com",
        validate: (value) => (value?.trim() ? isValidUrl(value) : undefined),
      }),
      prompts,
    );
    host = entered.trim() ? normalizeHost(entered) : undefined;
  }
  const repoId = given.repoId ?? assertNotCancelled(
    await prompts.text({
      message: "Repository name on the dashboard",
      initialValue: suggestedRepoId(defaults, configDir),
      validate: (value) => (value?.trim() ? undefined : "Enter a repository name."),
    }),
    prompts,
  ).trim();
  const branch = given.branch ?? assertNotCancelled(
    await prompts.text({
      message: "Branch the dashboard tracks",
      initialValue: defaults.defaultBranch ?? defaults.checkedOut ?? "",
      validate: (value) => (value?.trim() ? undefined : "Enter a branch name."),
    }),
    prompts,
  ).trim();
  const exclude = given.exclude ?? (await askLeaveOut(prompts, configDir));
  return { repoId, host, branch, exclude };
}

/** Asks which of `pickerOptions` to leave out of the scan, or asks nothing when `configDir` has no workspace packages. */
async function askLeaveOut(prompts: PromptAdapter, configDir: string): Promise<string[]> {
  const { packages, folders } = await pickerOptions(configDir);
  if (packages.length === 0) return [];
  return assertNotCancelled(
    await prompts.multiselect({
      message: folders.length > 0 ? "Leave any packages or folders out of the scan?" : "Leave any packages out of the scan?",
      options: [...packages, ...folders],
      required: false,
      maxItems: 10,
    }),
    prompts,
  );
}

/**
 * Each workspace package below `configDir`, then each top-level folder that holds no package and holds a file the scan
 * reads, each group sorted by folder. An option's value is its folder relative to `configDir`.
 */
async function pickerOptions(configDir: string): Promise<{ packages: SelectOption<string>[]; folders: SelectOption<string>[] }> {
  const packages = detectWorkspacePackages(configDir, readJsonSafely(join(configDir, "package.json")) ?? {})
    .map((pkg) => ({ value: posixPath(relative(configDir, pkg.absolutePath)), label: pkg.name }))
    .filter(({ value }) => value !== "" && value !== ".." && !value.startsWith("../"))
    .sort((a, b) => (a.value < b.value ? -1 : 1))
    .map((option) => ({ ...option, hint: option.value }));
  if (packages.length === 0) return { packages, folders: [] };
  const files = await walkFiles({ root: configDir, include: [...DEFAULT_INCLUDE], exclude: [], gitignore: true });
  const folders = new Set<string>();
  for (const file of files) {
    const [top, ...below] = posixPath(relative(configDir, file)).split("/");
    if (top === undefined || below.length === 0) continue;
    if (!packages.some(({ value }) => value === top || value.startsWith(`${top}/`))) folders.add(top);
  }
  return { packages, folders: [...folders].sort().map((folder) => ({ value: folder, label: folder })) };
}

function cannotCreate(out: string, cause: unknown): CliError {
  return new CliError(`Couldn't create ${out}. Check that its folder exists and that you can write to it.`, 1, { cause });
}

async function assertNoExistingConfig(out: string): Promise<void> {
  try {
    await stat(out);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cannotCreate(out, err);
  }
  throw new CliError(`${out} already exists. Edit it, or delete it and run scout init again.`, 1);
}

async function writeConfig(out: string, cfg: ReturnType<typeof buildConfig>): Promise<void> {
  try {
    await writeFile(out, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  } catch (err) {
    throw cannotCreate(out, err);
  }
}
