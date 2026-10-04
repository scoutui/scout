"use client";
import type { ComponentDetail, CompositionGraph } from "@scoutui/web-shared";
import type { SourceRef } from "@/lib/source-link";
import { cn } from "@/lib/utils";
import { useQuerySyncedState } from "@/lib/use-query-synced-state";
import { UsageTab } from "./usage/usage-tab";
import { CompositionTab } from "./composition/composition-tab";

type DetailTab = "usage" | "composition";

const TAB_ORDER: DetailTab[] = ["usage", "composition"];

/** `?tab=composition` opens Composition; anything else, `events` and `props` included, opens Usage. */
const parseTab = (q: string): DetailTab => (q === "composition" ? "composition" : "usage");
const serializeTab = (tab: DetailTab) => (tab === "usage" ? "" : tab);

export function DetailTabs({
  detail,
  graph,
  source,
}: {
  detail: ComponentDetail;
  graph: CompositionGraph;
  source: SourceRef | null;
}) {
  const [tab, setTab] = useQuerySyncedState(parseTab, serializeTab, "tab");

  function selectTab(next: DetailTab) {
    if (next === tab) return;
    setTab(next);
  }

  // Automatic activation: panels swap without a server round trip, so arrow
  // keys select as they move (the WAI-ARIA tabs pattern for instant panels).
  function onTablistKeyDown(e: React.KeyboardEvent) {
    const current = TAB_ORDER.indexOf(tab);
    let next: DetailTab | null = null;
    if (e.key === "ArrowRight") next = TAB_ORDER[(current + 1) % TAB_ORDER.length] as DetailTab;
    else if (e.key === "ArrowLeft")
      next = TAB_ORDER[(current - 1 + TAB_ORDER.length) % TAB_ORDER.length] as DetailTab;
    else if (e.key === "Home") next = TAB_ORDER[0] as DetailTab;
    else if (e.key === "End") next = TAB_ORDER[TAB_ORDER.length - 1] as DetailTab;
    if (next === null) return;
    e.preventDefault();
    selectTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  const tabs: { value: DetailTab; label: string; count: string | null }[] = [
    { value: "usage", label: "Usage", count: detail.occurrences.length.toLocaleString() },
    { value: "composition", label: "Composition", count: null },
  ];

  return (
    <div className="space-y-4">
      {/* Below sm the rail scrolls instead of wrapping, with the same hidden
          scrollbar and edge fade as the top nav. */}
      <div
        role="tablist"
        aria-label="Component detail sections"
        onKeyDown={onTablistKeyDown}
        className="flex items-center gap-4 border-b overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:pr-8 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:gap-5"
      >
        {tabs.map(t => {
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              id={`tab-${t.value}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="usage-panel"
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(t.value)}
              className={cn(
                "relative -mb-px inline-flex shrink-0 cursor-pointer items-baseline gap-1.5 whitespace-nowrap border-b-2 py-3 text-sm transition-colors duration-150 ease-out motion-reduce:transition-none",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <span className={active ? "font-medium" : ""}>{t.label}</span>
              {t.count !== null ? (
                <span className="text-xs tabular-nums text-muted-foreground">{t.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="usage-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "usage" ? <UsageTab detail={detail} source={source} /> : <CompositionTab detail={detail} graph={graph} />}
      </div>
    </div>
  );
}
