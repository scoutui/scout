import { writeFile, stat, readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { parseGitRemote } from "@scoutui/scan-format/git-remote";
import { assertNotCancelled, type PromptAdapter } from "../prompts/adapter.js";
import { CliError } from "../cli/parse.js";
import { InvalidHostError, isValidUrl, normalizeHost } from "../auth/store.js";
import { readGitBranch, remoteDefaultBranch, saveRemoteChoice, selectRemote, severalRemotesLine } from "../util/git.js";
import { Logger } from "../util/log.js";

export type Framework = "react" | "vue";

export type InitOptions = {
  cwd: string;
  outputPath?: string;
  repoId?: string;
  host?: string;
  branch?: string;
  frameworks?: Framework[];
  interactive?: boolean;
  prompts?: PromptAdapter;
  log?: Logger;
};

const DEFAULT_INCLUDE = "src/**/*.{ts,tsx,jsx,js,vue}";

const FRAMEWORK_EXTS: Record<Framework, string[]> = {
  react: ["ts", "tsx", "js", "jsx"],
  vue: ["vue"],
};

const FRAMEWORK_OPTIONS: { value: Framework; label: string }[] = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
];

function includeGlob(frameworks: Framework[]): string {
  const exts = new Set<string>();
  for (const f of frameworks) for (const e of FRAMEWORK_EXTS[f]) exts.add(e);
  if (exts.size === 0) return DEFAULT_INCLUDE;
  return `src/**/*.{${[...exts].sort().join(",")}}`;
}

type Answers = { repoId: string; host: string | undefined; branch: string | null; include: string };

/** What git suggests for the config: the repository name, the remote's default branch and the checked-out one. */
type GitDefaults = { repoId: string; defaultBranch: string | null; checkedOut: string | null };

function buildConfig(answers: Answers) {
  // `branch` is written whenever a branch is known.
  return {
    $schema: "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
    repoId: answers.repoId,
    ...(answers.host !== undefined ? { host: answers.host } : {}),
    ...(answers.branch !== null ? { branch: answers.branch } : {}),
    include: [answers.include],
    exclude: ["**/*.{test,spec,stories}.*", "**/node_modules/**"],
  };
}

export async function runInit(opts: InitOptions): Promise<void> {
  const cwd = isAbsolute(opts.cwd) ? opts.cwd : resolve(opts.cwd);
  const out = opts.outputPath ?? resolve(cwd, "scout.config.json");
  const log = opts.log ?? new Logger();
  await assertNoExistingConfig(out);
  const host = opts.host !== undefined ? savedHost(opts.host) : undefined;
  const prompts = opts.interactive ? opts.prompts : undefined;
  prompts?.intro("scout init");
  const defaults = await gitDefaults(cwd, log, prompts);
  const done = `Wrote ${out}. Run scout scan to scan the repo and upload the scan.`;

  if (opts.interactive && opts.prompts) {
    const answers = await runWizard(opts.prompts, cwd, defaults, { ...opts, host });
    await writeConfig(out, buildConfig(answers));
    opts.prompts.outro(done);
    return;
  }

  const answers: Answers = {
    repoId: opts.repoId ?? defaults.repoId,
    host,
    branch: opts.branch ?? defaults.defaultBranch ?? defaults.checkedOut,
    include: opts.frameworks && opts.frameworks.length > 0 ? includeGlob(opts.frameworks) : DEFAULT_INCLUDE,
  };
  await writeConfig(out, buildConfig(answers));
  log.info(done);
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
  cwd: string,
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
  const detected = await detectFrameworks(cwd);
  const frameworks = assertNotCancelled(
    await prompts.multiselect<Framework>({
      message: "Which frameworks does this repo use?",
      options: FRAMEWORK_OPTIONS,
      initialValues: detected,
      required: true,
    }),
    prompts,
  );
  return { repoId, host, branch, include: includeGlob(frameworks) };
}

async function detectFrameworks(cwd: string): Promise<Framework[]> {
  try {
    const pkg = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const { react, vue } = deps;
    const out: Framework[] = [];
    if (react) out.push("react");
    if (vue) out.push("vue");
    return out.length > 0 ? out : ["react"];
  } catch {
    return ["react"];
  }
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
