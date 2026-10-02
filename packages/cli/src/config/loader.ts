import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ResolvedConfig } from "../types.js";
import { validateConfig } from "./schema.js";
import { errorMessage } from "../util/errors.js";

export class ConfigError extends Error {
  constructor(public code: "CONFIG_MISSING" | "CONFIG_INVALID", message: string) {
    super(message);
  }
}

export async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  const rawAbs = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  // Resolve symlinks in the config path, such as macOS's /var -> /private/var.
  // Otherwise configDir and the realpath'd paths from module resolution share
  // no prefix, and `relative(configDir, fp)` leaks a machine-local path into
  // `identity.filePath`.
  const abs = await realpath(rawAbs).catch(() => rawAbs);

  try {
    await stat(abs);
  } catch {
    throw new ConfigError(
      "CONFIG_MISSING",
      `Scout config not found at ${abs}. Run \`scout init\` to scaffold one.`
    );
  }

  const raw = await readFile(abs, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError("CONFIG_INVALID", `${abs} is not valid JSON: ${errorMessage(err)}`);
  }

  // A config with the removed `manifests` field is told to use `include`
  // instead, before validation would name it as a field Scout doesn't use.
  if (parsed && typeof parsed === "object" && "manifests" in parsed) {
    throw new ConfigError(
      "CONFIG_INVALID",
      `${abs}: the \`manifests\` field was removed. Replace with \`include\` (array of glob patterns for files to scan).`
    );
  }

  if (!validateConfig(parsed)) {
    const errors = validateConfig.errors ?? [];
    // Fields the schema doesn't list are named in their own message; any other problem is listed as `<field>: <problem>`.
    const unknown = errors.flatMap((e) => {
      const { additionalProperty } = e.params as { additionalProperty?: unknown };
      return e.keyword === "additionalProperties" && e.instancePath === "" ? [`"${String(additionalProperty)}"`] : [];
    });
    if (unknown.length === 1) {
      throw new ConfigError("CONFIG_INVALID", `${abs} has a field Scout doesn't use: ${unknown[0]}. Remove it and try again.`);
    }
    if (unknown.length > 1) {
      throw new ConfigError("CONFIG_INVALID", `${abs} has fields Scout doesn't use: ${unknown.join(", ")}. Remove them and try again.`);
    }
    const issues = errors.map((e) => `${e.instancePath || "<root>"}: ${e.message}`).join("; ");
    throw new ConfigError("CONFIG_INVALID", `Invalid config at ${abs}: ${issues}`);
  }

  // parsed is now narrowed to ConfigFile by the typed validator.
  // Default gitignore to true; opting out is the WIP / untracked-source case.
  const resolved: ResolvedConfig = {
    configPath: abs,
    configDir: dirname(abs),
    include: parsed.include,
    exclude: parsed.exclude ?? [],
    gitignore: parsed.gitignore ?? true,
  };
  // Optional fields are assigned only when present, for
  // `exactOptionalPropertyTypes` (undefined ≠ absent).
  if (parsed.repoId !== undefined) resolved.repoId = parsed.repoId;
  if (parsed.host !== undefined) resolved.host = parsed.host;
  if (parsed.branch !== undefined) resolved.branch = parsed.branch;
  if (parsed.tsconfigPath !== undefined) resolved.tsconfigPath = parsed.tsconfigPath;
  if (parsed.aliases !== undefined) resolved.aliases = parsed.aliases;
  return resolved;
}
