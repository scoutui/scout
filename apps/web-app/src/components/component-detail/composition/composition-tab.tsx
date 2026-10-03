"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ComponentDetail, CompositionGraph } from "@scoutui/web-shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  buildGraphModel,
  closureOf,
  pathBetween,
  pathValueOf,
  type TraceEndpoint,
} from "./graph-model";
import { distinctTails } from "./graph-framing";
import type { PinnedEntry } from "./graph-layout";
import { readRailCollapsed, writeRailCollapsed } from "./rail-collapse";
import { renderTreeCaption, type CaptionPart, type RenderTreeCaption } from "./render-tree-caption";
import { ScopeGlyph } from "./scope-glyph";
import { useQuerySyncedState } from "@/lib/use-query-synced-state";

const CompositionCanvas = dynamic(() => import("./composition-canvas").then((m) => m.CompositionCanvas), {
  loading: CanvasSkeleton,
});

const PANEL_PAGE = 6;

/** The render tree's panel frame, shown while the canvas code loads. */
function CanvasSkeleton() {
  return (
    <div aria-hidden className="panel flex flex-col overflow-hidden lg:h-full lg:min-w-0 lg:flex-1">
      <div className="shrink-0 space-y-1.5 border-b px-3 py-2">
        <div className="h-3 w-20 animate-pulse motion-reduce:animate-none rounded-sm bg-muted/60" />
        <div className="h-3 w-48 animate-pulse motion-reduce:animate-none rounded-sm bg-muted/40" />
      </div>
      <div className="h-[30rem] lg:h-auto lg:min-h-0 lg:flex-1" />
      <div className="shrink-0 border-t px-3 py-2">
        <div className="h-3 w-64 animate-pulse motion-reduce:animate-none rounded-sm bg-muted/40" />
      </div>
    </div>
  );
}

type TracedEndpoint = { id: string; dir: "up" | "down" };

// `?pin=<dir>:<id>`. The direction is in the URL because in a cyclic graph the
// same id can be reached both up and down from the focus. useQuerySyncedState
// needs `parse` and `serialize` at module level (stable references). A
// malformed or empty value parses to null, so a bad link shows the unpinned
// view.
function parsePinnedEndpoint(raw: string): TracedEndpoint | null {
  const sep = raw.indexOf(":");
  if (sep === -1) return null;
  const dir = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if ((dir !== "up" && dir !== "down") || !id) return null;
  return { id, dir };
}
function serializePinnedEndpoint(endpoint: TracedEndpoint | null): string {
  return endpoint ? `${endpoint.dir}:${endpoint.id}` : "";
}

