import { readFileSync } from "node:fs";

export function readVersion(): string {
  const pkgUrl = new URL(import.meta.resolve("@scoutui/cli/package.json"));
  const parsed = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version?: string };
  return parsed.version ?? "0.0.0";
}
