import { homedir } from "node:os";
import { join } from "node:path";

/** Directory holding the Scout CLI config (XDG-aware). */
function configDir(env: NodeJS.ProcessEnv = process.env): string {
  // biome-ignore lint/complexity/useLiteralKeys: env access
  const xdg = env["XDG_CONFIG_HOME"];
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".config");
  return join(base, "scoutui");
}

/** Absolute path to the hosts.json token store. */
export function hostsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "hosts.json");
}
