import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readToolPackage(packageRoot: string): { name?: string; version: string; bugs?: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      bugs?: unknown;
    };
    // npm accepts `bugs` as a URL or as `{ url, email }`.
    const bugs = typeof pkg.bugs === "object" && pkg.bugs !== null ? (pkg.bugs as { url?: unknown }).url : pkg.bugs;
    return {
      ...(typeof pkg.name === "string" ? { name: pkg.name } : {}),
      version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
      ...(typeof bugs === "string" ? { bugs } : {}),
    };
  } catch {
    return { version: "0.0.0" };
  }
}
