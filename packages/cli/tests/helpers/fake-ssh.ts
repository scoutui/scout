import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { vi } from "vitest";

/**
 * Puts a stand-in `ssh` first on PATH. It answers `ssh -G <host>` with the host name `hosts` gives that alias; any other host
 * gets `otherwise`, or the host itself, as ssh does for a host its config doesn't mention. Returns its folder for the caller
 * to remove; undo the PATH change with `vi.unstubAllEnvs()`.
 */
export function fakeSsh(hosts: Record<string, string> = {}, otherwise?: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-fake-ssh-")));
  const known = Object.entries(hosts).map(([alias, host]) => `  ${alias}) echo "hostname ${host}" ;;\n`).join("");
  writeFileSync(join(dir, "ssh"), `#!/bin/sh\ncase "$2" in\n${known}  *) echo "hostname ${otherwise ?? "$2"}" ;;\nesac\n`);
  chmodSync(join(dir, "ssh"), 0o755);
  const { PATH: path = "" } = process.env;
  vi.stubEnv("PATH", `${dir}${delimiter}${path}`);
  return dir;
}

/** Leaves only git on PATH, so there is no `ssh` to run. Returns the folder for the caller to remove. */
export function pathWithoutSsh(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-no-ssh-")));
  symlinkSync(join(execFileSync("git", ["--exec-path"]).toString().trim(), "git"), join(dir, "git"));
  vi.stubEnv("PATH", dir);
  return dir;
}
