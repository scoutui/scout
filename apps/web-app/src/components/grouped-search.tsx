"use client";
import { type ReactNode, type RefObject, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronRight, Package, Search, X } from "lucide-react";
import { PackageName } from "@/components/package-name";
import { shortenPath } from "@/components/repos/components-table";
import { type ComponentRow, FIRST_COMPONENTS, type GroupedResult, type SearchGroup } from "@/lib/identity-search";
import { cn } from "@/lib/utils";

export const count = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;

/** The name with each matched range in bold. */
export function marked(name: string, ranges: Array<[number, number]>): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    parts.push(name.slice(at, start), <b key={start} className="font-semibold">{name.slice(start, end)}</b>);
    at = end;
  }
  parts.push(name.slice(at));
  return parts;
}

export const rowHover = "transition-colors hover:bg-muted/60 has-checked:bg-muted/40";

export function Section({ title, children }: { title: string; children: ReactNode }) {
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

const localLabel = (row: { repoId?: string | undefined }) => (row.repoId ? `Local · ${row.repoId}` : "Local");

const rowKey = <T,>(row: ComponentRow<T>) => row.componentId ?? `${row.packageName}:${row.exportName}`;

const isComponent = <T, R>(row: ComponentRow<T> | R): row is ComponentRow<T> => (row as { kind: string }).kind === "component";

/** What a caller's control for a row holds: the icon slot, the classes that place it, and the row's text. */
export type RowSlot = { icon?: ReactNode; className: string; children: ReactNode };

/**
 * A search box over a list of packages, each with its components under it. A package row's component count opens the
 * package in place: its FIRST_COMPONENTS most used components under it, then Show all for the rest; pressing the count
 * again closes it. Typing lists each package `search` groups the matching components under, open, then any matching
 * components no package holds. A new search opens every package again. Enter in the box does nothing; Escape clears
 * it. The caller draws each row's control, such as a checkbox or a button, around the text the list gives it.
 */
export function GroupedSearch<T, R extends { kind: string } = never>({
  inputId,
  inputRef,
  label,
  placeholder,
  describedBy,
  invalid,
  search,
  emptyText,
  sections,
  renderPackage,
  renderComponent,
  className,
  listClassName,
  scrollerRef,
}: {
  inputId: string;
  inputRef?: RefObject<HTMLInputElement | null> | undefined;
  /** Names the search box for screen readers alone; leave it out when a visible label names it. */
  label?: string | undefined;
  placeholder: string;
  /** Ids of messages about the field, such as an error, read with the search box. */
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  /** The search's groups and rows, or with a package, that package's components, the most used first. */
  search: (query: string, packageName: string | null) => GroupedResult<T, R>;
  /** What the list says when there is nothing to list before anything is typed. */
  emptyText: string;
  /** Draws the rows a search lists before the packages. */
  sections?: ((rows: R[]) => ReactNode) | undefined;
  renderPackage: (group: SearchGroup<T>, slot: RowSlot) => ReactNode;
  renderComponent: (row: ComponentRow<T>, slot: RowSlot) => ReactNode;
  className?: string | undefined;
  /** Classes for the area the list scrolls in. */
  listClassName?: string | undefined;
  scrollerRef?: RefObject<HTMLDivElement | null> | undefined;
}) {
  const [query, setQuery] = useState("");
  // Packages opened or closed by hand, and those listing all of their components. Each search starts both again.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [all, setAll] = useState<ReadonlySet<string>>(new Set());
  const browsing = query !== "";
  const result = useMemo(() => search(query, null), [search, query]);
  // Each package whose components are listed in full: those opened with nothing typed, and those Show all opened.
  const listings = useMemo(() => {
    const names = browsing ? [...all] : [...toggled].flatMap(([name, open]) => (open ? [name] : []));
    return new Map(names.map((name) => [name, search("", name).rows.filter(isComponent<T, R>)]));
  }, [search, browsing, toggled, all]);
  const packageId = `${useId()}-package-`;
  const ownInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownInput;
  const ownScroller = useRef<HTMLDivElement>(null);
  const scroller = scrollerRef ?? ownScroller;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts at the top of its results
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [query]);

  const rows = result.rows.filter((r): r is R => !isComponent(r));
  // With nothing typed, each package lists its most used components once opened.
  const groups: SearchGroup<T>[] = browsing
    ? result.groups
    : result.groups.map((g) => {
        const listed = listings.get(g.packageName) ?? [];
        return { ...g, rows: listed.slice(0, FIRST_COMPONENTS), more: listed.length > FIRST_COMPONENTS };
      });
  const unpackaged = result.unpackaged;
  const empty = rows.length === 0 && groups.length === 0 && unpackaged.length === 0;
  const message = empty ? (browsing ? "No matches" : emptyText) : result.total != null ? "Keep typing to see more" : null;

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
  function showAll(group: SearchGroup<T>, list: HTMLElement | null) {
    flushSync(() => setAll(new Set(all).add(group.packageName)));
    list?.children[group.rows.length]?.querySelector<HTMLElement>("input, button")?.focus();
  }

  const packageRow = (group: SearchGroup<T>) => {
    const name = group.packageName;
    const id = `${packageId}${encodeURIComponent(name)}`;
    const open = toggled.get(name) ?? browsing;
    const listed = all.has(name) ? [...group.rows, ...(listings.get(name) ?? []).filter((r) => !group.rows.some((g) => rowKey(g) === rowKey(r)))] : group.rows;
    const components = count(group.components, "component");
    const local = group.rows.find((r) => r.local);
    return (
      <div key={`package:${name}`}>
        <div className={cn("flex min-w-0 items-center pe-1", rowHover)}>
          {renderPackage(group, {
            icon: packageIcon,
            className: "font-mono",
            children: (
              <span title={name} className="grid min-w-0 flex-1 gap-px">
                <PackageName name={name} />
                {local ? <span className="truncate font-sans text-muted-foreground">{localLabel(local)}</span> : null}
              </span>
            ),
          })}
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
  const componentRow = (row: ComponentRow<T>, underPackage = false) => {
    const path = row.disambiguator ? (
      <span title={row.disambiguator} className="text-muted-foreground"> {shortenPath(row.disambiguator)}</span>
    ) : null;
    return (
      <div key={`component:${rowKey(row)}`} className={cn("flex min-w-0", rowHover)}>
        {renderComponent(row, {
          className: cn("font-mono", underPackage && UNDER_PACKAGE),
          children:
            row.local && !underPackage ? (
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate">{marked(row.exportName, row.matched)}{path}</span>
                <span className="truncate font-sans text-muted-foreground">{localLabel(row)}</span>
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate">
                {marked(row.exportName, row.matched)}
                {row.local ? (
                  <span className="sr-only"> {localLabel(row)}</span>
                ) : row.packageName !== null ? (
                  <span className={underPackage ? "sr-only" : "text-muted-foreground"}> {row.packageName}</span>
                ) : null}
                {path}
              </span>
            ),
        })}
      </div>
    );
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-none flex-col gap-2">
        <search
          className={cn(
            "focus-field flex h-9 min-w-0 items-center gap-2 rounded-lg border ps-2.5 pe-1 dark:bg-input/30",
            invalid ? "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40" : "border-control",
          )}
        >
          <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          {label ? (
            <label htmlFor={inputId} className="sr-only">
              {label}
            </label>
          ) : null}
          <input
            ref={input}
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
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
                input.current?.focus();
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </search>
        <output className="sr-only">{browsing ? message : null}</output>
      </div>

      <div ref={scroller} className={cn("min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]", listClassName)}>
        {!empty ? (
          <div className="overflow-clip rounded-lg border">
            {rows.length > 0 ? sections?.(rows) : null}
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
