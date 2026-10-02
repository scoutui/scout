"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  useReactFlow,
  ViewportPortal,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useResolvedTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { pathValueOf, type GraphModel } from "./graph-model";
import { buildEdgeTips, deriveHighlight, edgeStyle, type EdgeTip } from "./graph-highlight";
import { computeLayout, COLUMN_CAP, GAP_X, NODE_H, NODE_W, type PinnedEntry } from "./graph-layout";
import {
  chipFaceFragments,
  computeDefaultFrame,
  computeRowBudget,
  COLUMN_LABEL_OFFSET_Y,
  distinctTails,
  edgePillCopy,
  FIT_PADDING,
  gutterMaskWidth,
  hiddenColumns,
  isNodeVisible,
  isPathVisible,
  PINNED_FIT_ZOOM,
  shouldRecomputeEdgeAffordances,
  WINDOW_ZOOM,
} from "./graph-framing";
import { HighlightStore, useHighlightSet, useNodeHighlight } from "./use-highlight";
import { ScopeGlyph } from "./scope-glyph";
import { DeprecatedMark } from "@/components/deprecated-mark";

type ChipData = {
  /** Bare display name, shown on the chip face and in the tooltip header. */
  name: string;
  /** Disambiguating path fragment (see `chipFaceFragments`), rendered in its
   *  own span after `name` so it survives truncation of a long name. `null`
   *  when the name needs no disambiguation. */
  fragment: string | null;
  scope: "external" | "local";
  deprecated: boolean;
  /** Full, untruncated path or package, used for `ariaLabel`. Empty only when
   *  the node has neither a file path nor a package name (see `pathValueOf`). */
  detail: string;
  /** Visible tooltip text only, shortened by `distinctTails` against every
   *  other chip's detail in the scene. The accessible name uses `detail`. */
  detailLabel: string | null;
  occurrenceCount: number;
  isFocus: boolean;
  href: string | null;
  ariaLabel: string;
};

type MoreData = {
  label: string;
  /** Native `title` text: how many components the chip stands for and where to
   *  read them, since the chip does nothing on click. */
  title: string;
};

/** Handlers node components read via context, so a hover flip never changes
 *  node `data` identity. Only the affected node's `useNodeHighlight`
 *  subscription re-renders. */
type HighlightHandlers = {
  store: HighlightStore;
  traceDisplayId: (id: string) => void;
  focusNode: (id: string) => void;
  clearTrace: () => void;
};
const HighlightCtx = createContext<HighlightHandlers | null>(null);

function useHighlightHandlers(): HighlightHandlers {
  const ctx = useContext(HighlightCtx);
  if (!ctx) throw new Error("HighlightCtx missing");
  return ctx;
}

