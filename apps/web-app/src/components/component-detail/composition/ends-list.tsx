"use client";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { CompositionGraphNode } from "@scoutui/web-shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EndRow } from "./both-ends";
import { pathValueOf } from "./graph-model";
import { ComponentName, OpenLink } from "./open-link";
import { useRovingGrid } from "./use-roving-grid";

/** Lists longer than this get a filter. */
const FILTER_FROM = 13;

const stepsWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? "step" : "steps"}`;
const usesWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? "use" : "uses"}`;

/** A route step shown under its row in the list view. */
export type ChainStep = { node: CompositionGraphNode; fragment: string | null };

export type EndsListProps = {
  /** Names the list's rows for the connectors: `data-anchor` is `<id>:<component id>`. */
  id: string;
  title: string;
  rows: EndRow[];
  /** How many there are with nothing picked, when `rows` is narrowed. */
  total?: number;
  /** What the count after each name says. */
  measure: "steps" | "uses" | null;
  /** The row the person picked, pressed. */
  pressed: string | null;
  /** The row the drawn route runs through. */
  selected: string | null;
  /** Picks a row. A list without it only opens pages. */
  onPick?: (id: string) => void;
  /** Rows open their route under them, as a chain, instead of being pressed. */
  chain?: (id: string) => ChainStep[] | null;
  repoId: string;
  /** Beside the heading. */
  action?: ReactNode;
  /** What an empty list says when nothing filters it. */
  empty?: string | undefined;
  /** A bordered box that scrolls inside itself, or a section of the page. */
  layout: "box" | "section";
  className?: string;
};

export function EndsList({
  id,
  title,
  rows,
  total,
  measure,
  pressed,
  selected,
  onPick,
  chain,
  repoId,
  action,
  empty,
  layout,
  className,
}: EndsListProps) {
  const headingId = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? rows.filter((r) => r.node.displayName.toLowerCase().includes(q) || pathValueOf(r.node).toLowerCase().includes(q))
        : rows,
    [rows, q],
  );
  const steps = (rowId: string) => chain?.(rowId) ?? null;
  const keys = shown.flatMap((r) => [
    r.node.id,
    ...(steps(r.node.id) ?? []).slice(0, -1).map((s) => `${r.node.id}>${s.node.id}`),
  ]);
  const grid = useRovingGrid(keys, selected ?? pressed);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selected === null) return;
    const row = [...(scrollerRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? [])].find(
      (r) => r.getAttribute("data-key") === selected,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const count = q
    ? `${shown.length.toLocaleString()} of ${rows.length.toLocaleString()}`
    : total !== undefined && total !== rows.length
      ? `${rows.length.toLocaleString()} of ${total.toLocaleString()}`
      : rows.length.toLocaleString();

  return (
    <section
      data-panel={id}
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col",
        layout === "box" ? "overflow-clip rounded-lg border bg-card shadow-xs" : "min-w-0",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-2.5",
          layout === "box" ? "min-h-9 min-w-[11rem] bg-muted py-1 text-xs" : "sticky top-[var(--top-bar-height,0px)] z-10 min-h-9 bg-card py-1.5 text-label text-muted-foreground",
        )}
      >
        <h2 id={headingId} className={cn(layout === "box" && "font-medium")}>
          {title}
          <span className={cn("tabular-nums", layout === "box" && "font-normal text-muted-foreground")}>{` · ${count}`}</span>
        </h2>
        {action}
      </div>
      {rows.length >= FILTER_FROM ? (
        <div className="shrink-0 border-b px-2 py-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Filter by name or file"
            aria-label={`Filter ${title.toLowerCase()} by name or file`}
            className="h-7 w-full rounded-md border border-control bg-transparent px-2 font-mono text-base placeholder:font-sans placeholder:text-muted-foreground sm:text-xs"
          />
        </div>
      ) : null}
      <div ref={scrollerRef} data-scroller={id} className={cn("min-h-0 py-1", layout === "box" && "flex-1 overflow-y-auto")}>
        <ul aria-labelledby={headingId} onKeyDown={grid.onKeyDown} onFocus={grid.onFocus}>
          {shown.map((r) => {
            const rowId = r.node.id;
            const route = steps(rowId);
            const isPressed = chain ? route !== null : pressed === rowId;
            return (
              <li key={rowId}>
                <div
                  data-key={rowId}
                  data-anchor={`${id}:${rowId}`}
                  className={cn(
                    "mx-1 flex items-start gap-1 rounded-md border border-transparent",
                    selected === rowId || isPressed ? "selected" : onPick && "hover:bg-muted",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    {onPick ? (
                      <button
                        type="button"
                        data-cell={0}
                        tabIndex={grid.tabIndexOf(rowId, 0)}
                        aria-pressed={chain ? undefined : isPressed}
                        aria-expanded={chain ? route !== null : undefined}
                        onClick={() => onPick(rowId)}
                        className="flex w-full cursor-pointer items-start gap-1.5 rounded-[5px] px-1.5 py-1.5 text-left focus-inset"
                      >
                        {chain ? (
                          <ChevronRight
                            aria-hidden
                            className={cn(
                              "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                              route !== null && "rotate-90",
                            )}
                          />
                        ) : null}
                        <RowText row={r} measure={measure} />
                      </button>
                    ) : (
                      <div className="flex items-start gap-1.5 px-1.5 py-1.5">
                        <RowText row={r} measure={measure} />
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 py-0.5 pr-0.5">
                    <OpenLink
                      repoId={repoId}
                      node={r.node}
                      cell={onPick ? 1 : 0}
                      tabIndex={grid.tabIndexOf(rowId, onPick ? 1 : 0)}
                    />
                  </div>
                </div>
                {route ? (
                  <ol aria-label={`Route from ${r.node.displayName}`} className="mx-1 mb-1 pl-6">
                    {route.map((s, i) => (
                      <li key={s.node.id} data-key={`${rowId}>${s.node.id}`} className="flex items-start gap-1">
                        <span className="flex min-w-0 flex-1 items-start gap-1 py-1">
                          <span aria-hidden className="w-3 shrink-0 font-mono text-xs text-muted-foreground">
                            ↓
                          </span>
                          <ComponentName node={s.node} fragment={s.fragment} strong={i === route.length - 1} />
                        </span>
                        {i === route.length - 1 ? null : (
                          <span className="shrink-0 pr-0.5">
                            <OpenLink
                              repoId={repoId}
                              node={s.node}
                              cell={0}
                              tabIndex={grid.tabIndexOf(`${rowId}>${s.node.id}`, 0)}
                            />
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ul>
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {q ? (
              <>
                No matches for “<span className="font-mono">{query.trim()}</span>”.{" "}
                <Button variant="link" size="xs" className="h-auto px-0" onClick={() => setQuery("")}>
                  Clear
                </Button>
              </>
            ) : (
              empty
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function RowText({ row, measure }: { row: EndRow; measure: EndsListProps["measure"] }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <ComponentName node={row.node} fragment={row.fragment} />
      </span>
      {measure ? (
        <span className="shrink-0 whitespace-nowrap pl-1 text-xs tabular-nums text-muted-foreground">
          <span className="sr-only">, </span>
          {measure === "steps" ? stepsWord(row.steps) : usesWord(row.uses)}
        </span>
      ) : null}
    </>
  );
}
