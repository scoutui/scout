/**
 * Workspace graph shape. Built once per scan at scan-start, threaded into the
 * resolver (for workspace-locality classification) and the seeds (for a
 * repository declaration's `owningPackage`).
 *
 * Two independent axes:
 *   - `packageManager`: yarn / npm / pnpm, sniffed from the lockfile. Always
 *     set; "unknown" when there is no lockfile.
 *   - `packages`: workspace packages from pnpm-workspace.yaml or
 *     package.json#workspaces. Empty array for single-package repos.
 */

export type PackageManager = "yarn" | "npm" | "pnpm" | "unknown";

export type WorkspacePackage = {
  /** Workspace package name from its `package.json#name`. */
  name: string;
  /** Absolute path to the package directory. */
  absolutePath: string;
  /** Parsed `package.json` contents. Cached for `createDeclaredDependencyTest`. */
  packageJson: {
    name?: string;
    main?: string;
    module?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    workspaces?: string[] | { packages?: string[] };
    exports?: unknown;
  };
};

export type WorkspaceGraph = {
  /**
   * Detected package manager (lockfile-based); `"unknown"` when there is no
   * lockfile. Set for single-package repos too.
   */
  packageManager: PackageManager;
  /** Absolute path to the discovered workspace root. */
  rootPath: string;
  /** The root `package.json` name, else the repository name passed to `buildWorkspaceGraph`. */
  rootPackageName: string;
  /**
   * Detected workspace packages from pnpm-workspace.yaml or
   * package.json#workspaces. Empty array for single-package repos.
   */
  packages: WorkspacePackage[];
};
