"use client";
import { useMemo } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { PackageComponentRow } from "@scoutui/web-shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { SortButton, sortRows, useSort } from "@/components/ui/sortable";
import { DeprecatedFilterChip } from "@/components/deprecated-filter-chip";
import { DeprecatedMark } from "@/components/deprecated-mark";
import { useQuerySyncedState } from "@/lib/use-query-synced-state";
import { joinTerms, nameTerm, readTerms } from "@/lib/query-terms";

type SortKey = "displayName" | "consumerCount" | "totalOccurrences";
const DESC_KEYS: ReadonlySet<SortKey> = new Set(["consumerCount", "totalOccurrences"]);

/** Name search and deprecated-only, serialised to `?q=` in the shared grammar
 *  so a filtered view stays shareable. */
export type Filters = { text: string; deprecated: boolean };

export function queryToFilters(q: string): Filters {
  const f: Filters = { text: "", deprecated: false };
  for (const { field, value } of readTerms(q, ["name", "deprecated"])) {
    if (field === "name") f.text = value;
    if (field === "deprecated") f.deprecated = value === "true";
  }
  return f;
}

export function filtersToQuery(f: Filters): string {
  return joinTerms([nameTerm(f.text), f.deprecated ? "deprecated:true" : ""]);
}

export function PackageComponentsTable({
  components,
}: {
  components: PackageComponentRow[];
}) {
  const [filters, setFilters] = useQuerySyncedState<Filters>(queryToFilters, filtersToQuery);
  // Default: most-used first (matches the projection's own ordering).
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("totalOccurrences", "desc", DESC_KEYS);

  const deprecatedCount = useMemo(() => components.filter(c => c.deprecated).length, [components]);

  const visible = useMemo(() => {
    const text = filters.text.trim().toLowerCase();
    const filtered = components.filter(c => {
      if (text && !c.displayName.toLowerCase().includes(text)) return false;
      if (filters.deprecated && !c.deprecated) return false;
      return true;
    });
    return sortRows(filtered, sortKey, sortDir, (r, k) => r[k]);
  }, [components, filters, sortKey, sortDir]);

  if (components.length === 0) {
    return <p className="text-sm text-muted-foreground">No components observed for this package.</p>;
  }

  const filtering = filters.text.trim() !== "" || filters.deprecated;

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search components by name"
            value={filters.text}
            onChange={(e) => setFilters({ ...filters, text: e.target.value })}
            placeholder={`Search ${components.length.toLocaleString()} components by name…`}
            className="h-8 pl-8 font-mono text-xs placeholder:font-sans"
          />
          {filters.text ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setFilters({ ...filters, text: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <DeprecatedFilterChip
          count={deprecatedCount}
          active={filters.deprecated}
          onToggle={() => setFilters({ ...filters, deprecated: !filters.deprecated })}
        />
        <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
          {filtering ? (
            <>
              <span className="font-medium text-foreground">{visible.length.toLocaleString()}</span> of {components.length.toLocaleString()}
            </>
          ) : (
            <>{components.length.toLocaleString()} total</>
          )}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">No components match these filters.</p>
          <button
            type="button"
            onClick={() => setFilters({ text: "", deprecated: false })}
            className="inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <Table containerClassName="max-h-[70vh] overflow-y-auto">
          <TableHeader className="sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-full">
                <SortButton label="Component" sortKey="displayName" current={sortKey} dir={sortDir} onClick={toggleSort} />
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">
                <SortButton label="Consumers" sortKey="consumerCount" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              </TableHead>
              <TableHead className="whitespace-nowrap text-right pr-3">
                <SortButton label="Occurrences" sortKey="totalOccurrences" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(c => (
              <PackageComponentTableRow key={c.componentId} component={c} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function PackageComponentTableRow({ component: c }: { component: PackageComponentRow }) {
  return (
    <TableRow>
      <TableCell className="w-full max-w-0 p-0">
        {/* Always the component's own page, whatever the consumer count. */}
        <Link
          href={`/components/${encodeURIComponent(c.componentId)}`}
          title={c.deprecated ? `${c.displayName} (deprecated)` : c.displayName}
          className="flex min-w-0 items-center gap-2 px-3 py-2 font-mono font-medium hover:underline"
        >
          <span className="truncate">{c.displayName}</span>
          {c.deprecated ? <DeprecatedMark /> : null}
        </Link>
      </TableCell>
      <TableCell className="text-right tabular-nums">{c.consumerCount.toLocaleString()}</TableCell>
      <TableCell className="pr-3 text-right tabular-nums">{c.totalOccurrences.toLocaleString()}</TableCell>
    </TableRow>
  );
}
