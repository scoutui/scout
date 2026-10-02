import picomatch from "picomatch";

/**
 * Framework entry-point conventions, built in. Matched against
 * outputRoot-relative POSIX filePaths, so every pattern starts with `**`:
 * under an ancestor --repo-root the path is prefixed with the app directory.
 * Other frameworks' entry files (Nuxt pages/layouts/app.vue) classify as "none".
 */
const ROOT_PATTERNS = [
  "**/app/**/{page,layout,template,error,loading,not-found}.{tsx,jsx}",
  "**/pages/**/*.{tsx,jsx}",
];
const ROOT_EXCLUDE = ["**/pages/api/**"];

const matchers = ROOT_PATTERNS.map((p) => picomatch(p));
const excluders = ROOT_EXCLUDE.map((p) => picomatch(p));

export function isFrameworkRootPath(filePath: string): boolean {
  if (excluders.some((m) => m(filePath))) return false;
  return matchers.some((m) => m(filePath));
}
