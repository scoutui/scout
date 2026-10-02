"use client";
import { useCallback, useState } from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";

export type SortDir = "asc" | "desc";

/**
 * Shared sort state for a table. A newly picked numeric column sorts `desc`
 * (biggest counts on top), a text column `asc` (A to Z). Clicking the active
 * column again flips direction.
 */
export function useSort<K extends string>(
  initialKey: K,
  initialDir: SortDir,
  numericKeys?: ReadonlySet<K>,
) {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const toggleSort = useCallback(
    (key: K) => {
      if (key === sortKey) {
        setSortDir(d => (d === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDir(numericKeys?.has(key) ? "desc" : "asc");
    },
    [sortKey, numericKeys],
  );

  return { sortKey, sortDir, toggleSort };
}

/**
 * Stable sort by an accessor. Strings compare with `localeCompare`, numbers
 * subtract; `null`/`undefined` always sort last regardless of direction (an
 * absent version or count is "no value", not "lowest value").
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  key: K,
  dir: SortDir,
  accessor: (row: T, key: K) => string | number | null | undefined,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a, key);
    const bv = accessor(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * sign;
    }
    return ((av as number) - (bv as number)) * sign;
  });
}

/**
 * `aria-sort` belongs on the column header cell, not the button inside it:
 * put this on the `<TableHead>` that wraps a `SortButton`.
 */
export function ariaSort<K extends string>(
  key: K,
  current: K,
  dir: SortDir,
): "ascending" | "descending" | "none" {
  if (key !== current) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

/**
 * A sortable column header. Inactive columns show a faint sort glyph; the
 * active column shows a direction chevron.
 */
export function SortButton<K extends string>({
  label,
  sortKey,
  current,
  dir,
  onClick,
  align,
  title,
}: {
  label: string;
  sortKey: K;
  current: K;
  dir: SortDir;
  onClick: (key: K) => void;
  align?: "right";
  /** Full wording for a header whose short label doesn't say what it sorts.
   *  Used as both the hover title and the accessible name, so a screen reader
   *  doesn't announce it twice. */
  title?: string | undefined;
}) {
  const active = current === sortKey;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={() => onClick(sortKey)}
      className={`flex w-full items-center gap-1 ${
        align === "right" ? "justify-end" : "justify-start"
      } ${active ? "text-foreground" : ""}`}
    >
      {/* The label truncates and the glyph never does: without shrink-0 a
          full-width label squeezes the sort indicator out. */}
      <span className="min-w-0 truncate">{label}</span>
      {active ? (
        dir === "asc" ? (
          <ChevronUp className="size-3 shrink-0" />
        ) : (
          <ChevronDown className="size-3 shrink-0" />
        )
      ) : (
        <ChevronsUpDown className="size-3 shrink-0 opacity-30" aria-hidden />
      )}
    </button>
  );
}
