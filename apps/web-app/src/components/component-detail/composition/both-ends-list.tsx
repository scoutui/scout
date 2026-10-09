"use client";
import { useEffect, useRef, useState } from "react";
import type { CompositionGraphNode } from "@scoutui/web-shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BothEnds } from "./both-ends";
import { type BothEndsViewProps, noTopsThrough, ShowAll } from "./both-ends-diagram";
import { type ChainStep, EndsList } from "./ends-list";
import type { Dir } from "./graph-model";
import { ComponentName, OpenLink } from "./open-link";

/** The route's components in render order, the focus last. */
function chainOf(view: BothEnds, byId: Map<string, ChainStep>): ChainStep[] {
  return view.route.ids.map((id) => byId.get(id) ?? { node: view.focus, fragment: null });
}

/** A route on the renders side, from this component down to the one picked in Find. */
function RendersRoute({ steps, repoId }: { steps: ChainStep[]; repoId: string }) {
  return (
    <ol aria-label="Route" className="border-b px-3 py-2">
      {steps.map((s, i) => (
        <li key={s.node.id} className="flex items-start gap-1">
          <span className="flex min-w-0 flex-1 items-start gap-1 py-1">
            <span aria-hidden className="w-3 shrink-0 font-mono text-xs text-muted-foreground">
              {i === 0 ? "" : "↓"}
            </span>
            <ComponentName node={s.node} fragment={s.fragment} strong={i === 0} />
          </span>
          {i === 0 ? null : <OpenLink repoId={repoId} node={s.node} />}
        </li>
      ))}
    </ol>
  );
}

/**
 * The tab below 1024px: the same lists, one side at a time. A top-level row
 * opens its route under it.
 */
export function BothEndsList({ view, repoId, pressedDirect, onPickTop, onPickDirect, onClearThrough }: BothEndsViewProps) {
  const hasUp = view.direct.length > 0;
  const hasDown = view.renders.length > 0;
  const routeDir: Dir | null = view.route.ids.length > 0 ? view.route.dir : null;
  const [side, setSide] = useState<Dir>(routeDir ?? (hasUp ? "up" : "down"));
  useEffect(() => {
    if (routeDir) setSide(routeDir);
  }, [routeDir]);

  const byId = new Map<string, ChainStep>();
  for (const r of [...view.top, ...view.direct, ...view.renders, ...view.between]) byId.set(r.node.id, r);
  const chain = (id: string) => (view.picked.top === id && view.route.dir === "up" ? chainOf(view, byId).slice(1) : null);

  const topRef = useRef<HTMLDivElement | null>(null);
  const pickDirect = (id: string) => {
    onPickDirect(id);
    requestAnimationFrame(() => topRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
  };

  const node = (id: string): CompositionGraphNode => byId.get(id)?.node ?? view.focus;
  return (
    <div className="flex flex-col">
      {hasUp && hasDown ? (
        <div className="border-b px-3 py-2">
          <ToggleGroup
            value={[side]}
            onValueChange={(v) => {
              if (v[0]) setSide(v[0] as Dir);
            }}
            variant="outline"
            size="sm"
            multiple={false}
            aria-label="Show"
          >
            <ToggleGroupItem value="up">{`Rendered by · ${view.totals.up.toLocaleString()}`}</ToggleGroupItem>
            <ToggleGroupItem value="down">{`Renders · ${view.totals.down.toLocaleString()}`}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}
      {side === "up" ? (
        <>
          {view.top.length > 0 || view.through ? (
            <div ref={topRef} className="scroll-mt-[var(--top-bar-height,0px)]">
              <EndsList
                id="top"
                title="Top level"
                rows={view.top}
                total={view.topTotal}
                measure="steps"
                pressed={view.picked.top}
                selected={view.picked.top}
                onPick={onPickTop}
                chain={chain}
                repoId={repoId}
                action={<ShowAll view={view} onClearThrough={onClearThrough} />}
                empty={noTopsThrough(view)}
                layout="section"
              />
            </div>
          ) : null}
          <EndsList
            id="direct"
            title="Directly"
            rows={view.direct}
            measure="uses"
            pressed={pressedDirect}
            selected={view.picked.direct}
            onPick={pickDirect}
            repoId={repoId}
            layout="section"
          />
        </>
      ) : (
        <>
          {view.route.dir === "down" && view.between.length > 0 ? (
            <RendersRoute steps={view.route.ids.map((id) => ({ node: node(id), fragment: byId.get(id)?.fragment ?? null }))} repoId={repoId} />
          ) : null}
          <EndsList
            id="renders"
            title="Directly"
            rows={view.renders}
            measure="uses"
            pressed={null}
            selected={view.picked.renders}
            repoId={repoId}
            layout="section"
          />
        </>
      )}
    </div>
  );
}
