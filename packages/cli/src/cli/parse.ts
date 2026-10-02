import { parseArgs, type ParseArgsConfig } from "node:util";
import { nearestMatch } from "./suggest.js";

type OptionsConfig = NonNullable<ParseArgsConfig["options"]>;

/**
 * A user-facing CLI error: its message is printed and `exitCode` is returned.
 * `detail`, or else the `cause`, prints under `--debug`.
 */
export class CliError extends Error {
  readonly detail: string | undefined;
  constructor(
    message: string,
    public exitCode = 2,
    options: { cause?: unknown; detail?: string } = {},
  ) {
    super(message, "cause" in options ? { cause: options.cause } : undefined);
    this.name = "CliError";
    this.detail = options.detail;
  }
}

export const KNOWN_COMMANDS = ["scan", "backfill", "init", "auth"] as const;

/** The hidden command backfill runs in a child process to scan one commit. */
export const INTERNAL_COMMIT_SCAN = "__backfill-scan";

const SCAN_OPTIONS = {
  config: { type: "string" },
  quiet: { type: "boolean" },
  "repo-id": { type: "string" },
  "repo-root": { type: "string" },
  "dry-run": { type: "boolean" },
  rescan: { type: "boolean" },
  host: { type: "string" },
} satisfies OptionsConfig;

const BACKFILL_OPTIONS = {
  since: { type: "string" },
  rescan: { type: "boolean" },
  config: { type: "string" },
  host: { type: "string" },
  quiet: { type: "boolean" },
} satisfies OptionsConfig;

const INIT_OPTIONS = {
  output: { type: "string" },
  framework: { type: "string", multiple: true },
  "repo-id": { type: "string" },
  host: { type: "string" },
  branch: { type: "string" },
  yes: { type: "boolean", short: "y" },
} satisfies OptionsConfig;
const AUTH_OPTIONS = { host: { type: "string" } } satisfies OptionsConfig;

const COMMANDS: Record<string, { options: OptionsConfig; allowPositionals: boolean }> = {
  scan: { options: SCAN_OPTIONS, allowPositionals: false },
  backfill: { options: BACKFILL_OPTIONS, allowPositionals: false },
  init: { options: INIT_OPTIONS, allowPositionals: false },
  auth: { options: AUTH_OPTIONS, allowPositionals: true },
};

export type ParsedCommand = {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
};

/** Parse one command's argv in strict mode, mapping failures to a CliError. */
export function parseCommand(command: string, argv: string[]): ParsedCommand {
  const spec = COMMANDS[command];
  if (!spec) throw new CliError(unknownCommandMessage(command));
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: spec.options,
      allowPositionals: spec.allowPositionals,
      strict: true,
    });
    const parsedValues = values as Record<string, string | boolean | string[] | undefined>;
    return { values: parsedValues, positionals: [...positionals] };
  } catch (err) {
    throw toCliError(err, command, spec.options);
  }
}

/** Message for an unrecognised top-level command, with a nearest-match hint. */
export function unknownCommandMessage(command: string): string {
  const suggestion = nearestMatch(command, KNOWN_COMMANDS as readonly string[]);
  const hint = suggestion ? ` Did you mean '${suggestion}'?` : "";
  return `Unknown command '${command}'.${hint} Run \`scout --help\`.`;
}

function toCliError(err: unknown, command: string, options: OptionsConfig): CliError {
  const e = err as { code?: string; message?: string };
  if (e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    const bad = extractUnknownOption(e.message ?? "");
    const names = Object.keys(options).map((o) => `--${o}`);
    const suggestion = bad ? nearestMatch(bad, names) : undefined;
    const hint = suggestion ? ` Did you mean '${suggestion}'?` : "";
    return new CliError(`Unknown option '${bad ?? "(option)"}' for \`scout ${command}\`.${hint}`);
  }
  return new CliError(
    `${e.message ?? `Invalid arguments for \`scout ${command}\``} (run \`scout ${command} --help\`).`,
  );
}

/** Node phrases the error as: Unknown option '--ouput'. To specify ... */
function extractUnknownOption(message: string): string | undefined {
  const m = message.match(/Unknown option '([^']+)'/);
  return m?.[1];
}