export function CompositionTab({
  detail,
  graph,
}: {
  detail: ComponentDetail;
  graph: CompositionGraph;
}) {
  const model = useMemo(() => buildGraphModel(graph), [graph]);
  const focusId = model.byId.has(detail.componentId) ? detail.componentId : null;
  const focusName = useMemo(
    () => (focusId ? (model.byId.get(focusId)?.displayName ?? detail.displayName) : detail.displayName),
    [model, focusId, detail.displayName],
  );
  // The rail's two lists: everything above the focus and everything below it,
  // nearest first. The caption, the panel headers and the collapsed strip all
  // count these same arrays, so their numbers agree.
  const dependents = useMemo(() => (focusId ? closureOf(model, focusId, "up") : []), [model, focusId]);
  const rendered = useMemo(() => (focusId ? closureOf(model, focusId, "down") : []), [model, focusId]);
  // Direct-neighbour counts exclude a self-render edge: the focus is never its
  // own neighbour.
  const caption = useMemo(() => {
    if (!focusId) return null;
    const notSelf = (a: { id: string }) => a.id !== focusId;
    return renderTreeCaption({
      focusName,
      directParents: (model.parentsOf.get(focusId) ?? []).filter(notSelf).length,
      dependents: dependents.length,
      directChildren: (model.childrenOf.get(focusId) ?? []).filter(notSelf).length,
      rendered: rendered.length,
    });
  }, [model, focusId, focusName, dependents.length, rendered.length]);
  const [hovered, setHovered] = useState<TracedEndpoint | null>(null);
  // The pin lives in `?pin=` so a pinned view can be shared and restored.
  const [pinnedEndpoint, setPinnedEndpoint] = useQuerySyncedState<TracedEndpoint | null>(
    parsePinnedEndpoint,
    serializePinnedEndpoint,
    "pin",
  );

  // A hovered or pinned rail row's shortest path from the focus. An id the
  // model doesn't have finds no path, which shows the unpinned view.
  const pathFor = useCallback(
    (endpoint: TracedEndpoint | null): string[] | null => {
      if (!endpoint || !focusId) return null;
      return pathBetween(
        model,
        focusId,
        endpoint.id,
        endpoint.dir === "up" ? model.parentsOf : model.childrenOf,
      );
    },
    [model, focusId],
  );

  const hoverPath = useMemo(() => pathFor(hovered), [pathFor, hovered]);
  const pinned = useMemo<PinnedEntry[] | null>(() => {
    const path = pathFor(pinnedEndpoint);
    if (!path || !pinnedEndpoint) return null;
    return path.map((id, i) => ({ id, level: pinnedEndpoint.dir === "up" ? -i : i }));
  }, [pathFor, pinnedEndpoint]);

  // A row shows as pinned only once its path resolved. An unreachable target
  // keeps pinnedEndpoint set, so the next click still toggles it off. The
  // direction is part of the match: on a cycle through the focus the same
  // component sits in both lists, and only the clicked row is pinned.
  const pinnedRowId = pinned ? (pinnedEndpoint?.id ?? null) : null;
  const pinnedIdIn = (dir: "up" | "down") => (pinnedEndpoint?.dir === dir ? pinnedRowId : null);

  // Toggle-off matches on id and direction, so clicking the same component in
  // the other list switches the pin instead of releasing it.
  const commit = useCallback(
    (endpoint: TracedEndpoint) => {
      const isPinnedRow =
        pinnedEndpoint?.id === endpoint.id && pinnedEndpoint.dir === endpoint.dir;
      setPinnedEndpoint(isPinnedRow ? null : endpoint);
    },
    [pinnedEndpoint, setPinnedEndpoint],
  );

  const [railCollapsed, setRailCollapsed] = useState(false);
  // Read the saved preference after mount: the server render has no
  // localStorage, and reading it during render would break hydration.
  useEffect(() => setRailCollapsed(readRailCollapsed()), []);
  const toggleRail = useCallback(() => {
    setRailCollapsed((prev) => {
      writeRailCollapsed(!prev);
      return !prev;
    });
  }, []);

  // A component missing from the repo's graph has no render tree and no lists.
  if (!focusId) {
    return <p className="text-sm text-muted-foreground">{`No render tree for ${detail.displayName}.`}</p>;
  }

  // From lg up, the lists stack in a left rail and the canvas fills the rest
  // at viewport height, so a hovered row and its path share the screen. Below
  // lg everything stacks.
  return (
    <div className="flex flex-col gap-4 lg:h-[70vh] lg:min-h-[32rem] lg:flex-row">
      {railCollapsed ? null : (
        <div className="grid items-start gap-4 md:grid-cols-2 lg:flex lg:w-[22.5rem] lg:shrink-0 lg:flex-col lg:items-stretch">
          <div className="contents lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:items-stretch lg:gap-4">
            <ClosurePanel
              title="Rendered by"
              focusName={focusName}
              emptyCopy="Nothing in this repo renders {name}."
              rows={dependents}
              onHoverStart={(id) => setHovered({ id, dir: "up" })}
              onHoverEnd={() => setHovered(null)}
              onCommit={(id) => commit({ id, dir: "up" })}
              pinnedId={pinnedIdIn("up")}
            />
            <ClosurePanel
              title="Renders"
              focusName={focusName}
              emptyCopy="{name} renders no other components in this repo."
              rows={rendered}
              onHoverStart={(id) => setHovered({ id, dir: "down" })}
              onHoverEnd={() => setHovered(null)}
              onCommit={(id) => commit({ id, dir: "down" })}
              pinnedId={pinnedIdIn("down")}
            />
          </div>
        </div>
      )}

      <CompositionCanvas
        model={model}
        focusId={focusId}
        repoId={detail.repoId}
        pinned={pinned}
        hoverPath={hoverPath}
        caption={caption ? <CaptionLines caption={caption} /> : null}
        listsToggle={
          <button
            type="button"
            onClick={toggleRail}
            className="rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {railCollapsed ? "Show lists" : "Hide lists"}
          </button>
        }
        onRelease={() => setPinnedEndpoint(null)}
      />
    </div>
  );
}

