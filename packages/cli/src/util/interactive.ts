export type InteractiveOptions = {
  stdin?: { isTTY?: boolean };
  stdout?: { isTTY?: boolean };
  env?: NodeJS.ProcessEnv;
  yes?: boolean;
};

/**
 * Whether a prompt may be shown, when the value wasn't already supplied by
 * flag, env or config. False in CI, under --yes, or without a TTY on both
 * streams: there a command falls back to a flag or an error instead of
 * waiting on stdin.
 */
export function isInteractive(opts: InteractiveOptions = {}): boolean {
  if (opts.yes) return false;
  const env = opts.env ?? process.env;
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const ci = env["CI"];
  if (ci !== undefined && ci !== "" && ci !== "false" && ci !== "0") return false;
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  return Boolean(stdin.isTTY) && Boolean(stdout.isTTY);
}
