"use client";
import { type ReactNode, type RefObject, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronRight, Folder, Package, Search, X } from "lucide-react";
import type { CohortSelector } from "@scoutui/web-shared";
import { cohortKey } from "@scoutui/web-shared/client";
import { PackageName } from "@/components/package-name";
import { shortenPath } from "@/components/repos/components-table";
import { CohortSwatch } from "@/components/dashboards/cohort-swatch";
import type { LegendSeries } from "@/components/dashboards/series-legend";
import type { LibraryTag, PickableComponent } from "@/lib/chart-builder-series";
import { paletteToken } from "@/lib/chart-palette";
import { FIRST_COMPONENTS, type SearchRow, type SeriesGroup, type SeriesSearchResult } from "@/lib/identity-search";
import { cn } from "@/lib/utils";

type Row = SearchRow<CohortSelector>;
type ComponentRow = Extract<Row, { kind: "component" }>;

const isComponent = (row: Row): row is ComponentRow => row.kind === "component";

const count = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;

/** The name with each matched range in bold. */
function marked(name: string, ranges: Array<[number, number]>): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    parts.push(name.slice(at, start), <b key={start} className="font-semibold">{name.slice(start, end)}</b>);
    at = end;
  }
  parts.push(name.slice(at));
  return parts;
}

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

const rowHover = "transition-colors hover:bg-muted/60 has-checked:bg-muted/40";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pb-1.5 not-first:border-t">
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="px-2.5 pt-2.5 pb-1 text-label text-muted-foreground">{title}</legend>
        {children}
      </fieldset>
    </div>
  );
}

const packageIcon = <Package className="size-3.5 text-muted-foreground" strokeWidth={1.75} />;

// A component under its open package starts where the package row's icon does.
const UNDER_PACKAGE = "ps-8.5";

/**
 * The chart builder's series column: a search box over a checklist of Tags, Your code (Local components) and Packages.
 * Checking a row adds its series and unchecking removes it. A package row's component count opens the package in
 * place: its FIRST_COMPONENTS most used components under it, then Show all for the rest; pressing the count again closes
 * it. Typing lists the tags and Local components it matches, then each package `search` groups the matching
 * components under, open, then any matching components no package holds. A new search opens every package again.
 * While `search` is null, `notice` stands in for the search and the checklist.
 */
