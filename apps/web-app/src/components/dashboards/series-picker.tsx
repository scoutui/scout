"use client";
import { useMemo, useState } from "react";
import type { CohortSelector } from "@scoutui/web-shared";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type PickableComponent = {
  componentId: string;
  displayName: string;
  packageName: string | null;
};

// A group row. Without a `selector` it adds a tag series; non-tag rows such as the
// synthetic `local` row carry their own selector.
type PickableGroup = { id: string; label: string; selector?: CohortSelector };

const CAP = 50;

/**
 * Filter each source by a lowercase-substring needle and cap each section.
 * Returns the visible (capped) slices plus the pre-cap match counts so the
 * caller can decide whether to show the "Showing the first N" note per section.
 */
function filterAndGroup(
  needle: string,
  components: PickableComponent[],
  packages: string[],
  groups: PickableGroup[],
): {
  components: { rows: PickableComponent[]; total: number };
  packages: { rows: string[]; total: number };
  groups: { rows: PickableGroup[]; total: number };
} {
  const matchedComponents = components.filter((c) =>
    [c.displayName, c.packageName ?? ""].join(" ").toLowerCase().includes(needle),
  );
  const matchedPackages = packages.filter((p) => p.toLowerCase().includes(needle));
  const matchedGroups = groups.filter((g) => g.label.toLowerCase().includes(needle));

  return {
    components: { rows: matchedComponents.slice(0, CAP), total: matchedComponents.length },
    packages: { rows: matchedPackages.slice(0, CAP), total: matchedPackages.length },
    groups: { rows: matchedGroups.slice(0, CAP), total: matchedGroups.length },
  };
}

const TABS = [
  { value: "groups", label: "Tags" },
  { value: "packages", label: "Packages" },
  { value: "components", label: "Components" },
] as const;
type PickerTab = (typeof TABS)[number]["value"];

/** Compact tab counts for the rail's fixed width: `6526` reads as `6.5k`. */
function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

/** Stable identity for a selector, matching the builder's `selectorKey`. */
function pickerKey(sel: CohortSelector): string {
  switch (sel.kind) {
    case "local":
      return "local";
    case "package":
      return `package:${sel.packageName}`;
    case "component":
      return `component:${sel.componentId}`;
    case "tag":
      return `tag:${sel.tagId}`;
  }
}

/**
 * The series browser, always open in the builder's series rail. Tabs split the
 * sources into Tags (library tags and `local`), Packages and Components; the
 * search filters the active tab and clears on a tab switch. A row toggles its
 * `CohortSelector`, and added rows show a check. `deprecatedOnly` is set in the
 * series legend, not here.
 */
export function SeriesPicker({
  components,
  packages,
  groups,
  selectedKeys,
  onPick,
}: {
  components: PickableComponent[];
  packages: string[];
  groups: PickableGroup[];
  selectedKeys: ReadonlySet<string>;
  onPick: (sel: CohortSelector) => void;
}) {
  const [tab, setTab] = useState<PickerTab>("groups");
  const [q, setQ] = useState("");
  const needle = q.toLowerCase();

  const result = useMemo(
    () => filterAndGroup(needle, components, packages, groups),
    [needle, components, packages, groups],
  );

  function pick(sel: CohortSelector) {
    onPick(sel);
  }

  // Tab counts follow the current search, so they are the full totals when it's empty.
  const counts: Record<PickerTab, number> = {
    groups: result.groups.total,
    packages: result.packages.total,
    components: result.components.total,
  };
  const activeLabel = (TABS.find((t) => t.value === tab)?.label ?? "items").toLowerCase();
  const activeTotal = counts[tab];

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
            value={[tab]}
            onValueChange={(v) => {
              if (v[0]) {
                setTab(v[0] as PickerTab);
                setQ("");
              }
            }}
            multiple={false}
            variant="outline"
            size="sm"
            className="flex w-full"
            aria-label="Series type"
          >
            {/* flex-auto over equal thirds: "Components 6.5k" needs more room than "Tags 3". */}
            {TABS.map((t) => (
              <ToggleGroupItem key={t.value} value={t.value} className="flex-auto justify-center gap-1.5">
                {t.label}
                <span className="text-[0.6875rem] tabular-nums opacity-60">{formatCount(counts[t.value])}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${activeLabel}…`}
            aria-label={`Search ${activeLabel}`}
          />
        <ul className="max-h-72 overflow-y-auto border-t py-1">
          {tab === "groups"
            ? result.groups.rows.map((g) => {
                const sel = g.selector ?? { kind: "tag" as const, tagId: g.id };
                const added = selectedKeys.has(pickerKey(sel));
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      aria-pressed={added}
                      onClick={() => pick(sel)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{g.label}</span>
                      {added ? <span aria-hidden className="shrink-0 text-xs text-muted-foreground">✓</span> : null}
                    </button>
                  </li>
                );
              })
            : null}

          {tab === "packages"
            ? result.packages.rows.map((p) => {
                const added = selectedKeys.has(`package:${p}`);
                return (
                  <li key={p}>
                    <button
                      type="button"
                      aria-pressed={added}
                      onClick={() => pick({ kind: "package", packageName: p })}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{p}</span>
                      {added ? <span aria-hidden className="shrink-0 text-xs text-muted-foreground">✓</span> : null}
                    </button>
                  </li>
                );
              })
            : null}

          {tab === "components"
            ? result.components.rows.map((c) => {
                const added = selectedKeys.has(`component:${c.componentId}`);
                return (
                  <li key={c.componentId}>
                    <button
                      type="button"
                      aria-pressed={added}
                      onClick={() => pick({ kind: "component", componentId: c.componentId })}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="w-full truncate font-mono text-xs">{c.displayName}</span>
                        {c.packageName ? (
                          <span className="w-full truncate font-mono text-xs text-muted-foreground">
                            {c.packageName}
                          </span>
                        ) : null}
                      </span>
                      {added ? (
                        <span aria-hidden className="shrink-0 text-xs text-muted-foreground">✓</span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            : null}

          {activeTotal === 0 ? (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">No {activeLabel} match.</li>
          ) : activeTotal > CAP ? (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">Showing the first {CAP}. Type to narrow the list.</li>
          ) : null}
        </ul>
    </div>
  );
}