function ChipNode({ id, data }: NodeProps) {
  const d = data as unknown as ChipData;
  const { store, focusNode, clearTrace } = useHighlightHandlers();
  const highlight = useNodeHighlight(store, id, d.isFocus);
  const scopeWord = d.scope === "external" ? "external" : "local";
  // The focus chip has nowhere to navigate to, so it gets no link cursor or
  // hover underline.
  const isLink = d.href !== null;
  const body = (
    <>
      <ScopeGlyph scope={d.scope} />
      {/* The deprecated mark sits against the name and stays visible when the
          name truncates. */}
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span
          className={cn(
            "min-w-0 truncate font-mono text-xs",
            isLink && "cursor-pointer hover:underline",
          )}
        >
          {d.name}
        </span>
        {d.deprecated ? <DeprecatedMark /> : null}
      </span>
      {d.fragment ? (
        <span
          className={cn(
            "shrink-0 truncate font-mono text-xs text-muted-foreground",
            // The deprecated mark's width comes out of the fragment, not the name.
            d.deprecated ? "max-w-[calc(55%-1.125rem)]" : "max-w-[55%]",
          )}
        >{`· ${d.fragment}`}</span>
      ) : null}
    </>
  );
  const trigger = d.href ? (
    <Link
      href={d.href}
      prefetch={false}
      aria-label={d.ariaLabel}
      onFocus={() => focusNode(id)}
      onBlur={clearTrace}
      className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {body}
    </Link>
  ) : (
    // The focus chip has no link to take focus, so it needs a tabIndex for its
    // tooltip (the only place its scope, path and call-site count appear) to
    // open from the keyboard.
    <span
      // biome-ignore lint/a11y/noNoninteractiveTabindex: tooltip trigger for the focus chip, which is non-navigable by design
      tabIndex={0}
      aria-label={d.ariaLabel}
      onFocus={() => focusNode(id)}
      onBlur={clearTrace}
      className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {body}
    </span>
  );
  return (
    <div
      className={cn(
        "flex items-center rounded-md border bg-card motion-safe:transition-opacity",
        d.isFocus && "ring-2 ring-foreground",
        highlight === "dim" && "opacity-30",
      )}
      style={{ width: NODE_W, height: 28 }}
    >
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      <Tooltip>
        <TooltipTrigger render={trigger} />
        {/* One max width for every line, including the unwrapped mono detail
            line, so the box never grows to that line's width. */}
        <TooltipContent className="max-w-64">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono">{d.name}</span>
            <span className="truncate text-code text-muted-foreground">
              {d.detailLabel ? `${scopeWord} · ${d.detailLabel}` : scopeWord}
            </span>
            {d.deprecated ? <span className="text-status-warn-text">deprecated</span> : null}
            <span className="text-muted-foreground">
              {d.occurrenceCount === 1
                ? "1 call site"
                : `${d.occurrenceCount.toLocaleString()} call sites`}
            </span>
            {d.href ? <span className="text-muted-foreground">click to open</span> : null}
          </div>
        </TooltipContent>
      </Tooltip>
      <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />
    </div>
  );
}

/** The overflow chip: a plain label, not a control. The components it stands
 *  for are in the rail's list on the left, so it takes no click and no focus.
 *  It keeps its aggregated edges (graph-layout.ts) and its place in the
 *  column. */
function MoreNode({ id, data }: NodeProps) {
  const d = data as unknown as MoreData;
  const { store } = useHighlightHandlers();
  const highlight = useNodeHighlight(store, id);
  return (
    <div
      title={d.title}
      className={cn(
        "flex items-center rounded-md border border-dashed bg-muted px-2 text-xs text-muted-foreground motion-safe:transition-opacity",
        highlight === "dim" && "opacity-30",
      )}
      style={{ width: NODE_W, height: 28 }}
    >
      <Handle type="target" position={Position.Left} className="!pointer-events-none !opacity-0" />
      {d.label}
      <Handle type="source" position={Position.Right} className="!pointer-events-none !opacity-0" />
    </div>
  );
}

const nodeTypes: NodeTypes = { chip: ChipNode, more: MoreNode };

/** Widest an edge tooltip may grow. Shared by the box and the clamp that keeps
 *  it inside the canvas. */
const EDGE_TIP_W = 288;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fit the whole graph, or reset to the default frame. Shared by the edge pills
 *  and the header's Reset view button, so both clear stale `hiddenCols`
 *  pills. */
type CanvasActionsRef = { current: { fitAll: (duration: number) => void; resetView: (duration: number) => void } };

