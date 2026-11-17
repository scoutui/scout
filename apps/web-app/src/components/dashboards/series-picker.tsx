"use client";
import { type ReactNode, type RefObject, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Folder } from "lucide-react";
import type { CohortSelector } from "@scoutui/web-shared";
import { cohortKey } from "@scoutui/web-shared/client";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";
import type { LegendSeries } from "@/components/dashboards/series-legend";
import { count, GroupedSearch, marked, rowHover, Section } from "@/components/grouped-search";
import type { LibraryTag } from "@/lib/chart-builder-series";
import { paletteToken } from "@/lib/chart-palette";
import type { GroupedResult, SearchRow, SeriesSearchResult } from "@/lib/identity-search";
import { cn } from "@/lib/utils";

type Row = SearchRow<CohortSelector>;
type BeforePackages = Extract<Row, { kind: "tag" | "local" }>;

/** A checkable row: the checkbox, an icon slot and the row's text. */
function CheckRow({ checked, onToggle, icon, children, className }: { checked: boolean; onToggle: (input: HTMLInputElement) => void; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-xs", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        className="size-3.5 shrink-0 accent-foreground"
      />
      <span aria-hidden className="flex w-3.5 shrink-0 justify-center">{icon}</span>
      {children}
    </label>
  );
}

/**
 * The chart builder's series column: a search box over a checklist of Tags, Your code (Local components) and Packages,
 * as `GroupedSearch` lists them. Checking a row adds its series and unchecking removes it. Typing lists the tags and
 * Local components it matches before the packages. While `search` is null, `notice` stands in for the search and the
 * checklist.
 */
export function SeriesPicker({
  inputId,
  inputRef,
  describedBy,
  search,
  notice,
  series,
  libraryTags,
  onToggle,
}: {
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Ids of messages about the series, such as an error, read with the search box. */
  describedBy?: string | undefined;
  /** The search's rows and groups, or with a package, that package's components, the most used first. */
  search: ((query: string, packageName: string | null) => SeriesSearchResult) | null;
  notice?: ReactNode;
  series: LegendSeries[];
  libraryTags: LibraryTag[];
  onToggle: (sel: CohortSelector) => void;
}) {
  const colors = useMemo(() => new Map(series.map((s) => [cohortKey(s.selector), s.color])), [series]);
  const roles = useMemo(() => new Map(series.map((s) => [cohortKey(s.selector), s.role])), [series]);
  const tagColors = useMemo(() => new Map(libraryTags.map((t) => [t.id, paletteToken(t.color) ?? ""])), [libraryTags]);
  const isAdded = (sel: CohortSelector) => colors.has(cohortKey(sel));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const held = useRef<{ input: HTMLInputElement; top: number } | null>(null);

  // With nothing typed, the packages come as rows; the list takes them as closed groups.
  const grouped = useCallback(
    (query: string, packageName: string | null): GroupedResult<CohortSelector, BeforePackages> => {
      const result = search ? search(query, packageName) : { rows: [], groups: [], unpackaged: [], total: null };
      if (packageName !== null) return { ...result, rows: result.rows.flatMap((r) => (r.kind === "component" ? [r] : [])) };
      const closed = result.rows.flatMap((r) =>
        r.kind === "package" ? [{ packageName: r.packageName, components: r.components, matched: null, rows: [], more: false, refusal: null }] : [],
      );
      return {
        ...result,
        groups: query === "" ? closed : result.groups,
        rows: result.rows.flatMap((r) => (r.kind === "tag" || r.kind === "local" ? [r] : [])),
      };
    },
    [search],
  );

  /** Adds or removes a row's series, keeping the row where it was on screen when anything above it moves. */
  function toggle(input: HTMLInputElement, sel: CohortSelector) {
    held.current = { input, top: input.getBoundingClientRect().top };
    onToggle(sel);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the series a toggle changed are drawn
  useLayoutEffect(() => {
    const h = held.current;
    held.current = null;
    const scroller = scrollerRef.current;
    if (h && scroller && h.input.isConnected) scroller.scrollTop += h.input.getBoundingClientRect().top - h.top;
  }, [series]);

  if (!search) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">{notice}</div>
      </div>
    );
  }

  const swatch = (sel: CohortSelector, fallback = "") => (
    <CohortSwatch cohortKey={cohortKey(sel)} color={colors.get(cohortKey(sel)) ?? fallback} role={roles.get(cohortKey(sel))} />
  );

  return (
    <GroupedSearch
      inputId={inputId}
      inputRef={inputRef}
      label="Add a series"
      placeholder="Add a series"
      describedBy={describedBy}
      search={grouped}
      emptyText="Nothing scanned yet"
      className="flex-1"
      listClassName="flex-1"
      scrollerRef={scrollerRef}
      sections={(rows) => {
        const tags = rows.filter((r) => r.kind === "tag");
        const local = rows.filter((r) => r.kind === "local");
        return (
          <>
            {tags.length > 0 ? (
              <Section title="Tags">
                {tags.map((row) => (
                  <div key={`tag:${row.tagId}`} className={cn("flex min-w-0", rowHover)}>
                    <CheckRow checked={isAdded(row.pick)} onToggle={(input) => toggle(input, row.pick)} icon={swatch(row.pick, tagColors.get(row.tagId))}>
                      <span className="min-w-0 flex-1 truncate font-medium">{marked(row.label, row.matched)}</span>
                      <span className="shrink-0 text-muted-foreground">{count(row.packages, "package")}</span>
                    </CheckRow>
                  </div>
                ))}
              </Section>
            ) : null}
            {local.length > 0 ? (
              <Section title="Your code">
                {local.map((row) => (
                  <div key="local" className={cn("flex min-w-0", rowHover)}>
                    <CheckRow
                      checked={isAdded(row.pick)}
                      onToggle={(input) => toggle(input, row.pick)}
                      icon={<Folder className="size-3.5 text-muted-foreground" strokeWidth={1.75} />}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{marked(row.label, row.matched)}</span>
                    </CheckRow>
                  </div>
                ))}
              </Section>
            ) : null}
          </>
        );
      }}
      renderPackage={(group, slot) => {
        const sel: CohortSelector = { kind: "package", packageName: group.packageName };
        return (
          <CheckRow checked={isAdded(sel)} onToggle={(input) => toggle(input, sel)} icon={slot.icon} className={slot.className}>
            {slot.children}
          </CheckRow>
        );
      }}
      renderComponent={(row, slot) => {
        const added = isAdded(row.pick);
        return (
          <CheckRow checked={added} onToggle={(input) => toggle(input, row.pick)} icon={added ? swatch(row.pick) : null} className={slot.className}>
            {slot.children}
          </CheckRow>
        );
      }}
    />
  );
}
