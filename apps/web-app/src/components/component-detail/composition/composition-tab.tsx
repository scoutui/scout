"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentDetail, CompositionGraph } from "@scoutui/web-shared";
import { ORIGIN_DESCRIPTION, ORIGIN_LABEL } from "@/lib/component-facets";
import type { QueryParams } from "@/lib/query-string";
import { useQueryParamsState } from "@/lib/use-query-synced-state";
import {
  type BothEnds,
  buildBothEnds,
  type Ends,
  NO_ENDS,
  normaliseEnds,
  pickDirect,
  pickFound,
  pickTop,
} from "./both-ends";
import { BothEndsDiagram } from "./both-ends-diagram";
import { BothEndsList } from "./both-ends-list";
import { FindBox, totalsLine } from "./find-box";
import { bothRoutes, buildGraphModel, type Dir, findRows } from "./graph-model";
import { ScopeGlyph } from "./scope-glyph";

// `?pin=<dir>:<id>` and `?top=<id>`. The direction is in the URL because in a
// cyclic graph the same id can be reached both up and down from the focus.
// useQueryParamsState needs its names, `parse` and `serialize` at module level
// (stable references). A malformed pin parses to none.
const PICK_PARAMS = ["pin", "top"] as const;
function parsePicks(params: URLSearchParams): Ends {
  const raw = params.get("pin") ?? "";
  const sep = raw.indexOf(":");
  const dir = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  const pin = sep !== -1 && (dir === "up" || dir === "down") && id ? { dir: dir as Dir, id } : null;
  return { pin, top: params.get("top") || null };
}
function serializePicks(ends: Ends): QueryParams {
  const params: [string, string][] = [];
  if (ends.pin) params.push(["pin", `${ends.pin.dir}:${ends.pin.id}`]);
  if (ends.top) params.push(["top", ends.top]);
  return params;
}

/** Below this the tab shows lists instead of the diagram: phones, narrow windows and 200% zoom. */
const NARROW = "(max-width: 1023px)";
const subscribeNarrow = (onChange: () => void) => {
  const media = window.matchMedia(NARROW);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
/** Whether the window is narrow; null until the browser says, so nothing renders at the wrong width. */
function useNarrow(): boolean | null {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => null,
  );
}

/** What a screen reader hears when the picks change. */
function announce(view: BothEnds): string | null {
  const [first, ...rest] = view.route.ids;
  const last = rest.at(-1);
  const name = (id: string | undefined) =>
    [view.focus, ...[...view.top, ...view.direct, ...view.renders, ...view.between].map((r) => r.node)].find(
      (n) => n.id === id,
    )?.displayName ?? "";
  if (view.route.dir === "down" && last) return `Showing the route from ${view.focus.displayName} to ${name(last)}`;
  if (view.picked.top && first) return `Showing the route from ${name(first)} to ${view.focus.displayName}`;
  if (view.through) {
    const n = view.top.length;
    return n === 1
      ? `Showing the 1 top-level component whose route runs through ${view.through.displayName}`
      : `Showing the ${n.toLocaleString()} top-level components whose routes run through ${view.through.displayName}`;
  }
  return null;
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
  const routes = useMemo(() => (focusId ? bothRoutes(model, focusId) : null), [model, focusId]);
  const [picks, setPicks] = useQueryParamsState(PICK_PARAMS, parsePicks, serializePicks);
  const ends = useMemo(
    () => (focusId && routes ? normaliseEnds(model, focusId, routes, picks) : NO_ENDS),
    [model, focusId, routes, picks],
  );
  const view = useMemo(
    () => (focusId && routes ? buildBothEnds(model, focusId, routes, ends) : null),
    [model, focusId, routes, ends],
  );
  const up = useMemo(() => (focusId && routes ? findRows(model, focusId, routes.up, "up") : []), [model, focusId, routes]);
  const down = useMemo(
    () => (focusId && routes ? findRows(model, focusId, routes.down, "down") : []),
    [model, focusId, routes],
  );
  const narrow = useNarrow();

  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const said = view ? announce(view) : null;
    if (said) setAnnouncement(said);
    else if (announced.current) setAnnouncement("Route cleared");
    announced.current = said;
  }, [view]);

  if (!focusId || !routes || !view || (view.direct.length === 0 && view.renders.length === 0)) {
    return (
      <p className="text-sm text-muted-foreground">
        {`Nothing in this repo renders ${detail.displayName}, and ${detail.displayName} renders no other components.`}
      </p>
    );
  }

  const props = {
    view,
    repoId: detail.repoId,
    pressedDirect: ends.pin?.dir === "up" ? ends.pin.id : null,
    onPickTop: (id: string) => setPicks(pickTop(ends, id)),
    onPickDirect: (id: string) => setPicks(pickDirect(model, focusId, routes, ends, id)),
    onClearThrough: () => setPicks({ pin: null, top: ends.top }),
  };
  return (
    <section
      aria-label="Composition"
      className="panel flex flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && (ends.pin || ends.top)) setPicks(NO_ENDS);
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-muted px-3 py-2">
        <FindBox
          up={up}
          down={down}
          focusName={view.focus.displayName}
          onPick={(r) => setPicks(pickFound(model, r.dir, r.node.id))}
        />
        <p className="text-xs tabular-nums text-muted-foreground">
          {totalsLine(view.focus.displayName, view.totals.up, view.totals.down)}
        </p>
      </header>
      <div className={narrow ? undefined : "bg-background"}>
        {narrow === null ? null : narrow ? <BothEndsList {...props} /> : <BothEndsDiagram {...props} />}
      </div>
      <footer className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        {(["local", "external"] as const).map((scope) => (
          <span key={scope} title={ORIGIN_DESCRIPTION[scope]} className="flex items-center gap-1.5 whitespace-nowrap">
            <ScopeGlyph scope={scope} />
            {ORIGIN_LABEL[scope]}
          </span>
        ))}
      </footer>
      <output className="sr-only">{announcement}</output>
    </section>
  );
}