/** The caption's two sentences, one per line, with the counts and the focus's
 *  name set apart from the words around them. */
function CaptionLines({ caption }: { caption: RenderTreeCaption }) {
  const line = (parts: CaptionPart[]) =>
    parts.map((part, i) =>
      part.kind === "text" ? (
        part.text
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: a caption's parts never reorder
        <span key={i} className={part.kind === "count" ? "font-medium tabular-nums" : "font-mono"}>
          {part.text}
        </span>
      ),
    );
  return (
    <>
      <span className="block">{line(caption.up)}</span>{" "}
      <span className="block">{line(caption.down)}</span>
    </>
  );
}

function matchesQuery(
  row: { displayName: string; packageName: string | null; filePath: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.displayName.toLowerCase().includes(q) ||
    (row.packageName ?? "").toLowerCase().includes(q) ||
    (row.filePath ?? "").toLowerCase().includes(q)
  );
}

// Module-level so their references stay stable: PanelList's memos depend on
// them, and ClosurePanel re-renders on every rail-row hover.
function closureMatches(e: TraceEndpoint, q: string): boolean {
  return matchesQuery(e.node, q);
}
function closureLabelOf({ node }: TraceEndpoint): string {
  return pathValueOf(node);
}

/**
 * One direction as a flat list: everything above the focus, or everything
 * below it, nearest first. Each row shows how many steps away it sits, and the
 * header shows the list's size.
 */
