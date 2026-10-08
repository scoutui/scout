"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { pathValueOf, type Dir, type FindRow } from "./graph-model";
import { ComponentName } from "./open-link";

/** How many components render the focus and how many it renders, at any number of steps. */
export function totalsLine(focusName: string, up: number, down: number): string {
  return [
    up > 0 ? `${up.toLocaleString()} render ${focusName}` : null,
    down > 0 ? `${focusName} renders ${down.toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function FindBox({
  up,
  down,
  focusName,
  onPick,
}: {
  up: FindRow[];
  down: FindRow[];
  focusName: string;
  onPick: (row: FindRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const all = useMemo(() => [...up, ...down], [up, down]);
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
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const groups: { title: string; rows: FindRow[] }[] = [];
  for (const r of rows) {
    const side = r.dir === "up" ? "Rendered by" : "Renders";
    const title = r.steps === 1 ? `${side} · directly` : `${side} · ${r.steps} steps away`;
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.rows.push(r);
    else groups.push({ title, rows: [r] });
  }
  const totalOf = (dir: Dir, steps: number) => (dir === "up" ? up : down).filter((r) => r.steps === steps).length;
  const move = (next: number) => {
    setActive(next);
    document.getElementById(`find-${next}`)?.scrollIntoView({ block: "nearest" });
  };
  const pick = (r: FindRow) => {
    onPick(r);
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const summary = totalsLine(focusName, up.length, down.length);
  let index = -1;
  return (
    <div
      ref={boxRef}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      className="relative w-80 max-w-full"
    >
      <div>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? "composition-find-list" : undefined}
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
              move(Math.min(active + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(Math.max(active - 1, 0));
            } else if (e.key === "Enter" && open && rows[active]) {
              e.preventDefault();
              pick(rows[active] as FindRow);
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="h-8 w-full rounded-lg border border-control bg-card px-2.5 font-mono text-base shadow-sm placeholder:font-sans placeholder:text-muted-foreground sm:text-xs"
        />
      </div>
      {open ? (
        <div
          className="absolute left-0 top-full z-20 mt-1 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-card shadow-lg"
        >
          <div className="shrink-0 border-b bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            {query.trim() ? `${rows.length.toLocaleString()} of ${all.length.toLocaleString()} match` : summary}
          </div>
          <div
            id="composition-find-list"
            // biome-ignore lint/a11y/useSemanticElements: an ARIA combobox list of rich rows
            role="listbox"
            aria-label={`Components that render ${focusName} or that it renders`}
            tabIndex={-1}
            className="max-h-80 overflow-y-auto overscroll-contain"
          >
            {groups.map((g) => (
              <div
                key={g.title}
                // biome-ignore lint/a11y/useSemanticElements: a group of options inside the combobox list
                role="group"
                aria-label={g.title}
              >
                <div className="sticky top-0 z-10 flex justify-between border-b bg-card px-2.5 py-1 text-label text-muted-foreground">
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
                        className={cn(
                          "flex scroll-mt-6 cursor-pointer flex-col gap-0.5 px-2.5 py-1.5",
                          i === active ? "focus-current bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <ComponentName node={r.node} fragment={null} />
                        <span className="pl-3.5 text-code text-muted-foreground [overflow-wrap:anywhere]">
                          {pathValueOf(r.node)}
                        </span>
                        {r.steps > 1 ? (
                          <span className="pl-3.5 text-code text-muted-foreground [overflow-wrap:anywhere]">
                            {r.chain.join(" → ")}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {rows.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {query.trim() ? (
                  <>
                    No matches for “<span className="font-mono">{query.trim()}</span>”.
                  </>
                ) : (
                  "No matches."
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
