"use client";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { ComponentDetail, CompositionGraph } from "@scoutui/web-shared";
import { useQuerySyncedState } from "@/lib/use-query-synced-state";
import type { FlowActions } from "./flow-canvas";
import { dirId, routeId, type SceneState } from "./flow-scene";
import { bothRoutes, buildGraphModel, realRoute, type Dir, type Routes } from "./graph-model";
import { renderTreeCaption, type SideCounts } from "./render-tree-caption";

const FlowCanvas = dynamic(() => import("./flow-canvas").then((m) => m.FlowCanvas), {
  loading: CanvasSkeleton,
});

/** The diagram's panel frame, shown while the canvas code loads. */
function CanvasSkeleton() {
  return (
    <div aria-hidden className="panel flex flex-col overflow-hidden lg:h-full lg:min-w-0 lg:flex-1">
      <div className="shrink-0 border-b px-3 py-2.5">
        <div className="h-3 w-72 max-w-full animate-pulse motion-reduce:animate-none rounded-sm bg-muted/60" />
      </div>
      <div className="h-[34rem] lg:h-auto lg:min-h-0 lg:flex-1" />
      <div className="shrink-0 border-t px-3 py-2">
        <div className="h-3 w-64 animate-pulse motion-reduce:animate-none rounded-sm bg-muted/40" />
      </div>
    </div>
  );
}

type Pin = { dir: Dir; ids: string[] };

// `?pin=<dir>:<id>,<id>,…`: the opened route, read outward from the focus.
// The direction is in the URL because in a cyclic graph the same id can be
// reached both up and down from the focus. useQuerySyncedState needs `parse`
// and `serialize` at module level (stable references). A malformed or empty
// value parses to null, so a bad link shows nothing selected.
function parsePin(raw: string): Pin | null {
  const sep = raw.indexOf(":");
  if (sep === -1) return null;
  const dir = raw.slice(0, sep);
  const ids = raw.slice(sep + 1).split(",").filter(Boolean);
  if ((dir !== "up" && dir !== "down") || ids.length === 0) return null;
  return { dir, ids };
}
function serializePin(pin: Pin | null): string {
  return pin ? routeId(pin.dir, pin.ids) : "";
}

const parseSet = (q: string): Set<string> => new Set(q.split(",").filter(Boolean));
const serializeSet = (s: Set<string>): string => [...s].join(",");

function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function countsOf(routes: Routes): SideCounts {
  let direct = 0;
  for (const s of routes.steps.values()) if (s === 1) direct++;
  return { direct, total: routes.steps.size - 1 };
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
  const focusName = focusId ? (model.byId.get(focusId)?.displayName ?? detail.displayName) : detail.displayName;
  const routes = useMemo(() => (focusId ? bothRoutes(model, focusId) : null), [model, focusId]);
  const [pin, setPin] = useQuerySyncedState<Pin | null>(parsePin, serializePin, "pin");
  const [lists, setLists] = useQuerySyncedState(parseSet, serializeSet, "list");
  const [brought, setBrought] = useQuerySyncedState(parseSet, serializeSet, "bring");
  const route = useMemo(() => {
    const ids = pin && focusId ? realRoute(model, focusId, pin.dir, pin.ids) : [];
    return pin && ids.length > 0 ? { dir: pin.dir, ids } : null;
  }, [model, focusId, pin]);
  const state = useMemo<SceneState>(() => ({ lists, brought, pin: route }), [lists, brought, route]);
  const actions = useMemo<FlowActions>(
    () => ({
      setPin,
      toggleList: (dir, parentId) => setLists(toggled(lists, dirId(dir, parentId))),
      bring: (dir, id) => setBrought(new Set(brought).add(dirId(dir, id))),
      reset: () => {
        setLists(new Set());
        setBrought(new Set());
        setPin(null);
      },
    }),
    [setPin, setLists, setBrought, lists, brought],
  );

  const up = routes ? countsOf(routes.up) : { direct: 0, total: 0 };
  const down = routes ? countsOf(routes.down) : { direct: 0, total: 0 };
  const caption = renderTreeCaption(focusName, up, down);
  if (!focusId || !routes || (up.direct === 0 && down.direct === 0)) {
    return <p className="text-sm text-muted-foreground">{caption}</p>;
  }

  return (
    <div className="flex flex-col gap-4 lg:h-[72vh] lg:min-h-[36rem]">
      <FlowCanvas
        model={model}
        focusId={focusId}
        repoId={detail.repoId}
        routes={routes}
        state={state}
        actions={actions}
        caption={caption}
      />
    </div>
  );
}
