"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BothEnds, EndRow } from "./both-ends";
import { Connectors, type Lines, type Segment } from "./connectors";
import { EndsList } from "./ends-list";
import { ComponentName, OpenLink } from "./open-link";
import { useRovingGrid } from "./use-roving-grid";

export type BothEndsViewProps = {
  view: BothEnds;
  repoId: string;
  /** The direct renderer the person picked for the route to run through. */
  pressedDirect: string | null;
  onPickTop: (id: string) => void;
  onPickDirect: (id: string) => void;
  onClearThrough: () => void;
};

/** The through-component's "Show all" beside the Top level heading. */
export function ShowAll({ view, onClearThrough }: Pick<BothEndsViewProps, "view" | "onClearThrough">) {
  if (!view.through) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onClearThrough}
      aria-label={`Show all ${view.topTotal.toLocaleString()} top-level components`}
      className="-my-0.5"
    >
      Show all
    </Button>
  );
}

/** What the Top level list says when no route through the picked component reaches one. */
export const noTopsThrough = (view: BothEnds) =>
  view.through ? `No top-level component renders ${view.focus.displayName} through ${view.through.displayName}.` : undefined;

/** The route's steps between the lists, one box each, top to bottom in render order. */
function RouteColumn({ id, steps, picked, repoId }: { id: string; steps: EndRow[]; picked: string | null; repoId: string }) {
  const keys = steps.map((s) => s.node.id);
  const grid = useRovingGrid(keys, null);
  const ref = useRef<HTMLOListElement | null>(null);
  const first = keys[0];
  useEffect(() => {
    if (first) ref.current?.firstElementChild?.scrollIntoView({ block: "nearest" });
  }, [first]);
  return (
    <ol
      ref={ref}
      aria-label="Route"
      onKeyDown={grid.onKeyDown}
      onFocus={grid.onFocus}
      className="flex max-w-[15rem] shrink flex-col gap-5"
    >
      {steps.map((s) => (
        <li
          key={s.node.id}
          data-key={s.node.id}
          data-anchor={`${id}:${s.node.id}`}
          className={cn(
            "flex min-w-[10rem] items-start gap-1 rounded-md border py-0.5 pl-2 pr-0.5 shadow-xs",
            s.node.id === picked ? "selected" : "bg-card",
          )}
        >
          <span className="min-w-0 flex-1 py-1">
            <ComponentName node={s.node} fragment={s.fragment} />
          </span>
          <OpenLink repoId={repoId} node={s.node} cell={0} tabIndex={grid.tabIndexOf(s.node.id, 0)} />
        </li>
      ))}
    </ol>
  );
}

const RENDERS_FOLD = "renders-fold";

/** The diagram's lines: every direct renderer into this component, this
 *  component out to what it renders, and the route, lit with its rows. */
function linesFor(view: BothEnds, foldRenders: boolean): Lines {
  const steps = view.between.map((s) => `step:${s.node.id}`);
  const { top, direct, renders } = view.picked;
  const chain =
    view.route.dir === "up"
      ? [...(top !== null && top !== direct ? [`top:${top}`] : []), ...steps, ...(direct !== null ? [`direct:${direct}`] : [])]
      : [...(renders !== null ? [`renders:${renders}`] : []), ...steps];
  const route: Segment[] = chain.slice(1).map((to, i) => {
    const from = chain[i] as string;
    return { from, to, dir: from.startsWith("step:") && to.startsWith("step:") ? "down" : "right" };
  });
  return {
    fanIn: { anchors: view.direct.map((r) => `direct:${r.node.id}`), lit: direct === null ? null : `direct:${direct}` },
    fanOut: foldRenders
      ? { anchors: [RENDERS_FOLD], lit: null }
      : { anchors: view.renders.map((r) => `renders:${r.node.id}`), lit: renders === null ? null : `renders:${renders}` },
    route: view.route.ids.length > 0 ? route : [],
  };
}

/**
 * The diagram from 1024px: the top-level components, the route's steps when
 * a route is drawn, what renders this component directly, the component, and
 * what it renders.
 */
export function BothEndsDiagram({ view, repoId, pressedDirect, onPickTop, onPickDirect, onClearThrough }: BothEndsViewProps) {
  const up = view.route.dir === "up";
  const boxes = view.between.length > 0;
  const showTop = (view.top.length > 0 || view.through !== null) && !(boxes && !up);
  const routeKey = view.route.ids.join(">");
  const [rendersOpenFor, setRendersOpenFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusRenders = useRef(false);
  const foldRenders = view.renders.length > 0 && boxes && up && rendersOpenFor !== routeKey;
  const lines = useMemo(() => linesFor(view, foldRenders), [view, foldRenders]);
  useEffect(() => {
    if (foldRenders || !focusRenders.current) return;
    focusRenders.current = false;
    rootRef.current?.querySelector<HTMLElement>('[data-panel="renders"] [tabindex="0"]')?.focus();
  });
  const list = "max-w-[18rem] max-h-[min(72vh,40rem)] shrink";
  return (
    <div ref={rootRef} className="relative flex items-center justify-center-safe gap-8 px-4 py-6">
      {showTop ? (
        <EndsList
          id="top"
          title="Top level"
          label={`Top level, renders ${view.focus.displayName}`}
          rows={view.top}
          total={view.topTotal}
          measure="steps"
          pressed={view.picked.top}
          selected={view.picked.top}
          onPick={onPickTop}
          repoId={repoId}
          action={<ShowAll view={view} onClearThrough={onClearThrough} />}
          empty={noTopsThrough(view)}
          layout="box"
          className={list}
        />
      ) : null}
      {boxes && up ? (
        <RouteColumn id="step" steps={view.between} picked={view.through?.id ?? null} repoId={repoId} />
      ) : null}
      {view.direct.length > 0 ? (
        <EndsList
          id="direct"
          title="Directly"
          label={`Renders ${view.focus.displayName} directly`}
          rows={view.direct}
          measure="uses"
          pressed={pressedDirect}
          selected={view.picked.direct}
          onPick={onPickDirect}
          repoId={repoId}
          layout="box"
          className={list}
        />
      ) : null}
      <div
        data-anchor="focus"
        className="max-w-[15rem] shrink-0 rounded-md border border-foreground bg-card px-2.5 py-1.5 shadow-xs ring-1 ring-foreground"
      >
        <ComponentName node={view.focus} fragment={null} strong />
      </div>
      {foldRenders ? (
        <button
          type="button"
          data-anchor={RENDERS_FOLD}
          aria-expanded={false}
          onClick={() => {
            focusRenders.current = true;
            setRendersOpenFor(routeKey);
          }}
          className="flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border bg-muted px-2.5 text-xs font-medium shadow-xs hover:bg-accent"
        >
          Renders
          <span className="font-normal tabular-nums text-muted-foreground">{` · ${view.renders.length.toLocaleString()}`}</span>
          <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
        </button>
      ) : view.renders.length > 0 ? (
        <EndsList
          id="renders"
          title="Renders"
          label={`${view.focus.displayName} renders directly`}
          rows={view.renders}
          measure="uses"
          pressed={null}
          selected={view.picked.renders}
          repoId={repoId}
          layout="box"
          className={list}
        />
      ) : null}
      {boxes && !up ? (
        <RouteColumn id="step" steps={view.between} picked={view.route.ids.at(-1) ?? null} repoId={repoId} />
      ) : null}
      <Connectors lines={lines} />
    </div>
  );
}
