"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BothEnds, EndRow } from "./both-ends";
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
      className="flex min-w-[10rem] max-w-[15rem] shrink flex-col gap-5"
    >
      {steps.map((s) => (
        <li
          key={s.node.id}
          data-key={s.node.id}
          data-anchor={`${id}:${s.node.id}`}
          className={cn(
            "flex items-start gap-1 rounded-md border bg-card py-0.5 pl-2 pr-0.5 shadow-xs",
            s.node.id === picked && "selected",
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

/**
 * The diagram from 1024px: the top-level components, the route's steps when
 * a route is drawn, what renders this component directly, the component, and
 * what it renders.
 */
export function BothEndsDiagram({ view, repoId, pressedDirect, onPickTop, onPickDirect, onClearThrough }: BothEndsViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const up = view.route.dir === "up";
  const boxes = view.between.length > 0;
  const showTop = (view.top.length > 0 || view.through !== null) && !(boxes && !up);
  const list = "min-w-[11rem] max-w-[18rem] max-h-[min(72vh,40rem)] shrink";
  return (
    <div ref={containerRef} className="relative flex items-center justify-center gap-8 px-4 py-6">
      {showTop ? (
        <EndsList
          id="top"
          title="Top level"
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
      {view.renders.length > 0 ? (
        <EndsList
          id="renders"
          title="Renders"
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
    </div>
  );
}
