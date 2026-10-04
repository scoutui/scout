"use client";
import {
  createContext,
  memo,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  ViewportPortal,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useResolvedTheme } from "@/components/theme/theme-provider";
import { DeprecatedMark } from "@/components/deprecated-mark";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ORIGIN_DESCRIPTION, ORIGIN_LABEL } from "@/lib/component-facets";
import { cn } from "@/lib/utils";
import { useMedia } from "../usage/usage-layout-hooks";
import {
  chipFaceFragments,
  distinctTails,
  findRows,
  pathValueOf,
  type BothRoutes,
  type Dir,
  type FindRow,
  type GraphModel,
} from "./graph-model";
import { ScopeGlyph } from "./scope-glyph";
import { HighlightStore, useHighlightSet, useNodeHighlight } from "./use-highlight";
import {
  buildScene,
  dirId,
  FOCUS,
  groupId,
  HEADING_H,
  nothingFurtherOut,
  routeSentence,
  timesWord,
  type ChipItem,
  type GroupItem,
  type SceneEdge,
  type SceneState,
  type SummaryItem,
} from "./flow-scene";

export type FlowActions = {
  setPin: (pin: { dir: Dir; id: string } | null) => void;
  toggleList: (dir: Dir, parentId: string) => void;
  bring: (dir: Dir, id: string) => void;
  reset: () => void;
};

type Ctx = FlowActions & {
  focusName: string;
  store: HighlightStore;
  hover: (flowId: string | null) => void;
  /** Pans a box that took keyboard focus into view. */
  reveal: (flowId: string) => void;
  /** Focuses the element with this `data-focus-key` once it's drawn. */
  focusNext: (key: string) => void;
};
const FlowCtx = createContext<Ctx | null>(null);
function useFlow(): Ctx {
  const ctx = useContext(FlowCtx);
  if (!ctx) throw new Error("FlowCtx missing");
  return ctx;
}

/** Most the view zooms out: Fit, and any fit on a phone. */
const MIN_ZOOM = 0.3;
/** Least zoom a fit uses on a wider screen. */
const READABLE_ZOOM = 0.8;
const HOVER_DELAY_MS = 120;

const usesWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? "use" : "uses"}`;
const componentsWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? "component" : "components"}`;
const componentHref = (repoId: string, id: string) =>
  `/repos/${encodeURIComponent(repoId)}/components/${encodeURIComponent(id)}?tab=composition`;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type ChipData = { item: ChipItem; fragment: string | null; pinned: boolean; dim: boolean };
type GroupData = { item: GroupItem; parentName: string; dim: boolean };
type SummaryData = { item: SummaryItem };

function chipLabel(item: ChipItem, focusName: string): string {
  const { node } = item;
  const relation =
    item.steps === 1
      ? item.dir === "up"
        ? `Renders ${focusName} ${timesWord(item.usesToInner)}`
        : `${focusName} renders it ${timesWord(item.usesToInner)}`
      : `${item.steps} steps from ${focusName}`;
  const what = `${node.displayName}, ${node.scope}${node.deprecated ? ", deprecated" : ""}, ${pathValueOf(node)}`;
  return `${what}. ${relation}.`;
}

