const SNAPSHOT_VERSION = /^0\.0\.0-/;
const NUMERIC_IDENTIFIER = /^\d+$/;

/** A version's numeric core parts and prerelease identifiers, without its build metadata. */
function versionParts(version: string): { core: number[]; prerelease: string[] } {
  const release = version.split("+", 1)[0] ?? "";
  const dash = release.indexOf("-");
  if (dash < 0) return { core: release.split(".").map(Number), prerelease: [] };
  return { core: release.slice(0, dash).split(".").map(Number), prerelease: release.slice(dash + 1).split(".") };
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = NUMERIC_IDENTIFIER.test(a);
  const bNumeric = NUMERIC_IDENTIFIER.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * SemVer 2.0.0 precedence of two CLI versions, negative when `a` is older. Build metadata (`+…`) is ignored and a missing core
 * part counts as 0. With equal cores, a release ranks above its prereleases, and prereleases compare identifier by identifier:
 * numeric ones as numbers and below alphanumeric ones, alphanumeric ones in ASCII order, and a shorter list below a longer one.
 */
export function compareCliVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.core.length, right.core.length); index++) {
    const order = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (order) return order;
  }
  if (!left.prerelease.length || !right.prerelease.length) return right.prerelease.length - left.prerelease.length;
  for (let index = 0; index < Math.min(left.prerelease.length, right.prerelease.length); index++) {
    const order = compareIdentifiers(left.prerelease[index] ?? "", right.prerelease[index] ?? "");
    if (order) return order;
  }
  return left.prerelease.length - right.prerelease.length;
}

/** Whether a CLI version is a snapshot build (`0.0.0-…`), published from a pull request rather than released. */
export function isSnapshotVersion(version: string): boolean {
  return SNAPSHOT_VERSION.test(version);
}
