/** Part of a run: `prepare` clones and installs a target, `scan` scans a prepared one. */
export type Step = "prepare" | "scan";

/** One scan of a single app directory inside a cloned target repo. */
export interface ScanSpec {
  /** App dir relative to the cloned repo root, e.g. "apps/web" or "nuxt-app". */
  cwd: string;
  /** Stable explicit id for this scan's artifact, e.g. "cal.diy/web". */
  repoId: string;
  /** Include globs for this app (React and Vue source patterns differ). */
  include: string[];
  /** Optional: tsconfig (relative to the app dir) to pull `paths` aliases from. */
  tsconfigPath?: string;
  /** Optional: inline alias map (relative to the app dir), layered ahead of Node resolution. */
  aliases?: Record<string, string[]>;
}

/** A cloned target repo and the app-dir scans run against it. */
export interface Target {
  /** Matrix key + display name, e.g. "pie-aperture". */
  name: string;
  /** GitHub "owner/repo", cloned read-only over https. */
  repo: string;
  /** Install command run at the cloned repo root (scriptless, frozen lockfile). */
  install: string;
  /** App-dir scans; each produces one artifact with its own repoId. */
  scans: ScanSpec[];
}
