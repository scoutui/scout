"use client";
// A search box over packages and components, used by Governance's target fields and the
// chart builder's series. The caller's search ranks the rows (lib/identity-search), and a
// package row narrows the search to that package, shown as a chip in the box. With
// `multiple`, the list stays open while you pick, and an added row shows a check.
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, flip, offset, size, useFloating } from "@floating-ui/react-dom";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { PackageName } from "@/components/package-name";
import { shortenPath } from "@/components/repos/components-table";
import { type IdentityPick, MAX_COMPONENT_ROWS, type SearchResult, type SearchRow } from "@/lib/identity-search";
import { cn } from "@/lib/utils";

export type { IdentityPick } from "@/lib/identity-search";

export function pickLabel(pick: { packageName: string; exportName?: string | undefined }): string {
  return pick.exportName ? `${pick.exportName} · ${pick.packageName}` : pick.packageName;
}

const keepFocus = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

const components = (n: number) => `${n.toLocaleString()} component${n === 1 ? "" : "s"}`;
const packages = (n: number) => `${n.toLocaleString()} package${n === 1 ? "" : "s"}`;
const matches = (n: number) => `${n.toLocaleString()} match${n === 1 ? "" : "es"}`;

/** The name with each matched range in bold. */
function marked(name: string, ranges: Array<[number, number]>): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    parts.push(
      name.slice(at, start),
      <b key={start} className="font-semibold">
        {name.slice(start, end)}
      </b>,
    );
    at = end;
  }
  parts.push(name.slice(at));
  return parts;
}

function Refusal({ text }: { text: string | null }) {
  return text ? <span className="shrink-0 text-xs text-muted-foreground">{text}</span> : null;
}

/** A package's name in a cell as wide as the name, narrower only when the row is, so `PackageName` can tell whether it fits. */
function PackageCell({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("grid min-w-0 font-mono text-xs", className)} style={{ flex: `0 1 calc(${name.length}ch + 1px)` }}>
      <PackageName name={name} />
    </span>
  );
}

const refused = (row: SearchRow<unknown>) => (row.kind === "whole" || row.kind === "component") && row.refusal !== null;

function RowContent({ row, active, narrowed }: { row: SearchRow<unknown>; active: boolean; narrowed: boolean }) {
  if (row.kind === "package") {
    return (
      <>
        <PackageCell name={row.packageName} />
        <span className="shrink-0 text-xs text-muted-foreground">
          {row.matches === null ? components(row.components) : matches(row.matches)}
        </span>
        {active ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-4 text-xs text-muted-foreground">
            <kbd aria-hidden className="inline-flex h-4 min-w-4 items-center justify-center rounded border px-1 font-sans">
              ↵
            </kbd>
            to search in it
          </span>
        ) : null}
      </>
    );
  }
  if (row.kind === "whole") {
    return (
      <>
        <span className="shrink-0 text-xs text-muted-foreground">All of</span>
        <PackageCell name={row.packageName} />
        <span className="shrink-0 text-xs text-muted-foreground">{components(row.components)}</span>
        <Refusal text={row.refusal} />
      </>
    );
  }
  if (row.kind === "tag" || row.kind === "local") {
    return (
      <>
        <span className={cn("min-w-0 truncate text-xs", row.kind === "tag" && "font-mono")}>{marked(row.label, row.matched)}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {row.kind === "tag" ? `tag · ${packages(row.packages)}` : components(row.components)}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="min-w-0 truncate font-mono text-xs">
        {row.refusal === null ? marked(row.exportName, row.matched) : row.exportName}
      </span>
      {narrowed || row.packageName === null ? null : <PackageCell name={row.packageName} className="text-muted-foreground" />}
      {row.disambiguator ? (
        <span title={row.disambiguator} className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground">
          {shortenPath(row.disambiguator)}
        </span>
      ) : null}
      <Refusal text={row.refusal} />
    </>
  );
}

const rowKey = (row: SearchRow<unknown>) =>
  row.kind === "tag" ? `tag:${row.tagId}`
    : row.kind === "local" ? "local"
      : row.kind === "component" ? `component:${row.componentId ?? `${row.packageName}:${row.exportName}`}`
        : `${row.kind}:${row.packageName}`;

const optionId = (listId: string, row: SearchRow<unknown>) => `${listId}-${rowKey(row)}`;

