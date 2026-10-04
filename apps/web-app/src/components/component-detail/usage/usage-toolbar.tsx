"use client";
import { AlertTriangle, Check, Copy, ListFilter, Search, X } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";
import { countText, filterText, pickGroups, plural, type UsageDue, type UsagePick, type UsageView, valueLabel, valueSpeech } from "@scoutui/web-shared/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** From this file list width the search box's placeholder says what it searches. */
const WIDE_PX = 560;

/** A text link, or a button that reads as one. */
export const LINK =
  "cursor-pointer rounded-sm text-foreground underline decoration-muted-foreground/60 underline-offset-2 transition-colors duration-150 ease-out hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none";

/**
 * The file list's toolbar, pinned under the top nav on one line: the search, the Filter button below lg, Clear filters
 * from sm, the count and Copy list. Only the search narrows when the line runs out of room. With few calls it has no
 * search or Filter button and scrolls with the page. With `due` the count reads as work still to do, in warn colour.
 */
export function UsageToolbar({
  view,
  few,
  due,
  width,
  find,
  onFind,
  barRef,
  searchRef,
  onFilter,
  onClearFilters,
  onCopy,
  copied,
}: {
  view: UsageView;
  few: boolean;
  due: UsageDue | null;
  /** The file list's width. */
  width: number;
  /** The search as the page URL holds it. */
  find: string;
  onFind: (find: string) => void;
  barRef: RefObject<HTMLDivElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  onFilter: () => void;
  onClearFilters: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div ref={barRef} className={cn("flex items-center gap-2 border-b bg-card px-3 py-2 sm:px-4", !few && "sticky z-20")} style={{ top: "var(--pin-top, 3.5rem)" }}>
      {few ? null : (
        <>
          <SearchBox inputRef={searchRef} find={find} onFind={onFind} wide={width >= WIDE_PX} />
          <Button
            variant="outline"
            size="sm"
            aria-controls="usage-column-body"
            aria-keyshortcuts="f"
            title="Filter (F)"
            onClick={onFilter}
            className="shrink-0 cursor-pointer gap-1.5 font-normal motion-reduce:transition-none lg:hidden"
          >
            <ListFilter aria-hidden data-icon="inline-start" />
            Filter
            {view.active > 0 ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold tabular-nums text-foreground">
                <span className="sr-only">, </span>
                {view.active}
                <span className="sr-only"> active</span>
              </span>
            ) : null}
          </Button>
        </>
      )}
      {/* Below sm, Clear filters sits after the pills instead. */}
      {view.active > 0 ? (
        <Button variant="ghost" size="xs" onClick={onClearFilters} className="shrink-0 cursor-pointer text-muted-foreground motion-reduce:transition-none max-sm:hidden">
          Clear filters
        </Button>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <CountText view={view} due={due} />
        <CopyListButton files={view.files} folder={null} disabled={view.shown === 0} copied={copied} onCopy={onCopy} />
      </div>
    </div>
  );
}

/**
 * The search box. It shows what the reader types at once and follows the URL when the URL's search changes some other
 * way, such as Back. Too narrow for its placeholder, it shows the icon alone.
 */
function SearchBox({ inputRef, find, onFind, wide }: { inputRef: RefObject<HTMLInputElement | null>; find: string; onFind: (find: string) => void; wide: boolean }) {
  const [draft, setDraft] = useState(find);
  const [seen, setSeen] = useState(find);
  if (find !== seen) {
    setSeen(find);
    setDraft(find);
  }
  const change = (next: string) => {
    setDraft(next);
    onFind(next);
  };

  return (
    <label className="@container flex h-8 min-w-0 flex-1 cursor-text items-center gap-2 rounded-md border bg-background px-2.5 transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 motion-reduce:transition-none sm:max-w-64">
      <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        name="find"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          if (draft) change("");
          else e.currentTarget.blur();
        }}
        aria-label="Search files and props"
        aria-keyshortcuts="/"
        placeholder={wide ? "Search files and props" : "Search"}
        className="w-full min-w-0 bg-transparent font-mono text-base outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground @max-[4.5rem]:placeholder:text-transparent sm:text-xs"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            change("");
            inputRef.current?.focus();
          }}
          className="-mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-xs text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : (
        <kbd aria-hidden title="Press / to search" className="hidden h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[11px] text-muted-foreground sm:inline-flex">
          /
        </kbd>
      )}
    </label>
  );
}

/**
 * The calls in view, and from sm the files they're in, with the warning glyph at every width while `due`. A screen
 * reader hears the long form as it changes.
 */
function CountText({ view, due }: { view: UsageView; due: UsageDue | null }) {
  const { short, long } = countText(view, due);
  return (
    <>
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums", due ? "font-medium text-status-warn-text" : "text-muted-foreground")}>
        {due ? <AlertTriangle aria-hidden className="size-3.5" /> : null}
        <span aria-hidden className="sm:hidden">
          {short}
        </span>
        <span aria-hidden className="hidden sm:inline">
          {long}
        </span>
      </span>
      <span aria-live="polite" className="sr-only">
        {long}
      </span>
    </>
  );
}