const ChipNode = memo(function ChipNode({ id, data }: NodeProps) {
  const { item, fragment, pinned, dim } = data as unknown as ChipData;
  const { setPin, hover, reveal, focusNext, store, focusName } = useFlow();
  const lit = useNodeHighlight(store, id) === "chain";
  const isFocus = item.id === FOCUS;
  const node = item.node;
  return (
    <div
      className={cn(
        "relative flex items-center rounded-md border bg-card shadow-xs transition-[opacity,border-color] duration-150",
        (isFocus || pinned) && "border-foreground ring-1 ring-foreground",
        lit && !pinned && !isFocus && "border-foreground/60",
        dim && "opacity-35",
      )}
      style={{ width: item.w, height: item.h }}
    >
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <button
        type="button"
        data-focus-key={`chip:${id}`}
        disabled={isFocus}
        aria-pressed={isFocus ? undefined : pinned}
        aria-label={
          isFocus
            ? `${node.displayName}, ${node.scope}, ${pathValueOf(node)}. The component this page is about.`
            : chipLabel(item, focusName)
        }
        onClick={() => {
          if (!item.dir) return;
          if (pinned && item.steps > 1 && item.innerId) focusNext(`chip:${item.innerId}`);
          setPin(pinned ? null : { dir: item.dir, id: node.id });
        }}
        onFocus={(e) => {
          hover(id);
          if (e.currentTarget.matches(":focus-visible")) reveal(id);
        }}
        onBlur={() => hover(null)}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-[5px] px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          isFocus ? "cursor-default" : "cursor-pointer",
        )}
      >
        <ScopeGlyph scope={node.scope} />
        <span className={cn("min-w-0 truncate font-mono text-xs", isFocus && "font-semibold")}>{node.displayName}</span>
        {node.deprecated ? <DeprecatedMark /> : null}
        {fragment ? (
          <span className="min-w-0 shrink truncate font-mono text-xs text-muted-foreground">{`· ${fragment}`}</span>
        ) : null}
      </button>
      <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />
    </div>
  );
});

const MoreNode = memo(function MoreNode({ id, data }: NodeProps) {
  const { item, parentName, dim } = data as unknown as GroupData;
  const { toggleList, focusNext, reveal } = useFlow();
  const n = item.members.length;
  const label =
    item.dir === "up"
      ? `Show the other ${componentsWord(n)} that ${n === 1 ? "renders" : "render"} ${parentName}`
      : `Show the other ${componentsWord(n)} ${parentName} renders`;
  return (
    <div className={cn("relative transition-opacity duration-150", dim && "opacity-35")} style={{ width: item.w, height: item.h }}>
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <button
        type="button"
        data-focus-key={id}
        aria-label={label}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) reveal(id);
        }}
        onClick={() => {
          focusNext(`filter:${groupId("list", item.dir, item.parentRealId)}`);
          toggleList(item.dir, item.parentRealId);
        }}
        className="flex size-full cursor-pointer items-center justify-between gap-2 rounded-md border border-dashed bg-muted px-2 text-xs text-muted-foreground transition-[color,background-color,scale] duration-150 hover:bg-card hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="font-medium text-foreground">{`+${n.toLocaleString()} more`}</span>
        <span>Show</span>
      </button>
      <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />
    </div>
  );
});