export function SeriesPicker({
  inputId,
  inputRef,
  describedBy,
  search,
  notice,
  series,
  components,
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
  components: PickableComponent[];
  libraryTags: LibraryTag[];
  onToggle: (sel: CohortSelector) => void;
}) {
  const [query, setQuery] = useState("");
  // Packages opened or closed by hand, and those listing all of their components. Each search starts both again.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [all, setAll] = useState<ReadonlySet<string>>(new Set());
  const browsing = query !== "";
  const result = useMemo(() => (search ? search(query, null) : null), [search, query]);
  // Each package whose components are listed in full: those opened with nothing typed, and those Show all opened.
  const listings = useMemo(() => {
    const names = browsing ? [...all] : [...toggled].flatMap(([name, open]) => (open ? [name] : []));
    return new Map(names.map((name) => [name, search ? search("", name).rows.filter(isComponent) : []]));
  }, [search, browsing, toggled, all]);
  const packageId = `${useId()}-package-`;
  const colors = useMemo(() => new Map(series.map((s) => [cohortKey(s.selector), s.color])), [series]);
  const roles = useMemo(() => new Map(series.map((s) => [cohortKey(s.selector), s.role])), [series]);
  const byId = useMemo(() => new Map(components.map((c) => [c.componentId, c])), [components]);
  const tagColors = useMemo(() => new Map(libraryTags.map((t) => [t.id, paletteToken(t.color) ?? ""])), [libraryTags]);
  const isAdded = (sel: CohortSelector) => colors.has(cohortKey(sel));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const held = useRef<{ input: HTMLInputElement; top: number } | null>(null);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts at the top of its results
  useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [query]);

  const rows = result?.rows ?? [];
  const tags = rows.filter((r): r is Extract<Row, { kind: "tag" }> => r.kind === "tag");
  const local = rows.filter((r): r is Extract<Row, { kind: "local" }> => r.kind === "local");
  // With nothing typed, each package lists its most used components once opened.
  const groups: SeriesGroup[] = browsing
    ? (result?.groups ?? [])
    : rows.flatMap((r) => {
        if (r.kind !== "package") return [];
        const listed = listings.get(r.packageName) ?? [];
        return [{ packageName: r.packageName, components: r.components, matched: null, rows: listed.slice(0, FIRST_COMPONENTS), more: listed.length > FIRST_COMPONENTS }];
      });
  const unpackaged = result?.unpackaged ?? [];
  const empty = rows.length === 0 && groups.length === 0 && unpackaged.length === 0;
  const message = empty ? (browsing ? "No matches" : "Nothing scanned yet") : result?.total != null ? "Keep typing to see more" : null;

  function changeQuery(next: string) {
    setQuery(next);
    setToggled(new Map());
    setAll(new Set());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
    } else if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      changeQuery("");
    }
  }

  /** Lists every component of an open package after those it lists, and moves focus to the first one it adds. */
  function showAll(group: SeriesGroup, list: HTMLElement | null) {
    flushSync(() => setAll(new Set(all).add(group.packageName)));
    list?.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[group.rows.length]?.focus();
  }

  const packageRow = (group: SeriesGroup) => {
    const name = group.packageName;
    const sel: CohortSelector = { kind: "package", packageName: name };
    const id = `${packageId}${encodeURIComponent(name)}`;
    const open = toggled.get(name) ?? browsing;
    const listed = all.has(name) ? [...group.rows, ...(listings.get(name) ?? []).filter((r) => !group.rows.some((g) => g.componentId === r.componentId))] : group.rows;
    const components = count(group.components, "component");
    const local = group.rows.map((r) => (r.componentId === undefined ? undefined : byId.get(r.componentId))).find((c) => c?.local);
    return (
      <div key={`package:${name}`}>
        <div className={cn("flex min-w-0 items-center pe-1", rowHover)}>
          <CheckRow checked={isAdded(sel)} onToggle={(input) => toggle(input, sel)} icon={packageIcon} className="font-mono">
            <span title={name} className="grid min-w-0 flex-1 gap-px">
              <PackageName name={name} />
              {local ? <span className="truncate font-sans text-muted-foreground">{local.repoId ? `Local · ${local.repoId}` : "Local"}</span> : null}
            </span>
          </CheckRow>
          {group.components > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              aria-label={group.matched === null ? `Show the ${components} in ${name}` : `Show ${group.matched.toLocaleString()} of ${components} in ${name}`}
              onClick={() => setToggled(new Map(toggled).set(name, !open))}
              className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md ps-1.5 pe-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent"
            >
              {group.matched === null ? components : `${group.matched.toLocaleString()} of ${group.components.toLocaleString()}`}
              <ChevronRight aria-hidden className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
            </button>
          ) : null}
        </div>
        {group.components > 0 ? (
          <div id={id}>
            {open ? (
              <>
                {listed.map((r) => componentRow(r, true))}
                {group.more && !all.has(name) ? (
                  <button
                    type="button"
                    aria-label={`Show all ${components} in ${name}`}
                    onClick={() => showAll(group, document.getElementById(id))}
                    className={cn("flex min-h-8 w-full items-center px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground", UNDER_PACKAGE)}
                  >
                    Show all {group.components.toLocaleString()}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  /** A component's row, under its open package with `underPackage`, where only screen readers hear the package's name. */
  const componentRow = (row: ComponentRow, underPackage = false) => {
    const added = isAdded(row.pick);
    const picked = row.componentId === undefined ? undefined : byId.get(row.componentId);
    const path = row.disambiguator ? (
      <span title={row.disambiguator} className="text-muted-foreground"> {shortenPath(row.disambiguator)}</span>
    ) : null;
    return (
      <div key={`component:${row.componentId ?? `${row.packageName}:${row.exportName}`}`} className={cn("flex min-w-0", rowHover)}>
        <CheckRow
          checked={added}
          onToggle={(input) => toggle(input, row.pick)}
          icon={added ? <CohortSwatch cohortKey={cohortKey(row.pick)} color={colors.get(cohortKey(row.pick)) ?? ""} role={roles.get(cohortKey(row.pick))} /> : null}
          className={cn("font-mono", underPackage && UNDER_PACKAGE)}
        >
          {picked?.local && !underPackage ? (
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate">{marked(row.exportName, row.matched)}{path}</span>
              <span className="truncate font-sans text-muted-foreground">{picked.repoId ? `Local · ${picked.repoId}` : "Local"}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate">
              {marked(row.exportName, row.matched)}
              {picked?.local ? (
                <span className="sr-only"> {picked.repoId ? `Local · ${picked.repoId}` : "Local"}</span>
              ) : row.packageName !== null ? (
                <span className={underPackage ? "sr-only" : "text-muted-foreground"}> {row.packageName}</span>
              ) : null}
              {path}
            </span>
          )}
        </CheckRow>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {search ? (
        <div className="flex flex-none flex-col gap-2">
          <search className="focus-field flex h-9 min-w-0 items-center gap-2 rounded-lg border border-control ps-2.5 pe-1 dark:bg-input/30">
            <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <label htmlFor={inputId} className="sr-only">
              Add a series
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Add a series"
              aria-describedby={describedBy}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-base placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground sm:text-xs [&::-webkit-search-cancel-button]:hidden"
            />
            {query !== "" ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  changeQuery("");
                  inputRef.current?.focus();
                }}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </search>
          <output className="sr-only">{browsing ? message : null}</output>
        </div>
      ) : null}

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        {!search ? (
          notice
        ) : !empty ? (
          <div className="overflow-clip rounded-lg border">
            {tags.length > 0 ? (
              <Section title="Tags">
                {tags.map((row) => (
                  <div key={`tag:${row.tagId}`} className={cn("flex min-w-0", rowHover)}>
                    <CheckRow
                      checked={isAdded(row.pick)}
                      onToggle={(input) => toggle(input, row.pick)}
                      icon={<CohortSwatch cohortKey={cohortKey(row.pick)} color={colors.get(cohortKey(row.pick)) ?? tagColors.get(row.tagId) ?? ""} role={roles.get(cohortKey(row.pick))} />}
                    >
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
            {groups.length > 0 ? <Section title="Packages">{groups.map(packageRow)}</Section> : null}
            {unpackaged.length > 0 ? <Section title="No package">{unpackaged.map((row) => componentRow(row))}</Section> : null}
            {message ? (
              <p aria-hidden className="border-t px-2.5 py-2 text-xs text-muted-foreground">
                {message}
              </p>
            ) : null}
          </div>
        ) : (
          <p aria-hidden className="px-1 py-2 text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
