import type { Tag, TagRef } from "./dto.js";

const globCache = new Map<string, RegExp>();

function globToRegExp(glob: string): RegExp {
  const hit = globCache.get(glob);
  if (hit) return hit;
  // Escape regex metacharacters, then turn `*` into `.*`.
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  globCache.set(glob, re);
  return re;
}

export function tagMatchesPackage(tag: Tag, packageName: string): boolean {
  if (tag.rule.exact.includes(packageName)) return true;
  return tag.rule.glob.some((g) => globToRegExp(g).test(packageName));
}

/** Resolve the tags that apply to a package name. `null` (local components) → []. */
export function resolveTags(packageName: string | null, tags: Tag[]): TagRef[] {
  if (!packageName) return [];
  const refs: TagRef[] = [];
  for (const t of tags) {
    if (tagMatchesPackage(t, packageName)) {
      refs.push({ id: t.id, value: t.value, category: t.category, color: t.color });
    }
  }
  return refs;
}

/** Decorate already-projected rows with their resolved tags (read-time, cache-safe). */
export function attachTags<T extends { packageName: string | null }>(
  rows: T[],
  tags: Tag[],
): Array<T & { tags: TagRef[] }> {
  return rows.map((r) => ({ ...r, tags: resolveTags(r.packageName, tags) }));
}

/** The library-category tags, sorted by value. */
export function libraryTags(tags: Tag[]): Tag[] {
  return tags
    .filter((t) => t.category === "library")
    .sort((a, b) => a.value.localeCompare(b.value));
}
