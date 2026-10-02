import { CliError } from "./parse.js";
import type { Logger } from "../util/log.js";
import { errorStack } from "../util/errors.js";

/**
 * Print an error that ended a command and return its exit code. A `CliError`
 * prints its message; anything else is a bug, and asks to be reported.
 */
export function reportError(err: unknown, log: Logger, bugs: string | undefined): number {
  if (err instanceof CliError) {
    log.error(err.message, err.detail ?? (err.cause === undefined ? undefined : errorStack(err.cause)));
    return err.exitCode;
  }
  const what = `Scout stopped unexpectedly (${err instanceof Error ? err.message : String(err)}).`;
  const where = bugs === undefined ? "" : ` at ${bugs}`;
  log.error(
    log.debug
      ? `${what} Please report this${where}.`
      : `${what} Run the command again with --debug and report the output${where}.`,
    errorStack(err),
  );
  return 1;
}
