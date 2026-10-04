import { writeFile, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { parseGitRemote } from "@scoutui/scan-format/git-remote";
import { assertNotCancelled, type PromptAdapter } from "../prompts/adapter.js";
import { CliError } from "../cli/parse.js";
import { InvalidHostError, isValidUrl, normalizeHost } from "../auth/store.js";
import { probeRepository, readGitBranch, remoteDefaultBranch, saveRemoteChoice, selectRemote, severalRemotesLine } from "../util/git.js";
import { Logger } from "../util/log.js";

export type InitOptions = {
  cwd: string;
  outputPath?: string;
  repoId?: string;
  host?: string;
  branch?: string;
  interactive?: boolean;
  prompts?: PromptAdapter;
  log?: Logger;
};

type Answers = { repoId: string; host: string | undefined; branch: string | null };

/** What git suggests for the config: the repository name, the remote's default branch and the checked-out one. */
type GitDefaults = { repoId: string; defaultBranch: string | null; checkedOut: string | null };

function buildConfig(answers: Answers) {
  // `branch` is written whenever a branch is known.
  return {
    $schema: "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
    repoId: answers.repoId,
    ...(answers.host !== undefined ? { host: answers.host } : {}),
    ...(answers.branch !== null ? { branch: answers.branch } : {}),
    exclude: [],
  };
}

export async function runInit(opts: InitOptions): Promise<void> {
  const cwd = isAbsolute(opts.cwd) ? opts.cwd : resolve(opts.cwd);
  const out = opts.outputPath ?? resolve(cwd, "scout.config.json");
  const log = opts.log ?? new Logger();
  await assertNoExistingConfig(out);
  const host = opts.host !== undefined ? savedHost(opts.host) : undefined;
  if ((await probeRepository(cwd)).kind === "outside") {
    log.warn("this folder isn't in a git repository, and scout scan needs one. Run git init, or run scout init inside your repository.");
  }
  const prompts = opts.interactive ? opts.prompts : undefined;
  prompts?.intro("scout init");
  const defaults = await gitDefaults(cwd, log, prompts);
  const done = `Wrote ${relative(cwd, out)}. Run scout scan --dry-run to try it, then scout scan to upload.`;

  if (opts.interactive && opts.prompts) {
    const answers = await runWizard(opts.prompts, defaults, { ...opts, host });
    await writeConfig(out, buildConfig(answers));
    opts.prompts.outro(done);
    return;
  }

  const answers: Answers = {
    repoId: opts.repoId ?? defaults.repoId,
    host,
    branch: opts.branch ?? defaults.defaultBranch ?? defaults.checkedOut,
  };
  await writeConfig(out, buildConfig(answers));
  log.success(done);
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
    repoId: (chosen && parseGitRemote(chosen.url)?.path.replace("/_git/", "/")) || basename(cwd) || "unknown",
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
  given: { host: string | undefined; repoId?: string; branch?: string },
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
      initialValue: defaults.repoId,
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
  return { repoId, host, branch };
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
