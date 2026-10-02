"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { paletteToken } from "@/lib/chart-palette";
import { cn } from "@/lib/utils";

export type FacetValue = { value: string; label?: string; count: number; color?: string };

/** A facet whose picker is a list of values to tick. */
export type ListFacet = {
  key: string;
  label: string;
  /** Each value with its count under the other filters. */
  values: FacetValue[];
  selected: readonly string[];
  onSelect: (selected: string[]) => void;
  /** Ticking a value replaces the selection instead of adding to it. */
  single?: boolean;
  mono?: boolean;
  /** The list's search box placeholder; the box shows past eight values. */
  searchPlaceholder?: string;
  /** Shown when the facet has no values at all, as distinct from none left under the other filters. */
  empty?: React.ReactNode;
  /** One value narrows nothing, so the facet leaves the menu while the other
   *  filters leave it one value. A selection keeps it, so it can be unticked. */
  dropsWithOneValue?: boolean;
};

/** A facet with its own picker. */
export type CustomFacet = { key: string; label: string; picker: React.ReactNode; active: number };

export type Facet = ListFacet | CustomFacet;

export type FilterPill = {
  key: string;
  field: string;
  value: string;
  mono?: boolean;
  color?: string | undefined;
  onRemove: () => void;
};

const isList = (f: Facet): f is ListFacet => "values" in f;
const activeCount = (f: Facet): number => (isList(f) ? f.selected.length : f.active);

/**
 * The faceted filter bar the repo page and the Packages page share: name
 * search, the page's status chips, the Filter menu, the page's count line, and
 * a pill for every active filter. Each page supplies its facets and pills; the
 * search's own pill is added here.
 */
