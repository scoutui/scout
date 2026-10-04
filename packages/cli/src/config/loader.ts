import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ResolvedConfig } from "../types.js";
import type { ErrorObject } from "ajv";
import { validateConfig } from "./schema.js";
import { errorMessage } from "../util/errors.js";

export class ConfigError extends Error {
  constructor(
    public code: "CONFIG_MISSING" | "CONFIG_INVALID",
    message: string,
    /** What `--debug` adds under the message. */
    public detail?: string,
  ) {
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
      `Couldn't find ${configPath}. Run scout init to create one, or pass --config <path>.`
    );
  }

  const raw = await readFile(abs, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError("CONFIG_INVALID", `${configPath} isn't valid JSON. Fix it and try again.`, errorMessage(err));
  }

  if (!validateConfig(parsed)) {
    const errors = validateConfig.errors ?? [];
    // Fields the schema doesn't list are named in their own message; any other problem is listed as `<field>: <problem>`.
    const unknown = errors.flatMap((e) => {
      const { additionalProperty } = e.params as { additionalProperty?: unknown };
      return e.keyword === "additionalProperties" && e.instancePath === "" ? [`"${String(additionalProperty)}"`] : [];
    });
    if (unknown.length === 1) {
      throw new ConfigError("CONFIG_INVALID", `${configPath} has a field Scout doesn't use: ${unknown[0]}. Remove it and try again.`);
    }
    if (unknown.length > 1) {
      throw new ConfigError("CONFIG_INVALID", `${configPath} has fields Scout doesn't use: ${unknown.join(", ")}. Remove them and try again.`);
    }
    throw new ConfigError("CONFIG_INVALID", invalidValuesMessage(configPath, errors));
  }

  // parsed is now narrowed to ConfigFile by the typed validator.
  // Default gitignore to true; opting out is the WIP / untracked-source case.
  const resolved: ResolvedConfig = {
    configPath: abs,
    configDir: dirname(abs),
    exclude: parsed.exclude ?? [],
    gitignore: parsed.gitignore ?? true,
  };
  // Optional fields are assigned only when present, for
  // `exactOptionalPropertyTypes` (undefined ≠ absent).
  if (parsed.include !== undefined) resolved.include = parsed.include;
  if (parsed.repoId !== undefined) resolved.repoId = parsed.repoId;
  if (parsed.host !== undefined) resolved.host = parsed.host;
  if (parsed.branch !== undefined) resolved.branch = parsed.branch;
  if (parsed.tsconfigPath !== undefined) resolved.tsconfigPath = parsed.tsconfigPath;
  if (parsed.aliases !== undefined) resolved.aliases = parsed.aliases;
  if (parsed.install !== undefined) resolved.install = parsed.install;
  return resolved;
}

const TYPE_WORDS: Record<string, string> = { array: "a list", string: "a string", boolean: "true or false", object: "an object" };

/** One sentence naming each field the schema rejected and what's wrong with it, in the order the schema reports them. */
function invalidValuesMessage(configPath: string, errors: readonly ErrorObject[]): string {
  const problems = [...new Set(errors.map((e, i) => fieldProblem(e, i === 0 ? configPath : undefined)))];
  const sentence = problems.length === 1 ? problems[0] : `${problems.slice(0, -1).join(", ")}, and ${problems.at(-1)}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. Fix ${problems.length === 1 ? "it" : "them"} and try again.`;
}

/** `"field" can't be empty`, with ` in <configPath>` after the field when `configPath` is given. */
function fieldProblem(e: ErrorObject, configPath: string | undefined): string {
  const [field, ...rest] = e.instancePath.split("/").slice(1);
  const name = field === undefined ? "the config" : rest.length > 0 ? `entries in "${field}"` : `"${field}"`;
  return `${name}${configPath === undefined ? "" : ` in ${configPath}`} ${problemText(e)}`;
}

function problemText(e: ErrorObject): string {
  const { type } = e.params as { type?: unknown };
  if (e.keyword === "type" && typeof type === "string") return `should be ${TYPE_WORDS[type] ?? type}`;
  if (e.keyword === "minItems") return "can't be an empty list";
  if (e.keyword === "minLength") return "can't be empty";
  return e.message ?? "isn't valid";
}
