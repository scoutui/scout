const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
} as const;

export type ColorOptions = { isTTY?: boolean; env?: NodeJS.ProcessEnv };

/**
 * Whether to emit ANSI colour: NO_COLOR (any non-empty value) disables;
 * FORCE_COLOR (non-empty, not "0") forces; otherwise follow the TTY. NO_COLOR
 * wins over FORCE_COLOR.
 */
export function colorEnabled(opts: ColorOptions = {}): boolean {
  const env = opts.env ?? process.env;
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const noColor = env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") return false;
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const force = env["FORCE_COLOR"];
  if (force !== undefined && force !== "" && force !== "0") return true;
  return opts.isTTY ?? Boolean(process.stdout.isTTY);
}

export type Colorizer = {
  dim: (s: string) => string;
  bold: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
};

function wrap(code: string, enabled: boolean): (s: string) => string {
  return enabled ? (s) => `${code}${s}${ANSI.reset}` : (s) => s;
}

/**
 * A colour palette in layers: dim/bold are chrome (monochrome), green/yellow/red
 * are the status layer (callers pair them with a glyph and a word). 16-colour
 * ANSI only, so it follows the user's terminal theme.
 */
export function createColor(opts: ColorOptions = {}): Colorizer {
  const on = colorEnabled(opts);
  return {
    dim: wrap(ANSI.dim, on),
    bold: wrap(ANSI.bold, on),
    green: wrap(ANSI.green, on),
    yellow: wrap(ANSI.yellow, on),
    red: wrap(ANSI.red, on),
  };
}
