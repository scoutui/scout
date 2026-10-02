import { spawn } from "node:child_process";

export type ProcessResult = { code: number | null; output: string; timedOut: boolean };

/** A process started by `runProcess`: its id, and what it printed once it has ended. */
export type RunningProcess = { pid: number | undefined; done: Promise<ProcessResult> };

/**
 * Starts `command` in its own process group with stdin closed, collecting stdout and stderr into one `output` in the
 * order they arrive. The environment is `process.env` without `SCOUTUI_TOKEN`, with Corepack's download prompt off.
 * With `shell`, `command` is run through `/bin/sh`. After `timeoutMs` the whole group is killed.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  opts: { cwd: string; shell?: boolean; timeoutMs?: number },
): RunningProcess {
  const { SCOUTUI_TOKEN: _token, ...env } = process.env;
  const child = spawn(command, args, {
    cwd: opts.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: opts.shell ?? false,
    env: { ...env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
  });
  let output = "";
  const append = (chunk: string) => {
    output += chunk;
  };
  child.stdout.setEncoding("utf8").on("data", append);
  child.stderr.setEncoding("utf8").on("data", append);
  const done = new Promise<ProcessResult>((resolve) => {
    let timedOut = false;
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            if (child.pid !== undefined) killProcessGroup(child.pid);
          }, opts.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      append(`${error.message}\n`);
      resolve({ code: null, output, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
  return { pid: child.pid, done };
}

/** Kills the process group `runProcess` started as `pid`, if it is still running. */
export function killProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