export function GroupedIdentityPicker<T>({
  id,
  labelId,
  search,
  value = null,
  onSelect,
  multiple = false,
  scope,
  onScopeChange,
  placeholder,
  emptyText,
  ariaDescribedBy,
  invalid,
  disabled,
}: {
  /** The input's id; the field's `<label htmlFor>` names it. */
  id: string;
  /** The field label's id; it names the list. */
  labelId: string;
  /** The rows for a search, narrowed to a package or not. Keep it stable while its inputs are. */
  search: (query: string, scope: string | null) => SearchResult<T>;
  /** Shown in the box while the list is closed. */
  value?: IdentityPick | null | undefined;
  onSelect: (pick: T) => void;
  /** Keeps the list open after a pick and marks the rows the search says are added. */
  multiple?: boolean | undefined;
  /** The package the search is narrowed to. */
  scope: string | null;
  onScopeChange: (scope: string | null) => void;
  placeholder: string;
  /** Shown in the list when a search with nothing typed has no rows. */
  emptyText: string;
  ariaDescribedBy?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<number | null>(null);
  const searchKey = `${scope ?? ""}\u0000${query}`;
  const [searched, setSearched] = useState(searchKey);
  if (searched !== searchKey) {
    setSearched(searchKey);
    setHighlight(null);
  }
  const inputRef = useRef<HTMLInputElement>(null);

  const { rows, defaultIndex, total } = useMemo(() => search(query, scope), [search, query, scope]);
  const activeIndex = highlight !== null && highlight < rows.length ? highlight : defaultIndex;
  const active = activeIndex === null ? undefined : rows[activeIndex];
  const hasRows = rows.length > 0;
  const message = !open
    ? null
    : !hasRows
      ? query.trim() === "" && scope === null ? emptyText : "No matches"
      : total !== null
          ? `Showing ${MAX_COMPONENT_ROWS} of ${total.toLocaleString()}. Type to narrow the list.`
        : null;
  const listShown = open && (hasRows || message !== null);
  const listId = `${id}-list`;
  const scopeId = `${id}-scope`;

  const { refs, floatingStyles, isPositioned } = useFloating({
    open: listShown,
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      size({
        padding: 8,
        apply({ rects, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
            maxHeight: `${Math.max(200, Math.min(Math.floor(availableHeight), 384, window.innerHeight * 0.6))}px`,
          });
        },
      }),
      flip({ padding: 8 }),
    ],
  });

  useLayoutEffect(() => {
    if (!open && document.activeElement === inputRef.current) inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (!isPositioned || active === undefined) return;
    document.getElementById(optionId(listId, active))?.scrollIntoView({ block: "nearest" });
  }, [isPositioned, active, listId]);

  const showValue = !open && value !== null;
  const inputValue = open ? query : value ? pickLabel(value) : "";

  function close() {
    setOpen(false);
    setQuery("");
    setHighlight(null);
  }

  /** Closes the list without a pick. With no value, the search is no longer narrowed to a package. */
  function dismiss() {
    close();
    if (value === null && scope !== null) onScopeChange(null);
  }

  function narrow(row: Extract<SearchRow<T>, { kind: "package" }>) {
    onScopeChange(row.packageName);
    setQuery(row.narrowedQuery);
  }

  function choose(row: SearchRow<T>) {
    if (row.kind === "package") {
      narrow(row);
    } else if (!refused(row)) {
      onSelect(row.pick);
      if (!multiple) close();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && inputValue === "" && scope !== null) {
      onScopeChange(null);
    } else if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const from = activeIndex ?? (step === 1 ? -1 : rows.length);
      setHighlight((from + step + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active) choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    } else if (e.key === "Tab" && !e.shiftKey && active?.kind === "package" && (highlight !== null || query !== "")) {
      e.preventDefault();
      narrow(active);
    }
  }

  return (
    <div
      ref={refs.setReference}
      onMouseDown={(e) => {
        if (disabled || e.button !== 0 || e.target === inputRef.current) return;
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }}
      className={cn(
        "focus-field relative flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border bg-transparent px-2.5 text-sm transition-colors dark:bg-input/30",
        invalid
          ? "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40"
          : "border-control",
        scope !== null && !showValue && "pl-1",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {scope !== null && !showValue ? (
        <span className="inline-flex h-[22px] max-w-[60%] shrink-0 items-center gap-1 rounded-md border bg-muted px-1.5 font-mono text-xs">
          <span id={scopeId} className="truncate">
            {scope}
          </span>
          <button
            type="button"
            aria-label="Search all packages"
            disabled={disabled}
            onMouseDown={keepFocus}
            onClick={() => {
              onScopeChange(null);
              inputRef.current?.focus();
            }}
            className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground after:absolute after:-inset-1 hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden className="size-3" strokeWidth={1.5} />
          </button>
        </span>
      ) : null}
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open && hasRows}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && hasRows && active ? optionId(listId, active) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={[ariaDescribedBy, scope !== null && !showValue ? scopeId : null].filter(Boolean).join(" ") || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={inputValue}
        placeholder={scope === null ? placeholder : "Search this package"}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={dismiss}
        onKeyDown={onKeyDown}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent font-mono text-base placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed sm:text-xs",
          showValue && "text-transparent caret-foreground",
        )}
      />
      {showValue && value ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-8 left-2.5 flex items-center font-mono text-base sm:text-xs">
          <span className="truncate">
            {value.exportName ? (
              <>
                {value.exportName}
                <span className="text-muted-foreground"> · {value.packageName}</span>
              </>
            ) : (
              value.packageName
            )}
          </span>
        </span>
      ) : null}
      <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <output className="sr-only">{message}</output>
      {listShown
        ? createPortal(
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              onMouseDown={keepFocus}
              className="z-50 overflow-y-auto rounded-lg bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
            >
              {hasRows ? (
                // biome-ignore lint/a11y/useSemanticElements: an ARIA combobox list of rich rows
                <div id={listId} role="listbox" aria-labelledby={labelId} aria-multiselectable={multiple || undefined} tabIndex={-1}>
                  {rows.map((row, i) => {
                    const off = refused(row);
                    const added = row.kind !== "package" && row.added === true;
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input handles the keys for every option
                      <div
                        key={rowKey(row)}
                        id={optionId(listId, row)}
                        // biome-ignore lint/a11y/useSemanticElements: an ARIA combobox option of rich content
                        role="option"
                        aria-selected={multiple ? added : i === activeIndex}
                        aria-disabled={off || undefined}
                        tabIndex={-1}
                        onClick={() => choose(row)}
                        className={cn(
                          "flex cursor-default items-baseline gap-2 px-2.5 py-1.5",
                          i === activeIndex ? "focus-current bg-muted" : "hover:bg-muted/60",
                          off && "text-muted-foreground",
                        )}
                      >
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <RowContent row={row} active={i === activeIndex} narrowed={scope !== null} />
                        </span>
                        {multiple ? (
                          <span aria-hidden className="flex size-3.5 shrink-0 self-center">
                            {added ? <Check className="size-3.5" /> : null}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {message ? (
                <p aria-hidden className="px-2.5 py-1.5 text-xs text-muted-foreground">
                  {message}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