function CanvasInner({
  model,
  focusId,
  repoId,
  pinned,
  hoverPath,
  colorMode,
  onRelease,
  actionsRef,
}: {
  model: GraphModel;
  focusId: string;
  repoId: string;
  pinned: PinnedEntry[] | null;
  hoverPath: string[] | null;
  colorMode: "light" | "dark";
  onRelease: () => void;
  actionsRef: CanvasActionsRef;
}) {
  const { fitView, setCenter, getViewport } = useReactFlow();
  const [store] = useState(() => new HighlightStore());
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [hiddenCols, setHiddenCols] = useState({ left: 0, right: 0 });
  // Width of the gutter mask on each side with hidden columns. At the default
  // frame it comes from `frame.maskLeft`/`frame.maskRight`, which can never
  // reach the included column they border (see computeDefaultFrame). After a
  // user pan or zoom, `gutterMaskWidth` of the live zoom sets both sides.
  const [maskWidth, setMaskWidth] = useState(() => ({
    left: gutterMaskWidth(WINDOW_ZOOM),
    right: gutterMaskWidth(WINDOW_ZOOM),
  }));
  // Whether the viewport is the default frame, where an edge pill offers
  // fitAll instead of a reset that would do nothing. `lastMoveIsDefaultRef` is
  // set before each of applyViewport's camera moves and consumed by the next
  // onMoveEnd, so only a user pan or zoom flips `atDefaultFrame` to false.
  const lastMoveIsDefaultRef = useRef(false);
  const [atDefaultFrame, setAtDefaultFrame] = useState(true);
  // Row cap from the pane height. COLUMN_CAP until the resize observer
  // measures the pane; jsdom's ResizeObserver never fires, so tests see
  // COLUMN_CAP.
  const [rowBudget, setRowBudget] = useState(COLUMN_CAP);
  // Edges stay out of the accessibility tree (the caption covers them for
  // screen readers), so their tooltip is a plain positioned div.
  const [edgeTip, setEdgeTip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Hover goes through the store only, so it never rebuilds the layout or
  // node `data` identities.
  const layout = useMemo(
    () => computeLayout(model, focusId, { pinned }, rowBudget),
    [model, focusId, pinned, rowBudget],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const traceDisplayId = useCallback(
    (id: string) => store.setOverride(deriveHighlight(layoutRef.current, { kind: "chip", displayId: id })),
    [store],
  );
  const clearTrace = useCallback(() => store.setOverride(null), [store]);

  // Keyboard focus centres a chip that isn't fully in frame, so Tab can reach
  // it. Mouse hover never moves the camera.
  const focusNode = useCallback(
    (id: string) => {
      traceDisplayId(id);
      const item = layoutRef.current.items.find((i) => i.id === id);
      const el = shellRef.current?.querySelector(".react-flow");
      const w = el?.clientWidth ?? 0;
      const h = el?.clientHeight ?? 0;
      if (!item || w === 0) return;
      if (!isNodeVisible(item, getViewport(), w, h)) {
        setCenter(item.x + NODE_W / 2, item.y + NODE_H / 2, {
          zoom: getViewport().zoom,
          duration: prefersReducedMotion() ? 0 : 150,
        });
      }
    },
    [traceDisplayId, getViewport, setCenter],
  );

  const highlightHandlers = useMemo(
    () => ({ store, traceDisplayId, focusNode, clearTrace }),
    [store, traceDisplayId, focusNode, clearTrace],
  );

  // The pinned chain is the base highlight. Every pinned id renders as its own
  // chip (it bypasses the column cap), so the id set is the display set.
  useEffect(() => {
    store.setBase(pinned && pinned.length > 0 ? new Set(pinned.map((p) => p.id)) : null);
  }, [store, pinned]);

  // A hovered rail row's shortest path is an override highlight. `layout` is
  // in the deps so a relayout recomputes an active hover against the new
  // scene.
  // biome-ignore lint/correctness/useExhaustiveDependencies: layout is read via layoutRef.current, but its identity change must still re-run this effect
  useEffect(() => {
    store.setOverride(hoverPath ? deriveHighlight(layoutRef.current, { kind: "path", path: hoverPath }) : null);
  }, [store, hoverPath, layout]);

  const flowNodes = useMemo<FlowNode[]>(() => {
    // One distinctTails pass over every chip's detail in the scene, so the
    // visible tooltip line tells chips apart the same way the rail rows do.
    const chipDetails = layout.items.map((item) =>
      item.kind === "chip" ? pathValueOf(item.node) : "",
    );
    const detailLabels = distinctTails(chipDetails);
    // `null` for every chip except those sharing a name (two `ServerPage`s
    // from different route files), which each get a fragment that tells them
    // apart.
    const faceFragments = chipFaceFragments(
      layout.items.map((item) =>
        item.kind === "chip" ? { name: item.node.displayName, path: pathValueOf(item.node) } : { name: "", path: "" },
      ),
    );
    return layout.items.map((item, i): FlowNode => {
      if (item.kind === "chip") {
        const node = item.node;
        // `pathValueOf` falls back to the package name when a local node has
        // no file path; reading `node.filePath` directly would drop it.
        const detail = pathValueOf(node);
        const detailLabel = detail !== "" ? (detailLabels[i] ?? null) : null;
        const scopeWord = node.scope === "external" ? "external" : "local";
        return {
          id: item.id,
          type: "chip",
          position: { x: item.x, y: item.y },
          draggable: false,
          focusable: false,
          data: {
            name: node.displayName,
            fragment: faceFragments[i] ?? null,
            scope: node.scope,
            deprecated: node.deprecated,
            detail,
            detailLabel,
            occurrenceCount: node.occurrenceCount,
            isFocus: item.isFocus,
            href: item.isFocus
              ? null
              : `/repos/${encodeURIComponent(repoId)}/components/${encodeURIComponent(node.id)}?tab=composition`,
            ariaLabel: [node.displayName, scopeWord, node.deprecated ? "deprecated" : null, detail]
              .filter(Boolean)
              .join(", "),
          } satisfies ChipData,
        };
      }
      return {
        id: item.id,
        type: "more",
        position: { x: item.x, y: item.y },
        draggable: false,
        focusable: false,
        data: {
          label: item.label,
          title: `${item.nodes.length.toLocaleString()} more, listed on the left.`,
        } satisfies MoreData,
      };
    });
  }, [layout, repoId]);

  // Edge tooltip text keyed by edge id. Built from layout alone, since hover
  // restyles edges on every pointer move.
  const edgeTips = useMemo(() => buildEdgeTips(layout), [layout]);

  const activeHighlight = useHighlightSet(store);
  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      layout.edges.map((e) => {
        const { style, zIndex } = edgeStyle(e, activeHighlight);
        // `buildEdgeTips` emits one tip per layout edge, so the lookup always
        // hits.
        const tip = edgeTips.get(e.id) as EdgeTip;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          focusable: false,
          data: tip,
          style,
          zIndex,
        };
      }),
    [layout, activeHighlight, edgeTips],
  );

  // Column headings live in flow coordinates so they pan and zoom with the
  // columns they name. Only the two neighbourhood columns are headed; revealed
  // path columns carry no heading.
  const columnLabels = useMemo(() => {
    const labels: { text: string; x: number; y: number }[] = [];
    const add = (level: number, text: string) => {
      const x = level * (NODE_W + GAP_X);
      const ys = layout.items.filter((i) => i.x === x).map((i) => i.y);
      if (ys.length > 0) labels.push({ text, x, y: Math.min(...ys) - COLUMN_LABEL_OFFSET_Y });
    };
    // `add` skips an empty column, so a root gets no "rendered by" heading and
    // a leaf gets no "renders" one.
    add(-1, "rendered by");
    add(1, "renders");
    return labels;
  }, [layout]);

  // A relayout can remove the edge under the pointer, and a removed element
  // never fires mouseleave, so the tip is cleared here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: layout is the trigger for the reset, not a value the effect reads
  useEffect(() => setEdgeTip(null), [layout]);

  // Fit the whole graph while it stays readable; past that, frame the area
  // around the focus column and let edge pills point at the hidden columns.
  // A pin fits the whole scene if it still fits, otherwise the path alone, and
  // skips the move when the path is already in frame. `force` (Reset view)
  // re-frames anyway, since a pan can leave the path visible but its column
  // clipped.
  const applyViewport = (duration: number, opts: { force?: boolean } = {}) => {
    const el = shellRef.current?.querySelector(".react-flow");
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    if (pinned && pinned.length > 0) {
      setHiddenCols({ left: 0, right: 0 });
      const positions = pinned
        .map((p) => layout.items.find((i) => i.id === p.id))
        .filter((i): i is NonNullable<typeof i> => i !== undefined);
      if (!opts.force && w > 0 && isPathVisible(positions, getViewport(), w, h)) return;
      lastMoveIsDefaultRef.current = true;
      // Prefer the whole scene: framing the path alone clips the columns
      // around it with no mask. The zoom floor is looser than at rest
      // (PINNED_FIT_ZOOM) because a pin can add a row to a column and push a
      // scene that fitted at rest just under the at-rest floor.
      if (computeDefaultFrame(layout.items, w, h, PINNED_FIT_ZOOM).kind === "fit") {
        fitView({ padding: FIT_PADDING, maxZoom: 1, duration });
        return;
      }
      fitView({ nodes: pinned.map((p) => ({ id: p.id })), padding: 0.2, maxZoom: 1, duration });
      return;
    }
    const frame = computeDefaultFrame(layout.items, w, h);
    if (frame.kind === "fit") {
      setHiddenCols({ left: 0, right: 0 });
      lastMoveIsDefaultRef.current = true;
      // FIT_PADDING's top clears the column headings, which sit above the
      // nodes' bounds that fitView measures.
      fitView({ padding: FIT_PADDING, maxZoom: 1, duration });
      return;
    }
    setHiddenCols({ left: frame.hiddenLeft, right: frame.hiddenRight });
    setMaskWidth({ left: frame.maskLeft, right: frame.maskRight });
    lastMoveIsDefaultRef.current = true;
    setCenter(frame.centerX, frame.centerY, { zoom: frame.zoom, duration });
  };

  const pinnedKey = pinned?.map((p) => p.id).join("|") ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key captures the shape change; applyViewport reads the latest layout
  useEffect(() => {
    applyViewport(prefersReducedMotion() ? 0 : 200);
  }, [pinnedKey]);

  // A ref keeps the resize observer calling the latest closure without
  // re-subscribing on every render.
  const applyViewportRef = useRef(applyViewport);
  applyViewportRef.current = applyViewport;

  // fitAll clears the pills along with the camera move. resetView re-applies
  // `applyViewport` with `force`, so it re-frames even when a pinned path is
  // still in view.
  const fitAll = useCallback(
    (duration: number) => {
      setHiddenCols({ left: 0, right: 0 });
      fitView({ padding: FIT_PADDING, maxZoom: 1, duration });
    },
    [fitView],
  );
  actionsRef.current = { fitAll, resetView: (d) => applyViewportRef.current(d, { force: true }) };
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const el = shellRef.current?.querySelector(".react-flow");
    if (!el) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      // The row budget is an integer, so a resize that doesn't change it
      // causes no relayout. Only the camera re-frame is debounced.
      const budget = computeRowBudget(el.clientHeight);
      setRowBudget((prev) => (prev === budget ? prev : budget));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => applyViewportRef.current(0), 150);
    });
    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // ReactFlow sets role="application" on its wrapper after spreading rest
  // props, so it can't be overridden with a prop. "application" makes screen
  // readers leave browse mode; "group" keeps the links readable.
  useEffect(() => {
    shellRef.current?.querySelector(".react-flow")?.setAttribute("role", "group");
  }, []);

  // Escape releases a pinned path. Listens only while there is a pin.
  useEffect(() => {
    if (pinned === null || pinned.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRelease();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned, onRelease]);

  const leftPill = hiddenCols.left > 0 ? edgePillCopy("left", hiddenCols.left, atDefaultFrame) : null;
  const rightPill = hiddenCols.right > 0 ? edgePillCopy("right", hiddenCols.right, atDefaultFrame) : null;

  return (
    <TooltipProvider>
      <HighlightCtx.Provider value={highlightHandlers}>
        <div ref={shellRef} className="composition-canvas h-full">
          <ReactFlow
            aria-label="Render tree graph"
            colorMode={colorMode}
            style={{ background: "transparent" }}
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onInit={() => applyViewport(0)}
            onMoveEnd={(_, viewport) => {
              // Consumed on every move end, even while pinned, so a stale `true`
              // can't leak into the first move after release.
              const wasDefaultFrame = lastMoveIsDefaultRef.current;
              lastMoveIsDefaultRef.current = false;
              const isPinned = pinned !== null && pinned.length > 0;
              setAtDefaultFrame(wasDefaultFrame);
              // A pin narrows the camera to its path on purpose; recomputing
              // pills here would offer to show columns the pin chose to hide.
              if (isPinned) return;
              if (!shouldRecomputeEdgeAffordances(wasDefaultFrame, isPinned)) return;
              const el = shellRef.current?.querySelector(".react-flow");
              if (!el) return;
              setHiddenCols(hiddenColumns(layoutRef.current.items, viewport, el.clientWidth));
              const width = gutterMaskWidth(viewport.zoom);
              setMaskWidth({ left: width, right: width });
            }}
            minZoom={0.35}
            maxZoom={1.5}
            zoomOnScroll={false}
            preventScrolling={false}
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
            onNodeMouseEnter={(_, node) => traceDisplayId(node.id)}
            onNodeMouseLeave={clearTrace}
            onEdgeMouseEnter={(event, edge) => {
              const text = (edge.data as { tip?: string } | undefined)?.tip;
              if (!text) return;
              const rect = shellRef.current?.getBoundingClientRect();
              const x = event.clientX - (rect?.left ?? 0);
              // The section clips its overflow, so keep the tip inside the
              // shell.
              const rightWall = (rect?.width ?? 0) - EDGE_TIP_W - 8;
              setEdgeTip({
                x: rightWall > 0 ? Math.min(x, rightWall) : x,
                y: event.clientY - (rect?.top ?? 0) + 14,
                text,
              });
            }}
            onEdgeMouseLeave={() => setEdgeTip(null)}
            onPaneClick={() => {
              if (pinned && pinned.length > 0) onRelease();
            }}
          >
            <ViewportPortal>
              {columnLabels.map((l) => (
                // No width: these labels run wider than a chip, and a wrapped
                // second line would land on the column's first chip.
                <div
                  key={l.text}
                  aria-hidden
                  className="whitespace-nowrap text-label text-muted-foreground"
                  style={{ position: "absolute", transform: `translate(${l.x}px, ${l.y}px)` }}
                >
                  {l.text}
                </div>
              ))}
            </ViewportPortal>
          </ReactFlow>
          {edgeTip ? (
            <div
              aria-hidden
              className="pointer-events-none absolute z-20 text-pretty rounded-md border bg-card px-2 py-1 text-xs"
              style={{ left: edgeTip.x, top: edgeTip.y, maxWidth: EDGE_TIP_W }}
            >
              {edgeTip.text}
            </div>
          ) : null}
          {hiddenCols.left > 0 ? (
            // Masks the gutter so a hidden column's sliver never shows under
            // the pill (see `maskWidth`).
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 z-10 bg-background"
              style={{ width: maskWidth.left }}
            />
          ) : null}
          {hiddenCols.right > 0 ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 z-10 bg-background"
              style={{ width: maskWidth.right }}
            />
          ) : null}
          {leftPill ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() =>
                      actionsRef.current[leftPill.remedy === "showAll" ? "fitAll" : "resetView"](
                        prefersReducedMotion() ? 0 : 200,
                      )
                    }
                    aria-label={leftPill.ariaLabel}
                    className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {leftPill.label}
                  </button>
                }
              />
              <TooltipContent>{leftPill.ariaLabel}</TooltipContent>
            </Tooltip>
          ) : null}
          {rightPill ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() =>
                      actionsRef.current[rightPill.remedy === "showAll" ? "fitAll" : "resetView"](
                        prefersReducedMotion() ? 0 : 200,
                      )
                    }
                    aria-label={rightPill.ariaLabel}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {rightPill.label}
                  </button>
                }
              />
              <TooltipContent>{rightPill.ariaLabel}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </HighlightCtx.Provider>
    </TooltipProvider>
  );
}

