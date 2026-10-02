import { existsSync } from "node:fs";
import { isAbsolute, resolve, join } from "node:path";

export type TsconfigDiscoveryInput = {
  /** Directory containing scout.config.json. */
  configDir: string;
  /** Repo root (typically same as configDir, but can differ in nested layouts). */
  repoRoot: string;
  /**
   * Explicit override from the Scout config, absolute or relative to
   * configDir. Used even when the file is missing or broken, which leaves
   * `createImportResolver` an empty tsconfig layer.
   */
  tsconfigPath?: string;
};

/**
 * Where the resolver finds the consumer's tsconfig, first match wins:
 *
 *   1. Explicit `tsconfigPath` from the Scout config (absolute or
 *      configDir-relative).
 *   2. `<configDir>/tsconfig.json` if it exists.
 *   3. `<configDir>/tsconfig.base.json` if it exists.
 *   4. `<repoRoot>/tsconfig.json` if different from configDir and it exists.
 *   5. `<repoRoot>/tsconfig.base.json` if different from configDir and it exists.
 *   6. null: no tsconfig, so `createImportResolver`'s tsconfig `paths` layer
 *      is empty.
 *
 * Discovery returns the leaf path; `loadTsconfigChain` (in tsconfig-loader)
 * handles `extends`, and a solution-style tsconfig's `references`, from there.
 * It doesn't walk up from configDir or repoRoot.
 *
 * Per-package tsconfigs in monorepos are handled separately by
 * `buildPackageAliasLayers` (walker/package-alias-layers.ts), which calls
 * this function once per workspace member with configDir = repoRoot = the
 * member's own directory.
 */
export function resolveTsconfigPath(input: TsconfigDiscoveryInput): string | null {
  if (input.tsconfigPath) {
    return isAbsolute(input.tsconfigPath)
      ? input.tsconfigPath
      : resolve(input.configDir, input.tsconfigPath);
  }
  // tsconfig.base.json is the usual monorepo root config (Next.js, Nx,
  // Turborepo). The loader treats whichever file is found as the chain's leaf.
  const candidates = ["tsconfig.json", "tsconfig.base.json"];
  for (const candidate of candidates) {
    const configDirCandidate = join(input.configDir, candidate);
    if (existsSync(configDirCandidate)) return configDirCandidate;
  }
  if (input.repoRoot !== input.configDir) {
    for (const candidate of candidates) {
      const repoRootCandidate = join(input.repoRoot, candidate);
      if (existsSync(repoRootCandidate)) return repoRootCandidate;
    }
  }
  return null;
}