/**
 * Copies a list of files: the toolbar's copies every file in view, a folder or package heading's (`folder` is its
 * label) only that folder's or package's. It reads "Copied" while `copied`.
 */
export function CopyListButton({ files, folder, disabled = false, copied, onCopy }: { files: number; folder: string | null; disabled?: boolean; copied: boolean; onCopy: () => void }) {
  const label = folder === null ? `Copy the list of ${plural(files, "file")}` : `Copy the list of ${plural(files, "file")} in ${folder}`;
  return (
    <Button
      variant={folder === null ? "outline" : "ghost"}
      size={folder === null ? "sm" : "xs"}
      onClick={onCopy}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn("cursor-pointer motion-reduce:transition-none", folder !== null && "text-muted-foreground")}
    >
      <SwapIcon on={copied} from={<Copy className="size-3.5" />} to={<Check className="size-3.5" />} />
      <span className={folder === null ? "max-sm:sr-only" : "max-md:sr-only"}>{copied ? "Copied" : folder === null ? "Copy list" : "Copy"}</span>
    </Button>
  );
}

export const SWAP = "col-start-1 row-start-1 flex items-center justify-center transition-[opacity,scale] duration-250 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none";
export const SWAP_ON = "scale-100 opacity-100";
export const SWAP_OFF = "scale-[0.25] opacity-0";

/** Two icons in one slot that cross-fade on a state change, so neither pops in or out. */
function SwapIcon({ on, from, to }: { on: boolean; from: ReactNode; to: ReactNode }) {
  return (
    <span aria-hidden data-icon="inline-start" className="inline-grid">
      <span className={cn(SWAP, on ? SWAP_OFF : SWAP_ON)}>{from}</span>
      <span className={cn(SWAP, on ? SWAP_ON : SWAP_OFF)}>{to}</span>
    </span>
  );
}

/**
 * One pill per filtered prop, in the order first picked, then the package or folder; below sm, Clear filters after
 * them. Each pill's × removes that filter and tells `onRemoving` its position first.
 */
export function FilterPills({
  view,
  picks,
  onRemoveProp,
  onRemoveArea,
  onRemoving,
  onClearFilters,
}: {
  view: UsageView;
  picks: readonly UsagePick[];
  onRemoveProp: (prop: string) => void;
  onRemoveArea: () => void;
  onRemoving: (index: number) => void;
  onClearFilters: () => void;
}) {
  const groups = pickGroups(picks);
  const area = view.areas.find((a) => a.picked);
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 sm:px-4">
      {groups.map((group, i) => {
        const onlyUnset = group.picks.length === 1 && group.picks[0]?.kind === "unset";
        return (
          <Pill
            key={group.prop}
            label={`Remove the filter ${filterText(group.picks, null, "", valueSpeech)}`}
            title={group.picks.length > 1 ? filterText(group.picks, null, "") : undefined}
            onRemove={() => {
              onRemoving(i);
              onRemoveProp(group.prop);
            }}
          >
            <span className="truncate font-mono">{group.prop}</span>
            {onlyUnset ? (
              <span className="text-muted-foreground">not set</span>
            ) : (
              <span className="truncate font-medium">
                <span className="font-mono">= </span>
                <PickedValues picks={group.picks} />
              </span>
            )}
          </Pill>
        );
      })}
      {area ? (
        <Pill
          label={`Remove the filter ${view.byPackage ? "package" : "folder"} ${area.label}`}
          onRemove={() => {
            onRemoving(groups.length);
            onRemoveArea();
          }}
        >
          <span className="text-muted-foreground">{view.byPackage ? "Package" : "Folder"}</span>
          <span className="truncate font-mono font-medium">{area.label}</span>
        </Pill>
      ) : null}
      <Button variant="ghost" size="xs" onClick={onClearFilters} className="cursor-pointer text-muted-foreground motion-reduce:transition-none sm:hidden">
        Clear filters
      </Button>
    </div>
  );
}

/** A prop's picked values as its pill shows them: `ghost or outline`, with `not set` in words. */
function PickedValues({ picks }: { picks: readonly UsagePick[] }) {
  return picks.map((pick, i) => (
    <span key={`${pick.kind}:${pick.label}`}>
      {i > 0 ? <span className="font-sans font-normal text-muted-foreground">{i === picks.length - 1 ? " or " : ", "}</span> : null}
      {pick.kind === "unset" ? <span className="font-sans font-normal text-muted-foreground">not set</span> : <span className="font-mono">{valueLabel(pick)}</span>}
    </span>
  ));
}

function Pill({ label, title, onRemove, children }: { label: string; title?: string | undefined; onRemove: () => void; children: ReactNode }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border bg-background pl-2 pr-0.5 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 truncate" title={title}>
        {children}
      </span>
      <button
        type="button"
        data-pill
        onClick={onRemove}
        aria-label={label}
        title="Remove filter"
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-accent motion-reduce:transition-none"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}