const ListNode = memo(function ListNode({ id, data }: NodeProps) {
  const { item, parentName } = data as unknown as GroupData;
  const { toggleList, bring, setPin, focusNext } = useFlow();
  const [query, setQuery] = useState("");
  const tails = useMemo(() => distinctTails(item.members.map((m) => pathValueOf(m.node))), [item.members]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return item.members
      .map((m, i) => ({ m, tail: tails[i] ?? "" }))
      .filter(({ m }) => !q || m.node.displayName.toLowerCase().includes(q) || pathValueOf(m.node).toLowerCase().includes(q));
  }, [item.members, tails, query]);
  const n = item.members.length;
  const heading =
    item.dir === "up"
      ? `${n.toLocaleString()} more ${n === 1 ? "renders" : "render"} ${parentName}`
      : `${parentName} renders ${n.toLocaleString()} more`;
  const close = () => {
    focusNext(groupId("more", item.dir, item.parentRealId));
    toggleList(item.dir, item.parentRealId);
  };
  return (
    <fieldset
      aria-label={heading}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        close();
      }}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm"
      style={{ width: item.w, height: item.h }}
    >
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted px-2.5 py-1.5">
        <span className="line-clamp-2 min-w-0 text-xs">
          <span className="font-medium">{heading}</span>
          <span className="text-muted-foreground">{` · ${usesWord(item.uses)}`}</span>
        </span>
        <button
          type="button"
          aria-label="Close this list"
          onClick={close}
          className="nodrag shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="nodrag shrink-0 border-b px-2 py-1.5">
        <input
          type="text"
          data-focus-key={`filter:${id}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or file"
          aria-label={`Filter the ${componentsWord(n)}`}
          className="h-7 w-full rounded-md border bg-transparent px-2 font-mono text-xs placeholder:font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      <ul className="nowheel nodrag nopan min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain">
        {rows.map(({ m, tail }) => (
          <li key={m.node.id}>
            <button
              type="button"
              onClick={() => {
                focusNext(`chip:${dirId(item.dir, m.node.id)}`);
                bring(item.dir, m.node.id);
                setPin({ dir: item.dir, id: m.node.id });
              }}
              aria-label={`${m.node.displayName}, ${pathValueOf(m.node)}, ${usesWord(m.uses)}. Show it in the diagram.`}
              className="flex w-full cursor-pointer flex-col gap-0.5 px-2.5 py-1.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <ScopeGlyph scope={m.node.scope} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.node.displayName}</span>
                {m.node.deprecated ? <DeprecatedMark /> : null}
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{usesWord(m.uses)}</span>
              </span>
              <span className="min-w-0 truncate text-left text-[11px] text-muted-foreground [direction:rtl]">
                <bdi dir="ltr">{tail}</bdi>
              </span>
            </button>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-3 py-4 text-center text-xs text-muted-foreground">No matches.</li> : null}
      </ul>
      <div className="shrink-0 border-t px-2.5 py-1 text-[11px] text-muted-foreground">
        {query.trim() ? `${rows.length.toLocaleString()} of ${n.toLocaleString()}` : `All ${n.toLocaleString()} listed`}
      </div>
      <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />
    </fieldset>
  );
});

const SummaryNode = memo(function SummaryNode({ data }: NodeProps) {
  const { item } = data as unknown as SummaryData;
  const { setPin } = useFlow();
  const what = item.dir === "up" ? "Rendered by" : "Renders";
  const counts = `${item.direct.toLocaleString()} directly · ${item.total.toLocaleString()} in total`;
  return (
    <div style={{ width: item.w, height: item.h }}>
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <button
        type="button"
        onClick={() => setPin(null)}
        aria-label={`${what} ${item.direct.toLocaleString()} directly, ${item.total.toLocaleString()} in total. Clear the selection to show them.`}
        className="flex size-full cursor-pointer flex-col items-start justify-center rounded-md border border-dashed bg-muted px-2.5 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="text-label">{what}</span>
        <span>{counts}</span>
      </button>
      <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />
    </div>
  );
});

const nodeTypes: NodeTypes = { chip: ChipNode, more: MoreNode, list: ListNode, summary: SummaryNode };

type CanvasControls = { fit: () => void; home: () => void };

type CanvasInnerProps = {
  model: GraphModel;
  focusId: string;
  routes: BothRoutes;
  state: SceneState;
  actions: FlowActions;
  phone: boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  controlsRef: RefObject<CanvasControls | null>;
};

function CanvasInner({ model, focusId, routes, state, actions, phone, overlayRef, controlsRef }: CanvasInnerProps) {
  const { fitView, getViewport, setCenter } = useReactFlow();
  const resolvedTheme = useResolvedTheme();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const focusName = model.byId.get(focusId)?.displayName ?? "";

  const scene = useMemo(() => buildScene(model, focusId, routes, state), [model, focusId, routes, state]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selected = scene.pathIds.size > 0;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const pinFlowId = state.pin ? dirId(state.pin.dir, state.pin.id) : null;

  // The box each item hangs off, toward the focus.
  const innerOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of scene.items) {
      if (i.kind === "chip" && i.innerId) m.set(i.id, i.innerId);
      if (i.kind === "more" || i.kind === "list") m.set(i.id, i.parentId);
    }
    return m;
  }, [scene]);
  // What the selected box opened: the column one step further out from it.
  const revealed = useMemo(
    () => new Set(pinFlowId ? [...innerOf].filter(([, inner]) => inner === pinFlowId).map(([id]) => id) : []),
    [innerOf, pinFlowId],
  );
  const innerOfRef = useRef(innerOf);
  innerOfRef.current = innerOf;

  const store = useMemo(() => new HighlightStore(), []);
  useEffect(() => {
    store.setOverride(null);
    store.setBase(selected ? scene.pathIds : null);
  }, [store, scene, selected]);
  const active = useHighlightSet(store);

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const hover = useCallback(
    (flowId: string | null) => {
      clearTimeout(hoverTimer.current);
      if (flowId === null || flowId === FOCUS || selectedRef.current) {
        store.setOverride(null);
        return;
      }
      hoverTimer.current = setTimeout(() => {
        const ids = new Set([flowId, FOCUS]);
        for (let at = innerOfRef.current.get(flowId); at; at = innerOfRef.current.get(at)) ids.add(at);
        store.setOverride(ids);
      }, HOVER_DELAY_MS);
    },
    [store],
  );

  const nodes = useMemo<FlowNode[]>(() => {
    const chips = scene.items.filter((i): i is ChipItem => i.kind === "chip");
    const fragments = chipFaceFragments(chips.map((c) => ({ name: c.node.displayName, path: pathValueOf(c.node) })));
    const fragmentOf = new Map(chips.map((c, i) => [c.id, fragments[i] ?? null]));
    const nameOf = (flowId: string) => chips.find((c) => c.id === flowId)?.node.displayName ?? "";
    return scene.items.map((item): FlowNode => {
      const dim = selected && !scene.pathIds.has(item.id) && !revealed.has(item.id);
      const base = {
        id: item.id,
        position: { x: item.x, y: item.y },
        width: item.w,
        height: item.h,
        draggable: false,
        selectable: false,
        focusable: false,
      };
      if (item.kind === "chip") {
        const data: ChipData = { item, fragment: fragmentOf.get(item.id) ?? null, pinned: item.id === pinFlowId, dim };
        return { ...base, type: "chip", data };
      }
      if (item.kind === "summary") return { ...base, type: "summary", data: { item } satisfies SummaryData };
      return { ...base, type: item.kind, data: { item, parentName: nameOf(item.parentId), dim } satisfies GroupData };
    });
  }, [scene, selected, pinFlowId, revealed]);

  const edges = useMemo<FlowEdge[]>(() => {
    return scene.edges.map((e: SceneEdge) => {
      const lit = Boolean(active?.has(e.source) && active.has(e.target));
      const color = lit ? "var(--foreground)" : "var(--faint)";
      const width = e.count >= 50 ? 2.5 : e.count >= 10 ? 2 : 1.25;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        focusable: false,
        selectable: false,
        ariaLabel: e.label,
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
        style: {
          stroke: color,
          strokeWidth: lit ? width + 0.5 : width,
          opacity: !lit && selected && !revealed.has(e.source) && !revealed.has(e.target) ? 0.25 : 1,
        },
      };
    });
  }, [scene, active, selected, revealed]);

  // Room above the boxes for the overlay (Find and the route bar) and the
  // column headings.
  const topClearance = useCallback(() => {
    const overlay = overlayRef.current;
    const below = overlay && overlay.childElementCount > 0 ? overlay.offsetTop + overlay.offsetHeight : 0;
    return below + HEADING_H + 12;
  }, [overlayRef]);

  const frame = useCallback(
    (ids: string[] | null, duration: number, minZoom: number) => {
      requestAnimationFrame(() =>
        fitView({
          ...(ids ? { nodes: ids.map((id) => ({ id })) } : {}),
          padding: { top: `${topClearance()}px`, right: "28px", bottom: "28px", left: "28px" },
          maxZoom: 1,
          minZoom,
          duration,
        }),
      );
    },
    [fitView, topClearance],
  );

  // The whole scene when it fits at a readable zoom, otherwise the selected
  // route or what just opened. A phone fits the whole scene at any zoom.
  const justOpened = useRef<string[] | null>(null);
  const reframe = (duration: number) => {
    if (phone) {
      frame(null, duration, MIN_ZOOM);
      return;
    }
    const el = shellRef.current;
    const xs = scene.items.flatMap((i) => [i.x, i.x + i.w]);
    const ys = scene.items.flatMap((i) => [i.y, i.y + i.h]);
    const fits =
      !el ||
      Math.min(
        (el.clientWidth - 56) / (Math.max(...xs) - Math.min(...xs)),
        (el.clientHeight - topClearance() - 28) / (Math.max(...ys) - Math.min(...ys)),
      ) >= READABLE_ZOOM;
    if (fits) {
      frame(null, duration, READABLE_ZOOM);
      return;
    }
    if (selected) {
      const around = scene.items.filter((i) => i.kind === "summary" || (pinFlowId !== null && innerOf.get(i.id) === pinFlowId));
      frame([...scene.pathIds, ...around.map((i) => i.id)], duration, READABLE_ZOOM);
      return;
    }
    const target = justOpened.current ?? scene.items.filter((i) => i.kind === "list").map((i) => i.id);
    justOpened.current = null;
    if (target.length > 0) {
      const near = scene.items.filter((i) => target.includes(i.id) || target.includes(innerOf.get(i.id) ?? "")).map((i) => i.id);
      const inner = target.map((t) => innerOf.get(t)).filter((t): t is string => t !== undefined);
      frame([...near, ...inner], duration, READABLE_ZOOM);
      return;
    }
    frame(null, duration, READABLE_ZOOM);
  };
  const reframeRef = useRef(reframe);
  reframeRef.current = reframe;
  const sceneKey = `${[...state.lists].join()}|${[...state.brought].join()}|${pinFlowId ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-frame only when what's drawn changes
  useEffect(() => {
    reframeRef.current(prefersReducedMotion() ? 0 : 250);
  }, [sceneKey]);

  controlsRef.current = {
    fit: () => frame(null, prefersReducedMotion() ? 0 : 150, MIN_ZOOM),
    home: () => reframeRef.current(prefersReducedMotion() ? 0 : 150),
  };

  const reveal = useCallback(
    (flowId: string) => {
      const el = shellRef.current;
      const item = sceneRef.current.items.find((i) => i.id === flowId);
      if (!el || !item) return;
      const { x, y, zoom } = getViewport();
      const left = item.x * zoom + x;
      const top = item.y * zoom + y;
      const inView =
        left >= 0 && left + item.w * zoom <= el.clientWidth && top >= topClearance() && top + item.h * zoom <= el.clientHeight;
      if (!inView) setCenter(item.x + item.w / 2, item.y + item.h / 2, { zoom, duration: prefersReducedMotion() ? 0 : 200 });
    },
    [getViewport, setCenter, topClearance],
  );

  const pendingFocus = useRef<string | null>(null);
  const focusNext = useCallback((key: string) => {
    pendingFocus.current = key;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a pending focus lands once the new boxes are drawn
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      const target = shellRef.current?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
      if (target) {
        pendingFocus.current = null;
        target.focus({ preventScroll: true });
      } else if (++tries < 5) {
        raf = requestAnimationFrame(attempt);
      }
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [nodes]);

  const ctx = useMemo<Ctx>(
    () => ({
      ...actions,
      toggleList: (dir, parentId) => {
        justOpened.current = [groupId("list", dir, parentId), groupId("more", dir, parentId)];
        actions.toggleList(dir, parentId);
      },
      focusName,
      store,
      hover,
      reveal,
      focusNext,
    }),
    [actions, focusName, store, hover, reveal, focusNext],
  );

  useEffect(() => {
    shellRef.current?.querySelector(".react-flow")?.setAttribute("role", "group");
  }, []);

  return (
    <FlowCtx.Provider value={ctx}>
      <div ref={shellRef} className="composition-canvas h-full">
        <ReactFlow
          aria-label="Composition diagram"
          colorMode={resolvedTheme}
          style={{ background: "transparent" }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={() => reframeRef.current(0)}
          minZoom={MIN_ZOOM}
          maxZoom={1.5}
          nodesFocusable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{
            "node.a11yDescription.default": "",
            "node.a11yDescription.keyboardDisabled": "",
            "edge.a11yDescription.default": "",
          }}
          onNodeMouseEnter={(_, n) => hover(n.type === "chip" ? n.id : null)}
          onNodeMouseLeave={() => hover(null)}
          onPaneClick={() => {
            if (state.pin) actions.setPin(null);
          }}
        >
          <ViewportPortal>
            {scene.headings.map((h) => (
              <div
                key={`${h.x}:${h.text}`}
                aria-hidden
                className="whitespace-nowrap text-label text-muted-foreground"
                style={{
                  position: "absolute",
                  transform: `translate(${h.x}px, ${h.y}px) translateX(${h.x <= 0 ? "-100%" : "0"})`,
                }}
              >
                {h.text}
              </div>
            ))}
          </ViewportPortal>
        </ReactFlow>
      </div>
    </FlowCtx.Provider>
  );
}

function RouteBar({
  row,
  note,
  repoId,
  onClear,
}: { row: FindRow; note: string | null; repoId: string; onClear: () => void }) {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-2.5 py-1.5 text-xs shadow-sm">
      <div className="min-w-0 flex-1 basis-64">
        <div className="text-muted-foreground [overflow-wrap:anywhere]">
          {row.steps === 1 ? "Directly" : `${row.steps} steps away`}
          <span className="text-code">{` · ${pathValueOf(row.node)}`}</span>
        </div>
        <p className="text-pretty">{[routeSentence(row.chain, row.uses), note].filter(Boolean).join(" ")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Link
          href={componentHref(repoId, row.node.id)}
          prefetch={false}
          className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {`Open ${row.node.displayName}`}
        </Link>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the selection (Escape)"
          className="cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

function FindBox({
  up,
  down,
  focusName,
  onPick,
  inline = false,
}: {
  up: FindRow[];
  down: FindRow[];
  focusName: string;
  onPick: (row: FindRow) => void;
  /** Always open, filling its container, rather than a dropdown. */
  inline?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setOpen] = useState(false);
  const open = inline || isOpen;
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const all = useMemo(() => [...up, ...down], [up, down]);
  const tails = useMemo(() => distinctTails(all.map((r) => pathValueOf(r.node))), [all]);
  const tailOf = useMemo(() => new Map(all.map((r, i) => [r, tails[i] ?? ""])), [all, tails]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.node.displayName.toLowerCase().includes(q) ||
        pathValueOf(r.node).toLowerCase().includes(q) ||
        r.chain.some((n) => n.toLowerCase().includes(q)),
    );
  }, [all, query]);
  useEffect(() => {
    if (!isOpen || inline) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isOpen, inline]);

  const groups: { title: string; rows: FindRow[] }[] = [];
  for (const r of rows) {
    const side = r.dir === "up" ? "Rendered by" : "Renders";
    const title = r.steps === 1 ? `${side} · directly` : `${side} · ${r.steps} steps away`;
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.rows.push(r);
    else groups.push({ title, rows: [r] });
  }
  const totalOf = (dir: Dir, steps: number) => (dir === "up" ? up : down).filter((r) => r.steps === steps).length;
  const pick = (r: FindRow) => {
    onPick(r);
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const summary = [
    up.length > 0 ? `${up.length.toLocaleString()} render ${focusName}` : null,
    down.length > 0 ? `${focusName} renders ${down.length.toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  let index = -1;
  return (
    <div ref={boxRef} className={cn("relative", inline ? "flex h-full flex-col" : "w-80 max-w-full")}>
      <div className={cn(inline && "shrink-0 border-b p-2")}>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="composition-find-list"
          aria-activedescendant={open && rows[active] ? `find-${active}` : undefined}
          aria-label={`Find a component that renders ${focusName} or that it renders`}
          placeholder="Find a component or a file…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && rows[active]) {
              e.preventDefault();
              pick(rows[active] as FindRow);
            } else if (e.key === "Escape" && isOpen && !inline) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="h-8 w-full rounded-lg border bg-card px-2.5 font-mono text-xs shadow-sm placeholder:font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      {open ? (
        <div
          className={cn(
            "overflow-hidden bg-card",
            inline
              ? "flex min-h-0 flex-1 flex-col"
              : "absolute left-0 top-full z-20 mt-1 w-[26rem] max-w-[calc(100vw-3rem)] rounded-lg border shadow-lg",
          )}
        >
          <div className="shrink-0 border-b bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            {query.trim() ? `${rows.length.toLocaleString()} of ${all.length.toLocaleString()} match` : summary}
          </div>
          <div
            id="composition-find-list"
            // biome-ignore lint/a11y/useSemanticElements: an ARIA combobox list of rich rows
            role="listbox"
            tabIndex={-1}
            className={cn("nowheel overflow-y-auto overscroll-contain", inline ? "min-h-0 flex-1" : "max-h-80")}
          >
            {groups.map((g) => (
              <div
                key={g.title}
                // biome-ignore lint/a11y/useSemanticElements: a group of options inside the combobox list
                role="group"
                aria-label={g.title}
              >
                <div className="sticky top-0 z-10 flex justify-between border-b bg-card/95 px-2.5 py-1 text-label text-muted-foreground backdrop-blur-sm">
                  <span>{g.title}</span>
                  <span className="tabular-nums">
                    {query.trim()
                      ? `${g.rows.length.toLocaleString()} of ${totalOf(g.rows[0]?.dir as Dir, g.rows[0]?.steps as number).toLocaleString()}`
                      : g.rows.length.toLocaleString()}
                  </span>
                </div>
                <div className="divide-y">
                  {g.rows.map((r) => {
                    index += 1;
                    const i = index;
                    return (
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input handles the keys for every option
                      <div
                        key={`${r.dir}:${r.node.id}`}
                        id={`find-${i}`}
                        // biome-ignore lint/a11y/useSemanticElements: an ARIA combobox option of rich content
                        role="option"
                        aria-selected={i === active}
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(r)}
                        onMouseEnter={() => setActive(i)}
                        className={cn("flex cursor-pointer flex-col gap-0.5 px-2.5 py-1.5", i === active && "bg-muted")}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ScopeGlyph scope={r.node.scope} />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.node.displayName}</span>
                          {r.node.deprecated ? <DeprecatedMark /> : null}
                        </span>
                        <span className="min-w-0 truncate text-left text-[11px] text-muted-foreground [direction:rtl]">
                          <bdi dir="ltr">{tailOf.get(r) ?? ""}</bdi>
                        </span>
                        {r.steps > 1 ? (
                          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{r.chain.join(" → ")}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {rows.length === 0 ? <div className="px-3 py-4 text-center text-xs text-muted-foreground">No matches.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type FlowCanvasProps = {
  model: GraphModel;
  focusId: string;
  repoId: string;
  routes: BothRoutes;
  state: SceneState;
  actions: FlowActions;
  caption: string;
};

export function FlowCanvas({ model, focusId, repoId, routes, state, actions, caption }: FlowCanvasProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const phone = useMedia("(max-width: 639px)");
  const [view, setView] = useState<"list" | "diagram">("list");
  const showDiagram = !phone || view === "diagram";
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<CanvasControls | null>(null);
  const focusName = model.byId.get(focusId)?.displayName ?? "";

  const up = useMemo(() => findRows(model, focusId, routes.up, "up"), [model, focusId, routes]);
  const down = useMemo(() => findRows(model, focusId, routes.down, "down"), [model, focusId, routes]);
  const pin = state.pin;
  const pinRow = useMemo(
    () => (pin ? (pin.dir === "up" ? up : down).find((r) => r.node.id === pin.id) : undefined),
    [pin, up, down],
  );

  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const name = pinRow?.node.displayName ?? null;
    if (name) setAnnouncement(`Showing the route to ${name}`);
    else if (announced.current) setAnnouncement("Route cleared");
    announced.current = name;
  }, [pinRow]);

  const pick = (r: FindRow) => {
    actions.setPin({ dir: r.dir, id: r.node.id });
    setView("diagram");
  };
  const empty = !state.pin && state.lists.size === 0 && state.brought.size === 0;
  const control =
    "cursor-pointer rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground transition-[color,scale] duration-150 hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <ReactFlowProvider>
      <section
        aria-label="Composition"
        className="panel flex flex-col overflow-hidden lg:h-full lg:min-w-0 lg:flex-1"
        onKeyDown={(e) => {
          if (e.key === "Escape" && state.pin) actions.setPin(null);
        }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted px-3 py-2 max-sm:flex-wrap">
          <p className="min-w-0 text-pretty text-sm">{caption}</p>
          {showDiagram ? (
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" className={control} onClick={() => controlsRef.current?.fit()}>
                Fit
              </button>
              <button
                type="button"
                className={control}
                onClick={() => (empty ? controlsRef.current?.home() : actions.reset())}
              >
                Reset
              </button>
            </div>
          ) : null}
        </header>
        {phone ? (
          <div className="shrink-0 border-b px-3 py-2">
            <ToggleGroup
              value={[view]}
              onValueChange={(v) => {
                if (v[0]) setView(v[0] as "list" | "diagram");
              }}
              variant="outline"
              size="sm"
              multiple={false}
              aria-label="View"
            >
              <ToggleGroupItem value="list">List</ToggleGroupItem>
              <ToggleGroupItem value="diagram">Diagram</ToggleGroupItem>
            </ToggleGroup>
          </div>
        ) : null}
        <div className="relative h-[34rem] bg-background lg:h-auto lg:min-h-0 lg:flex-1">
          {showDiagram ? (
            <>
              <div
                ref={overlayRef}
                className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-wrap items-start gap-2 *:pointer-events-auto"
              >
                {phone ? null : <FindBox up={up} down={down} focusName={focusName} onPick={pick} />}
                {pinRow ? (
                  <RouteBar
                    row={pinRow}
                    note={nothingFurtherOut(model, routes[pinRow.dir], pinRow.dir, pinRow.node.id)}
                    repoId={repoId}
                    onClear={() => actions.setPin(null)}
                  />
                ) : null}
              </div>
              {mounted ? (
                <CanvasInner
                  model={model}
                  focusId={focusId}
                  routes={routes}
                  state={state}
                  actions={actions}
                  phone={phone}
                  overlayRef={overlayRef}
                  controlsRef={controlsRef}
                />
              ) : null}
            </>
          ) : (
            <FindBox up={up} down={down} focusName={focusName} onPick={pick} inline />
          )}
        </div>
        {showDiagram ? (
          <footer className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
            {(["local", "external"] as const).map((scope) => (
              <span key={scope} title={ORIGIN_DESCRIPTION[scope]} className="flex items-center gap-1.5 whitespace-nowrap">
                <ScopeGlyph scope={scope} />
                {ORIGIN_LABEL[scope]}
              </span>
            ))}
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <svg aria-hidden="true" width="22" height="8" className="shrink-0">
                <line x1="0" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M15 1 L21 4 L15 7 Z" fill="currentColor" />
              </svg>
              renders
            </span>
          </footer>
        ) : null}
        <output className="sr-only">{announcement}</output>
      </section>
    </ReactFlowProvider>
  );
}
