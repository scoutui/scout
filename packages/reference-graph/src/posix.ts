/** Normalises backslashes to forward slashes for cross-platform path output. */
export function posixPath(p: string): string {
  return p.replaceAll("\\", "/");
}