function ClosurePanel({
  title,
  focusName,
  emptyCopy,
  rows,
  onHoverStart,
  onHoverEnd,
  onCommit,
  pinnedId,
}: {
  title: string;
  /** Replaces every `{name}` token in `emptyCopy`. */
  focusName: string;
  emptyCopy: string;
  rows: TraceEndpoint[];
  onHoverStart: (id: string) => void;
  onHoverEnd: () => void;
  onCommit: (id: string) => void;
  pinnedId: string | null;
}) {
  // Both panels can show a filter input at once, so each needs its own `name`.
  const filterName = `${title.toLowerCase().replace(/\s+/g, "-")}-filter`;
  const withName = (s: string) => s.replaceAll("{name}", focusName);

  return (
    // A panel with rows may shrink so its list scrolls, but never below 10rem,
    // so its header, filter and a few rows stay visible. An empty panel keeps
    // its natural height.
    <section
      className={cn(
        "panel overflow-hidden",
        rows.length > 0 ? "lg:flex lg:min-h-40 lg:flex-col" : "lg:flex-none",
      )}
    >
      <header className="shrink-0 border-b bg-muted px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-label text-muted-foreground">{title}</h2>
          <span className="text-label tabular-nums text-muted-foreground">
            {rows.length.toLocaleString()}
          </span>
        </div>
      </header>
      <PanelList
        name={filterName}
        rows={rows}
        rowKey={(e) => e.node.id}
        emptyCopy={withName(emptyCopy)}
        filterLabel={`Filter ${title}`}
        matches={closureMatches}
        labelOf={closureLabelOf}
        renderRow={({ node, hops }, label) => {
          const path = pathValueOf(node);
          const stepsWord = hops === 1 ? "1 step" : `${hops.toLocaleString()} steps`;
          return (
            <button
              type="button"
              onClick={() => onCommit(node.id)}
              onMouseEnter={() => onHoverStart(node.id)}
              onMouseLeave={onHoverEnd}
              onFocus={() => onHoverStart(node.id)}
              onBlur={onHoverEnd}
              aria-pressed={pinnedId === node.id}
              // The visible `label` is shortened, so the accessible name uses
              // the full `path`, joined the same way as ChipNode's `ariaLabel`.
              aria-label={[node.displayName, node.scope, node.deprecated ? "deprecated" : null, path, stepsWord]
                .filter(Boolean)
                .join(", ")}
              // The path gets its own line: the part of `label` that tells
              // rows apart is at its end, and sharing a line with the name
              // would clip exactly that.
              className={cn(
                "relative flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                // Hover styling applies only to unpinned rows, so the pinned
                // row keeps its look under the pointer.
                pinnedId === node.id ? "selected" : "hover:bg-muted/50",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <ScopeGlyph scope={node.scope} className="self-center" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{node.displayName}</span>
                {node.deprecated ? (
                  <Badge variant="warning" className="shrink-0">
                    deprecated
                  </Badge>
                ) : null}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{stepsWord}</span>
              </span>
              {/* `pathValueOf` returns "" for a node with neither a file
                  path nor a package; an empty line would still take height. */}
              {label ? (
                <span className="min-w-0 truncate text-code text-muted-foreground">{label}</span>
              ) : null}
            </button>
          );
        }}
      />
    </section>
  );
}

function PanelList<Row>({
  name,
  rows,
  rowKey,
  emptyCopy,
  filterLabel,
  matches,
  renderRow,
  labelOf,
}: {
  name: string;
  rows: Row[];
  rowKey: (row: Row) => string;
  emptyCopy: string;
  filterLabel: string;
  matches: (row: Row, query: string) => boolean;
  /** `label` is the row's path-like value, shortened by `distinctTails`
   *  against every row in the panel, not only the visible ones. Visible text
   *  only; null when `labelOf` is omitted. */
  renderRow: (row: Row, label: string | null) => React.ReactNode;
  /** The path-like value to shorten into a row's label. Omit for rows with
   *  nothing path-like. */
  labelOf?: (row: Row) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const canPage = rows.length > PANEL_PAGE;

  const filtered = useMemo(
    () => (expanded ? rows.filter((r) => matches(r, query)) : rows),
    [rows, expanded, query, matches],
  );
  const shown = expanded ? filtered : rows.slice(0, PANEL_PAGE);
  // Labels come from the full row set, not the filtered or paged `shown`
  // subset, so filtering down to one of two colliding rows doesn't shorten
  // its label back to the shared tail.
  const labels = useMemo(() => {
    if (!labelOf) return null;
    const tails = distinctTails(rows.map(labelOf));
    return new Map(rows.map((r, i) => [r, tails[i] ?? ""] as const));
  }, [rows, labelOf]);

  const toggleExpanded = () => {
    if (expanded) setQuery("");
    setExpanded((prev) => !prev);
  };

  if (rows.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-muted-foreground wrap-anywhere">{emptyCopy}</p>;
  }

  return (
    <>
      {expanded && canPage ? (
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <input
            type="search"
            name={name}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            aria-label={filterLabel}
            className="h-7 w-full rounded-md border bg-transparent px-2 font-mono text-xs placeholder:font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          {query.trim() ? (
            // `<output>` has an implicit role="status", so screen readers
            // announce the count as it changes.
            <output className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {`${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()}`}
            </output>
          ) : null}
        </div>
      ) : null}
      {expanded && shown.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">No matches.</p>
      ) : (
        // Only this list scrolls; the header, filter and pager stay put and
        // the rail itself never scrolls. Panels split the rail by content, so
        // a short panel keeps its natural height.
        <ul className="divide-y lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain">
          {shown.map((row) => (
            <li key={rowKey(row)}>{renderRow(row, labels ? (labels.get(row) ?? null) : null)}</li>
          ))}
        </ul>
      )}
      {canPage ? (
        <div className="shrink-0 border-t">
          <button
            type="button"
            onClick={toggleExpanded}
            className="w-full cursor-pointer px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            {expanded ? "Show fewer" : `Show all ${rows.length.toLocaleString()}`}
          </button>
        </div>
      ) : null}
    </>
  );
}
