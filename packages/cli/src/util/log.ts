import { createColor, type Colorizer } from "./color.js";

export type LoggerOptions = {
  /** Hide `info` lines. Warnings and errors still print. */
  quiet?: boolean;
  /** Print the detail passed to `warn` and `error`. */
  debug?: boolean;
  color?: Colorizer;
  /** Whether stderr is a terminal, where a progress line may be showing (default: stderr's own `isTTY`). */
  isTTY?: boolean;
};

/** `--debug` or a `SCOUTUI_DEBUG` that isn't empty or `0`. */
export function debugRequested(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const fromEnv = env["SCOUTUI_DEBUG"];
  return argv.includes("--debug") || (fromEnv !== undefined && fromEnv !== "" && fromEnv !== "0");
}

/** Collapses newlines, control characters and runs of spaces, so a message prints on one line. */
export function oneLine(message: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  return message.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
}

export class Logger {
  readonly quiet: boolean;
  readonly debug: boolean;
  private readonly color: Colorizer;
  /** Clears a progress line being rewritten in place, so a warning or error starts on a clean line. */
  private readonly clearLine: string;

  constructor(opts: LoggerOptions = {}) {
    this.quiet = opts.quiet ?? false;
    this.debug = opts.debug ?? false;
    const isTTY = opts.isTTY ?? Boolean(process.stderr.isTTY);
    this.color = opts.color ?? createColor({ isTTY });
    this.clearLine = isTTY ? "\r\x1b[K" : "";
  }
  info(msg: string): void {
    if (!this.quiet) process.stdout.write(`${msg}\n`);
  }
  /** A line on stdout that prints under quiet too: what happened to the scan, uploaded or written. */
  result(msg: string): void {
    process.stdout.write(`${msg}\n`);
  }
  /** One `Warning:` line; `detail` prints as it is under debug. */
  warn(msg: string, detail?: string): void {
    process.stderr.write(`${this.clearLine}${this.color.yellow("Warning:")} ${oneLine(msg)}\n`);
    this.detail(detail);
  }
  /** One `Error:` line; `detail` prints as it is under debug. */
  error(msg: string, detail?: string): void {
    process.stderr.write(`${this.clearLine}${this.color.red("Error:")} ${oneLine(msg)}\n`);
    this.detail(detail);
  }
  /** Text printed only under debug. */
  detail(text: string | undefined): void {
    if (this.debug && text !== undefined && text !== "") process.stderr.write(`${text.replace(/\n$/, "")}\n`);
  }
}
