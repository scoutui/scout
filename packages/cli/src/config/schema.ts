import { Ajv, type ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";

const schemaUrl = new URL(import.meta.resolve("@scoutui/cli/schema/config.schema.json"));
const schemaJson = JSON.parse(readFileSync(schemaUrl, "utf8"));

/**
 * Shape of a parsed scout.config.json after AJV validation.
 * Mirrors schema/config.schema.json. loader.ts applies defaults for optional
 * fields when producing ResolvedConfig.
 */
export interface ConfigFile {
  repoId?: string;
  host?: string;
  branch?: string;
  include: string[];
  exclude?: string[];
  gitignore?: boolean;
  $schema?: string;
  tsconfigPath?: string;
  aliases?: Record<string, string[]>;
  install?: string;
}

const ajv = new Ajv({ allErrors: true, strict: false });
export const validateConfig: ValidateFunction<ConfigFile> =
  ajv.compile<ConfigFile>(schemaJson);
