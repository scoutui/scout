#!/usr/bin/env node
import { runScan, scanExitCode, type ScanOptions } from "./commands/scan.js";
import { runInit } from "./commands/init.js";
import { Logger, debugRequested } from "./util/log.js";
import { wordmark } from "./util/style.js";
import { readVersion } from "./util/version.js";
import { readCliPackage } from "./scan/meta.js";
import { topHelp, commandHelp, styleHelp } from "./cli/help.js";
import { parseCommand, KNOWN_COMMANDS, INTERNAL_COMMIT_SCAN, unknownCommandMessage, CliError } from "./cli/parse.js";
import { reportError } from "./cli/report.js";
import { parseSince } from "./backfill/commits.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isInteractive } from "./util/interactive.js";
import { clackAdapter, PromptCancelledError } from "./prompts/adapter.js";
import type { Framework, InitOptions } from "./commands/init.js";

function isKnownCommand(cmd: string): cmd is (typeof KNOWN_COMMANDS)[number] {
  return (KNOWN_COMMANDS as readonly string[]).includes(cmd);
}

function wantsHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

/** Help on stdout: under the wordmark, in colour, when styled; otherwise as it is. */
function writeHelp(text: string, log: Logger): void {
  process.stdout.write(log.styled ? `${wordmark(log.color)}\n\n${styleHelp(text, log.color)}` : text);
}

async function main(argv: string[], log: Logger): Promise<number> {
  if (argv[0] === undefined) {
    writeHelp(topHelp(), log);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    writeHelp(topHelp(), log);
    return 0;
  }

  if (cmd === INTERNAL_COMMIT_SCAN) {
    const { runCommitScan } = await import("./backfill/scan-commit.js");
    return await runCommitScan(rest, log);
  }

  if (!isKnownCommand(cmd)) {
    log.error(unknownCommandMessage(cmd));
    return 2;
  }

  if (wantsHelp(rest)) {
    writeHelp(commandHelp(cmd), log);
    return 0;
  }

  switch (cmd) {
    case "scan":
      return await runScanCommand(rest, log);
    case "backfill":
      return await runBackfillCommand(rest, log);
    case "init":
      return await runInitCommand(rest, log);
    case "auth": {
      const { runAuth } = await import("./commands/auth.js");
      const interactive = isInteractive();
      return await runAuth(rest, { log, ...(interactive ? { interactive, prompts: clackAdapter } : {}) });
    }
  }
  return 2; // isKnownCommand makes the switch exhaustive; satisfies the type checker.
}

async function runScanCommand(rest: string[], log: Logger): Promise<number> {
  const { values } = parseCommand("scan", rest);
  const { config, quiet, "dry-run": dryRun, "repo-id": repoId, "repo-root": repoRoot, rescan, host } = values;
  if (dryRun && rescan) throw new CliError("--rescan and --dry-run can't be used together: --dry-run doesn't upload.");
  const scanOpts: ScanOptions = {
    configPath: typeof config === "string" ? config : "./scout.config.json",
    log: new Logger({ quiet: Boolean(quiet), debug: log.debug }),
    upload: !dryRun,
  };
  if (typeof repoId === "string") scanOpts.repoId = repoId;
  if (typeof repoRoot === "string") scanOpts.repoRoot = repoRoot;
  if (rescan) scanOpts.rescan = true;
  if (typeof host === "string") scanOpts.hostOverride = host;
  return scanExitCode(await runScan(scanOpts));
}

async function runBackfillCommand(rest: string[], log: Logger): Promise<number> {
  const { values } = parseCommand("backfill", rest);
  const { since, rescan, config, host, quiet } = values;
  const sinceDate = typeof since === "string" ? parseSince(since) : undefined;
  if (sinceDate === null) throw new CliError("--since must be a date in the form YYYY-MM-DD, for example 2026-04-02.");
  const { runBackfill } = await import("./commands/backfill.js");
  return await runBackfill({
    configPath: typeof config === "string" ? config : "./scout.config.json",
    ...(sinceDate !== undefined ? { since: sinceDate } : {}),
    rescan: Boolean(rescan),
    ...(typeof host === "string" ? { hostOverride: host } : {}),
    log: new Logger({ quiet: Boolean(quiet), debug: log.debug }),
    cliEntry: fileURLToPath(import.meta.url),
  });
}

async function runInitCommand(rest: string[], log: Logger): Promise<number> {
  const { values } = parseCommand("init", rest);
  const { yes, output, "repo-id": repoId, host, branch, framework } = values;
  const interactive = isInteractive({ yes: Boolean(yes) });
  const initOpts: InitOptions = { cwd: process.cwd(), interactive, log };
  if (interactive) initOpts.prompts = clackAdapter;
  if (typeof output === "string") initOpts.outputPath = resolve(process.cwd(), output);
  if (typeof repoId === "string") initOpts.repoId = repoId;
  if (typeof host === "string") initOpts.host = host;
  if (typeof branch === "string") initOpts.branch = branch;
  const frameworks = parseFrameworks(framework);
  if (frameworks) initOpts.frameworks = frameworks;
  try {
    await runInit(initOpts);
    return 0;
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      process.stderr.write("Cancelled.\n");
      return 130;
    }
    throw err;
  }
}

const VALID_FRAMEWORKS: Framework[] = ["react", "vue"];

function parseFrameworks(raw: string | boolean | string[] | undefined): Framework[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Framework[] = [];
  for (const r of raw) {
    if ((VALID_FRAMEWORKS as string[]).includes(r)) out.push(r as Framework);
    else throw new CliError(`Unknown --framework '${r}'. Valid: ${VALID_FRAMEWORKS.join(", ")}.`);
  }
  return out;
}

const argv = process.argv.slice(2);
const log = new Logger({ debug: debugRequested(argv) });
main(argv.filter((arg) => arg !== "--debug"), log).then(
  (code) => process.exit(code),
  (err: unknown) => process.exit(reportError(err, log, readCliPackage().bugs)),
);
