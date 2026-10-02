import { spawn } from "node:child_process";

type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { stdio: "ignore"; detached: boolean },
) => { on(event: "error", listener: () => void): unknown; unref(): void };

/**
 * Best-effort: open `url` in the user's browser. Never throws; returns whether spawn was attempted.
 * Opens only URLs on the same origin as `host` (a base URL that `normalizeHost` accepted), so a
 * dashboard can't make the CLI open some other address or program.
 */
export function openBrowser(
  url: string,
  host: string,
  deps: { platform?: NodeJS.Platform; spawnFn?: SpawnLike } = {},
): boolean {
  let target: URL;
  try {
    target = new URL(url);
    if (target.origin !== new URL(host).origin) return false;
  } catch {
    return false;
  }
  const platform = deps.platform ?? process.platform;
  const spawnFn = deps.spawnFn ?? (spawn as unknown as SpawnLike);
  // rundll32 hands the URL to the default browser without going through a shell,
  // unlike `cmd /c start`, which would run `&` and other cmd syntax in the URL.
  const [cmd, args] =
    platform === "darwin"
      ? (["open", [target.href]] as const)
      : platform === "win32"
        ? (["rundll32", ["url.dll,FileProtocolHandler", target.href]] as const)
        : (["xdg-open", [target.href]] as const);
  try {
    const child = spawnFn(cmd, [...args], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