export function FacetedFilterBar({
  search,
  chips,
  facets,
  count,
  pills,
  onClearAll,
}: {
  search: { value: string; onChange: (text: string) => void; label: string; placeholder: string };
  chips: React.ReactNode;
  facets: Facet[];
  count: React.ReactNode;
  pills: FilterPill[];
  onClearAll: () => void;
}) {
  const allPills: FilterPill[] = search.value.trim()
    ? [{ key: "text", field: "name", value: search.value.trim(), mono: true, onRemove: () => search.onChange("") }, ...pills]
    : pills;

  return (
    <div className="flex flex-col gap-2 border-b px-3 py-2.5">
      {/* Wraps below sm: search, both status chips and Filter don't fit a
          390px line, so search takes its own line. From sm up the search is
          capped, so a change in the count's width goes to the count's
          `ml-auto` gap instead of sliding the chips sideways. The cap is
          max-w-xs below xl because at 1024 only ~328px is left beside the
          controls and the changed view's count. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 grow basis-full sm:basis-0 sm:max-w-xs xl:max-w-md">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          {/* pr-8 keeps the value clear of the absolutely-positioned clear
              button; without it a long term runs underneath the ×. */}
          <Input
            aria-label={search.label}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            className="h-8 pl-8 pr-8 font-mono text-xs placeholder:font-sans"
          />
          {search.value ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => search.onChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {chips}

        <FilterMenu facets={facets} />

        {/* Below sm the count takes its own line; from sm up it sits at the
            right edge, so its width only changes the free gap. */}
        <span className="shrink-0 basis-full text-xs text-muted-foreground tabular-nums sm:ml-auto sm:basis-auto">{count}</span>
      </div>

      {allPills.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {allPills.map((p) => (
            <Pill key={p.key} label={`Remove ${p.field} ${p.value}`} onRemove={p.onRemove}>
              {p.color ? <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: paletteToken(p.color) }} /> : null}
              <span className="text-muted-foreground">{p.field}</span>
              <span className={cn("font-medium", p.mono && "font-mono")}>{p.value}</span>
            </Pill>
          ))}
          <button
            type="button"
            onClick={onClearAll}
            className="ml-1 inline-flex h-6 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The Tag facet, the same on every page that filters by library tag. */
export function tagFacet(
  tags: { value: string; color: string; count: number }[],
  selected: readonly string[],
  onSelect: (selected: string[]) => void,
): ListFacet {
  return {
    key: "tag",
    label: "Tag",
    values: tags.map((t) => ({ value: t.value, count: t.count, color: t.color })),
    selected,
    onSelect,
    mono: true,
    searchPlaceholder: "Search tags…",
    empty: (
      <>
        No library tags yet.{" "}
        <Link href="/governance#tags" className="text-foreground underline-offset-4 hover:underline">
          Add one in Governance
        </Link>
      </>
    ),
  };
}

/** A pill for each selected tag, with the tag's colour. */
export function tagPills(
  tags: { value: string; color: string }[],
  selected: readonly string[],
  onSelect: (selected: string[]) => void,
): FilterPill[] {
  return selected.map((t) => ({
    key: `tag:${t}`,
    field: "tag",
    value: t,
    mono: true,
    color: tags.find((o) => o.value === t)?.color,
    onRemove: () => onSelect(selected.filter((x) => x !== t)),
  }));
}

// --- Filter popover menu ------------------------------------------------------

function FilterMenu({ facets }: { facets: Facet[] }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const menu = facets.filter(
    (f) => !isList(f) || !f.dropsWithOneValue || f.values.filter((v) => v.count > 0).length > 1 || f.selected.length > 0,
  );
  // Counts only the facets in the menu, so the badge never claims a filter the
  // menu doesn't show.
  const count = menu.reduce((n, f) => n + activeCount(f), 0);
  const current = facets.find((f) => f.key === view);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setView(null);
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5 font-normal">
            <ListFilter aria-hidden />
            Filter
            {count > 0 ? (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold tabular-nums text-foreground">
                {count.toLocaleString()}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-64 gap-0 p-0">
        {current === undefined ? (
          <ul className="flex flex-col py-1">
            {menu.map((f) => {
              const n = activeCount(f);
              return (
                <li key={f.key}>
                  <button
                    type="button"
                    onClick={() => setView(f.key)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span>{f.label}</span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      {n > 0 ? <span className="text-xs tabular-nums text-foreground">{n}</span> : null}
                      <ChevronRight className="size-3.5" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
              <button
                type="button"
                onClick={() => setView(null)}
                aria-label="Back to filters"
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-label text-muted-foreground">{current.label}</span>
            </div>
            {isList(current) ? <ValueList facet={current} /> : current.picker}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Counts follow the other filters, so a value they leave at zero is hidden,
 * unless it is selected: that one stays, at 0, so it can be unticked.
 */
function ValueList({ facet }: { facet: ListFacet }) {
  const [q, setQ] = useState("");
  const { values, selected } = facet;
  const needle = q.trim().toLowerCase();
  const offered = values.filter((v) => v.count > 0 || selected.includes(v.value));
  const shown = needle ? offered.filter((v) => (v.label ?? v.value).toLowerCase().includes(needle)) : offered;
  const toggle = (value: string) =>
    facet.onSelect(
      selected.includes(value)
        ? selected.filter((x) => x !== value)
        : facet.single
          ? [value]
          : [...selected, value],
    );
  return (
    <div className="flex flex-col">
      {offered.length > 8 ? (
        <div className="border-b p-1.5">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={facet.searchPlaceholder} className="h-7 text-xs" />
        </div>
      ) : null}
      <ul className="flex max-h-64 flex-col overflow-y-auto py-1">
        {values.length === 0 && facet.empty !== undefined ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">{facet.empty}</li>
        ) : offered.length === 0 ? (
          <NoneLeft />
        ) : shown.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">No matches.</li>
        ) : (
          shown.map((v) => (
            <CheckRow
              key={v.value}
              checked={selected.includes(v.value)}
              count={v.count}
              onToggle={() => toggle(v.value)}
              mono={facet.mono}
              dot={v.color}
            >
              {v.label ?? v.value}
            </CheckRow>
          ))
        )}
      </ul>
    </div>
  );
}

/** A facet whose every value the other filters leave at zero, as distinct from
 *  one with no values at all (the facet's own `empty`). */
function NoneLeft() {
  return <li className="px-3 py-2 text-xs text-muted-foreground">None match the other filters.</li>;
}

function CheckRow({
  checked,
  count,
  onToggle,
  mono,
  dot,
  children,
}: {
  checked: boolean;
  count: number;
  onToggle: () => void;
  mono?: boolean | undefined;
  dot?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={checked}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
      >
        <Checkbox checked={checked} tabIndex={-1} aria-hidden className="pointer-events-none" />
        {dot ? <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: paletteToken(dot) }} /> : null}
        <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-xs")} title={typeof children === "string" ? children : undefined}>
          {children}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
      </button>
    </li>
  );
}

function Pill({ children, label, onRemove }: { children: React.ReactNode; label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background pl-2 pr-1 text-xs">
      <span className="inline-flex items-center gap-1.5">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={label}
        className="inline-flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
