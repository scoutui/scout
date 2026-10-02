"use client";
// Governance identity picker, used for both source and superseded-by. Results
// group by package; picking a package header makes a package-grain pick, an
// export a component-grain one. Search is tokenised (lib/identity-groups).
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildIdentityGroups, filterIdentityGroups } from "@/lib/identity-groups";
import { cn } from "@/lib/utils";

export type IdentityPick = { packageName: string; exportName?: string };

export function pickLabel(pick: { packageName: string; exportName?: string | undefined }): string {
  return pick.exportName ? `${pick.exportName} · ${pick.packageName}` : pick.packageName;
}

type Row =
  | { kind: "package"; packageName: string; totalExports: number }
  | { kind: "export"; packageName: string; exportName: string }
  | { kind: "hidden-note"; packageName: string; hiddenExports: number };

export function GroupedIdentityPicker({
  value,
  onSelect,
  sources,
  placeholder,
  id,
  disabled,
  ariaLabel,
  ariaDescribedBy,
  invalid,
}: {
  /** `pickLabel` of the current pick, empty if none. */
  value: string;
  onSelect: (pick: IdentityPick) => void;
  sources: { packageName: string; exportName?: string }[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string | undefined;
  ariaDescribedBy?: string | undefined;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const groups = useMemo(() => buildIdentityGroups(sources), [sources]);
  const filtered = useMemo(() => filterIdentityGroups(groups, query), [groups, query]);

  // Flat row model: keyboard highlight and rendering share one index space.
  // `selectable()` skips the presentational hidden-note rows.
  const rows = useMemo<Row[]>(
    () =>
      filtered.groups.flatMap((g): Row[] => [
        { kind: "package", packageName: g.packageName, totalExports: g.totalExports },
        ...g.exports.map((e): Row => ({ kind: "export", packageName: g.packageName, exportName: e })),
        ...(g.hiddenExports > 0
          ? [{ kind: "hidden-note", packageName: g.packageName, hiddenExports: g.hiddenExports } as Row]
          : []),
      ]),
    [filtered],
  );
  const selectable = (i: number) => rows[i] !== undefined && rows[i].kind !== "hidden-note";
  // So Enter never picks a whole package by surprise, the default row is the
  // first export, and a package header only when no exports are shown.
  const defaultIndex = useMemo(() => {
    const firstExport = rows.findIndex((r) => r.kind === "export");
    if (firstExport !== -1) return firstExport;
    const firstPackage = rows.findIndex((r) => r.kind === "package");
    return firstPackage === -1 ? null : firstPackage;
  }, [rows]);
  const activeIndex = highlight ?? defaultIndex;

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting highlight when query changes is intentional
  useEffect(() => setHighlight(null), [query]);
  useEffect(() => {
    if (activeIndex === null) return;
    listRef.current
      ?.querySelector(`[data-row-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function commitRow(row: Row) {
    if (row.kind === "hidden-note") return;
    onSelect(row.kind === "export" ? { packageName: row.packageName, exportName: row.exportName } : { packageName: row.packageName });
    setQuery("");
    setHighlight(null);
    setOpen(false);
  }

  function move(from: number | null, dir: 1 | -1): number | null {
    if (rows.length === 0) return null;
    let i = from === null ? (dir === 1 ? -1 : rows.length) : from;
    for (let step = 0; step < rows.length; step++) {
      i = (i + dir + rows.length) % rows.length;
      if (selectable(i)) return i;
    }
    return null;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(move(activeIndex, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = activeIndex !== null ? rows[activeIndex] : undefined;
      if (row) commitRow(row);
    }
  }

  const listId = `${id ?? "identity-picker"}-listbox`;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
          setHighlight(null);
        }
      }}
    >
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-ring aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
      >
        <span className={cn("min-w-0 truncate", value ? "font-mono text-xs" : "text-muted-foreground")}>
          {value || placeholder}
        </span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] min-w-(--anchor-width) gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-2.5 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeIndex !== null ? optionId(activeIndex) : undefined}
            placeholder="Search packages and components…"
            aria-label="Search packages and components"
            className="w-full bg-transparent font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground"
          />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: custom listbox pattern with divs allows flexible styling */}
        <div ref={listRef} id={listId} role="listbox" tabIndex={-1} className="max-h-72 overflow-y-auto py-1">
          {rows.map((row, i) =>
            row.kind === "hidden-note" ? (
              <div key={`note-${row.packageName}`} role="presentation" data-row-index={i} className="px-2.5 py-1 pl-7 text-[0.6875rem] text-muted-foreground">
                …{row.hiddenExports} more in <span className="font-mono text-xs">{row.packageName}</span>. Type more to narrow.
              </div>
            ) : row.kind === "package" ? (
              // biome-ignore lint/a11y/useSemanticElements: custom option pattern with divs allows flexible styling
              <div key={row.packageName} role="option" id={optionId(i)} aria-selected={pickLabel(row) === value} data-row-index={i} tabIndex={-1}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => commitRow(row)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors",
                    i === activeIndex ? "bg-muted/50" : "hover:bg-muted/50",
                    pickLabel(row) === value && "bg-muted/40",
                  )}
                >
                  <span className="truncate font-mono text-xs font-medium">{row.packageName}</span>
                  <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                    whole package{row.totalExports > 0 ? ` · ${row.totalExports}` : ""}
                  </span>
                </button>
              </div>
            ) : (
              <div
                key={`${row.packageName}/${row.exportName}`}
                // biome-ignore lint/a11y/useSemanticElements: custom option pattern with divs allows flexible styling
                role="option"
                id={optionId(i)}
                aria-selected={pickLabel(row) === value}
                data-row-index={i}
                tabIndex={-1}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => commitRow(row)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex w-full items-center px-2.5 py-1 pl-7 text-left transition-colors",
                    i === activeIndex ? "bg-muted/50" : "hover:bg-muted/50",
                    pickLabel(row) === value && "bg-muted/40",
                  )}
                >
                  <span className="truncate font-mono text-xs">{row.exportName}</span>
                </button>
              </div>
            ),
          )}
          {rows.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-muted-foreground">
              {sources.length === 0 ? "Nothing scanned yet." : "No matching packages or components."}
            </div>
          ) : null}
        </div>
        {filtered.hiddenGroups > 0 ? (
          <div className="border-t px-2.5 py-1.5 text-[0.6875rem] text-muted-foreground">
            {filtered.hiddenGroups} more package{filtered.hiddenGroups === 1 ? "" : "s"} match. Type more to narrow.
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
