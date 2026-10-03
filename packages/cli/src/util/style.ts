/** How the CLI's output looks: whether to style it, its colours, the wordmark and the symbols that mark a result. */
import { isInteractive } from "./interactive.js";
import { readVersion } from "./version.js";

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
} as const;

/** Scout's teal at each colour depth: 24-bit, the nearest of the 256 colours, and the theme's own cyan in 16. */
const BRAND = {
  truecolor: "\x1b[38;2;7;154;153m",
  "256": "\x1b[38;5;30m",
  "16": "\x1b[36m",
} as const;

export type ColorDepth = keyof typeof BRAND;

export type ColorOptions = { isTTY?: boolean; env?: NodeJS.ProcessEnv };

/**
 * Whether to emit ANSI colour: NO_COLOR (any non-empty value) disables;
 * FORCE_COLOR (non-empty, not "0") forces; otherwise follow the TTY. NO_COLOR
 * wins over FORCE_COLOR.
 */
export function colorEnabled(opts: ColorOptions = {}): boolean {
  const env = opts.env ?? process.env;
  if (noColor(env)) return false;
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const force = env["FORCE_COLOR"];
  if (force !== undefined && force !== "" && force !== "0") return true;
  return opts.isTTY ?? Boolean(process.stdout.isTTY);
}

function noColor(env: NodeJS.ProcessEnv): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const value = env["NO_COLOR"];
  return value !== undefined && value !== "";
}

/**
 * The colours the terminal says it can show: FORCE_COLOR=3 or a COLORTERM of
 * `truecolor` or `24bit` gives 24-bit, FORCE_COLOR=2 or a TERM naming
 * `256color` gives 256, and anything else 16.
 */
export function colorDepth(env: NodeJS.ProcessEnv = process.env): ColorDepth {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const force = env["FORCE_COLOR"];
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const colorterm = env["COLORTERM"];
  if (force === "3" || colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  // biome-ignore lint/complexity/useLiteralKeys: env access
  if (force === "2" || (env["TERM"] ?? "").includes("256color")) return "256";
  return "16";
}

export type Colorizer = {
  /** Whether these functions add colour, or return their input. */
  enabled: boolean;
  dim: (s: string) => string;
  bold: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  brand: (s: string) => string;
};

function wrap(code: string, enabled: boolean): (s: string) => string {
  return enabled ? (s) => (s === "" ? s : `${code}${s}${ANSI.reset}`) : (s) => s;
}

/**
 * A colour palette in layers: dim/bold are chrome (monochrome), green/yellow/red
 * are the status layer in 16-colour ANSI, so they follow the user's terminal
 * theme (callers pair them with a glyph and a word), and brand is Scout's teal
 * at the depth the terminal supports.
 */
export function createColor(opts: ColorOptions = {}): Colorizer {
  const on = colorEnabled(opts);
  return {
    enabled: on,
    dim: wrap(ANSI.dim, on),
    bold: wrap(ANSI.bold, on),
    green: wrap(ANSI.green, on),
    yellow: wrap(ANSI.yellow, on),
    red: wrap(ANSI.red, on),
    brand: wrap(BRAND[colorDepth(opts.env ?? process.env)], on),
  };
}

/** Scout's wordmark: `scout` in the brand colour, the CLI's version, then `detail`. */
export function wordmark(color: Colorizer, detail?: string): string {
  return `${color.bold(color.brand("scout"))} ${color.dim(readVersion())}${detail !== undefined ? color.dim(` · ${detail}`) : ""}`;
}

const SYMBOLS = { success: "✓", warning: "!", error: "✗" } as const;

export type SymbolKind = keyof typeof SYMBOLS;

/** The symbol that marks a line as a success, a warning or an error, in that status's colour. */
export function symbol(color: Colorizer, kind: SymbolKind): string {
  const paint = kind === "success" ? color.green : kind === "warning" ? color.yellow : color.red;
  return paint(SYMBOLS[kind]);
}

type Stream = { isTTY?: boolean };

export type TerminalStyle = {
  /** Someone is watching in a terminal: not in CI, and stdin, stdout and stderr all terminals. */
  interactive: boolean;
  /**
   * Interactive, and NO_COLOR not set. Commands then show the wordmark, mark results with symbols and animate their
   * progress.
   */
  styled: boolean;
  /** Colour in a terminal, unless NO_COLOR is set; FORCE_COLOR turns it on anywhere. */
  color: Colorizer;
};

/** How this run writes to the terminal: whether someone is watching, whether it's styled for them, and its colours. */
export function terminalStyle(
  opts: { env?: NodeJS.ProcessEnv; stdin?: Stream; stdout?: Stream; stderr?: Stream } = {},
): TerminalStyle {
  const env = opts.env ?? process.env;
  const interactive =
    isInteractive({ env, stdin: opts.stdin ?? process.stdin, stdout: opts.stdout ?? process.stdout }) &&
    Boolean((opts.stderr ?? process.stderr).isTTY);
  return { interactive, styled: interactive && !noColor(env), color: createColor({ isTTY: interactive, env }) };
}