/** Zoom controls in the section header. They sit under the ReactFlowProvider
 *  so they can drive the viewport from outside the flow. Reset view goes
 *  through `actionsRef`, so it also clears stale edge pills. */
function CanvasControls({ actionsRef }: { actionsRef: CanvasActionsRef }) {
  const { zoomIn, zoomOut } = useReactFlow();
  const control =
    "rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  const duration = () => (prefersReducedMotion() ? 0 : 150);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" aria-label="Zoom out" className={control} onClick={() => zoomOut({ duration: duration() })}>
        −
      </button>
      <button type="button" aria-label="Zoom in" className={control} onClick={() => zoomIn({ duration: duration() })}>
        +
      </button>
      <button
        type="button"
        className={control}
        onClick={() => actionsRef.current.resetView(prefersReducedMotion() ? 0 : 200)}
      >
        Reset view
      </button>
    </div>
  );
}

export function CompositionCanvas(props: {
  model: GraphModel;
  focusId: string;
  repoId: string;
  pinned: PinnedEntry[] | null;
  hoverPath: string[] | null;
  caption: string;
  onRelease: () => void;
}) {
  const { model, pinned, onRelease } = props;
  const resolvedTheme = useResolvedTheme();
  // Mount gate: ReactFlow measures the DOM and diverges from its SSR output,
  // which breaks hydration (frozen colorMode class, detached handlers).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Hands CanvasInner's fitAll/resetView to its sibling CanvasControls. No-ops
  // until the canvas mounts.
  const actionsRef: CanvasActionsRef = useRef({ fitAll: () => {}, resetView: () => {} });

  const lastPinned = pinned && pinned.length > 0 ? pinned[pinned.length - 1] : null;
  const isPinned = lastPinned !== null;
  const pinnedName = lastPinned ? model.byId.get(lastPinned.id)?.displayName : undefined;

  // Remembers a past pin so the live region can announce "Path cleared" on
  // the render after the pin is released.
  const wasPinnedRef = useRef(false);
  useEffect(() => {
    if (isPinned) wasPinnedRef.current = true;
  }, [isPinned]);

  return (
    <ReactFlowProvider>
    <section className="panel flex flex-col overflow-hidden lg:h-full lg:min-w-0 lg:flex-1">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted px-3 py-2">
          <div className="min-w-0">
            <h2 className="text-label text-muted-foreground">Render tree</h2>
            <p className="text-pretty text-xs">{props.caption}</p>
          </div>
          <CanvasControls actionsRef={actionsRef} />
        </header>
        <div className="relative h-[30rem] bg-background lg:h-auto lg:min-h-0 lg:flex-1">
          <a
            href="#after-composition-canvas"
            className="sr-only focus:not-sr-only absolute left-2 top-2 z-20 rounded-md border bg-card px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Skip render tree
          </a>
          {isPinned ? (
            <button
              type="button"
              onClick={onRelease}
              aria-label="Clear this path (Escape)"
              className="absolute left-2 top-2 z-10 flex min-w-0 max-w-[60%] cursor-pointer items-center gap-1.5 rounded-md border border-foreground/40 bg-card px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="text-muted-foreground">path</span>
              <span className="min-w-0 truncate font-mono">{pinnedName}</span>
              <span aria-hidden>✕</span>
            </button>
          ) : null}
          {mounted ? (
            <CanvasInner {...props} colorMode={resolvedTheme} actionsRef={actionsRef} />
          ) : null}
        </div>
        <span aria-live="polite" className="sr-only">
          {isPinned
            ? `Showing the path to ${pinnedName ?? ""}. Escape clears it.`
            : wasPinnedRef.current
              ? "Path cleared"
              : ""}
        </span>
        <footer className="flex shrink-0 items-center gap-4 border-t bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ScopeGlyph scope="external" />
            external
          </span>
          <span className="flex items-center gap-1.5">
            <ScopeGlyph scope="local" />
            local
          </span>
          <span className="flex items-center gap-1.5">
            <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-status-warn" />
            deprecated
          </span>
          <span className="flex items-center gap-1.5">
            <svg aria-hidden="true" width="16" height="2" className="shrink-0">
              <line x1="0" y1="1" x2="16" y2="1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            renders directly
          </span>
        </footer>
      <div id="after-composition-canvas" tabIndex={-1} />
    </section>
    </ReactFlowProvider>
  );
}
