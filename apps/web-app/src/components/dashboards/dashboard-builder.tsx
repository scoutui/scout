"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CircleX } from "lucide-react";
import type { ChartType, CohortSelector, Dashboard, DashboardConfig, DashboardMetric, DashboardView } from "@scoutui/web-shared";
import { cohortKey, unknownCohortKeys } from "@scoutui/web-shared/client";
import { actionErrorMessage } from "@/lib/action-error";
import { seriesCanOverlap } from "@/lib/cohort-overlap";
import { type LibraryTag, deprecatedShare, deprecatedShareText, offersDeprecatedOnly, tagsInUse } from "@/lib/chart-builder-series";
import type { ReadModelUnavailable, SkippedNotices } from "@/lib/read-model-state";
import { type ChartCohort, chartColors, drawnChartCohorts } from "@/lib/dashboard-chart-data";
import { cn } from "@/lib/utils";
import { SeriesPicker, type PickableComponent } from "@/components/dashboards/series-picker";
import { SeriesLegend, type LegendSeries } from "@/components/dashboards/series-legend";
import { SeriesEmptyState } from "@/components/dashboards/series-empty-state";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DashboardChart } from "@/components/dashboards/dashboard-chart";
import { DashboardScopeBadge } from "@/components/dashboards/dashboard-scope-badge";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { pickableForRepo, previewDashboard, saveDashboard } from "@/app/charts/dashboard-actions";

// Each chart type's toggle shows a 14px glyph of the shape it draws.
const CHART_TYPES: Array<{ value: ChartType; label: string; glyph: React.ReactNode }> = [
  {
    value: "trend",
    label: "Trend",
    glyph: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <path d="M1 11 5 6l3 2 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    value: "bars",
    label: "Bars",
    glyph: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <rect x="1" y="2" width="12" height="2.5" rx="1" fill="currentColor" />
        <rect x="1" y="6" width="8" height="2.5" rx="1" fill="currentColor" opacity="0.7" />
        <rect x="1" y="10" width="4.5" height="2.5" rx="1" fill="currentColor" opacity="0.45" />
      </svg>
    ),
  },
  {
    value: "stacked-share",
    label: "Stacked",
    glyph: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <path d="M1 13V9c4 0 7-3 12-3v7Z" fill="currentColor" opacity="0.4" />
        <path d="M1 9c4 0 7-3 12-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M1 5c4 0 7-2 12-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
  {
    value: "table",
    label: "Table",
    glyph: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
        <rect x="1" y="2" width="12" height="2.5" rx="0.75" fill="currentColor" opacity="0.6" />
        <path d="M1.5 8h11M1.5 11.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

/**
 * Chart builder. A controls strip holds the name, scope, chart type, metric, Cancel,
 * Save and description; a series rail beside the chart lists the current series
 * (remove, or narrow a package or tag series to its deprecated components from the
 * row menu) above an always-open picker. Controls build a DashboardConfig, and the
 * preview re-projects it through previewDashboard, keeping only the latest request's
 * result.
 */

/** A selector's name from the estate and picker lists, mirroring the engine's cohortIdentity; undefined when they don't hold it. */
function cohortLabel(
  sel: CohortSelector,
  components: PickableComponent[],
  libraryTags: Array<{ id: string; label: string; color: string }>,
): string | undefined {
  switch (sel.kind) {
    case "local":
      return "Local";
    case "package":
      return sel.packageName;
    case "component": {
      const c = components.find((x) => x.componentId === sel.componentId);
      if (!c) return undefined;
      return sel.label ?? (c.packageName ? `${c.displayName} · ${c.packageName}` : c.displayName);
    }
    case "tag":
      return libraryTags.find((t) => t.id === sel.tagId)?.label;
  }
}

/** The view's `nth` drawn cohort with a key: it carries the server-stamped label, role
 *  and colour the client can't derive (it has no governance). */
function previewCohort(view: DashboardView, key: string, nth: number): (ChartCohort & { label: string }) | undefined {
  let seen = 0;
  for (const cohort of drawnChartCohorts(view)) {
    if (cohort.cohortKey !== key) continue;
    if (seen === nth) return cohort;
    seen += 1;
  }
  return undefined;
}

/** Identity used to drop duplicate adds of the exact same selector. Also used as a stable React key. */
export function selectorKey(sel: CohortSelector): string {
  return cohortKey(sel);
}

export function DashboardBuilder({
  libraryTags,
  repos,
  components,
  packages,
  saved,
}: {
  libraryTags: LibraryTag[];
  repos: string[];
  components: PickableComponent[];
  packages: string[];
  /** A saved chart to edit: the builder opens with it and saves back to it. */
  saved?: Pick<Dashboard, "id" | "name" | "description" | "config">;
}) {
  const [name, setName] = useState(saved?.name ?? "");
  const [description, setDescription] = useState(saved?.description ?? "");
  const [scopeRepoId, setScopeRepoId] = useState<string | null>(
    saved?.config.scope.kind === "repo" ? saved.config.scope.repoId : null,
  );
  const [cohorts, setCohorts] = useState<CohortSelector[]>(saved?.config.cohorts ?? []);
  const [chartType, setChartType] = useState<ChartType>(saved?.config.chartType ?? "trend");
  const [metric, setMetric] = useState<DashboardMetric>(saved?.config.metric ?? "count");
  const [preview, setPreview] = useState<{ config: DashboardConfig; view: DashboardView; skipped: SkippedNotices } | null>(null);
  // The last preview that landed, and the keys of the series its config held that its view left out.
  const [landed, setLanded] = useState<{ view: DashboardView; unknown: ReadonlySet<string> } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState<ReadModelUnavailable | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRequest = useRef<{ config: DashboardConfig; retry: number } | null>(null);

  // A repo scope narrows the picker to what that repo's latest scan contains. The
  // estate-wide lists still supply labels, and come back when the scope clears.
  const [scopedPickable, setScopedPickable] = useState<{ components: PickableComponent[]; packages: string[] } | null>(null);
  const [pickerUnavailable, setPickerUnavailable] = useState<ReadModelUnavailable | null>(null);
  const [pickerError, setPickerError] = useState(false);
  const [pickerRetry, setPickerRetry] = useState(0);
  const scopeRequest = useRef<{ repoId: string | null; retry: number } | null>(null);
  useEffect(() => {
    const request = { repoId: scopeRepoId, retry: pickerRetry };
    scopeRequest.current = request;
    setScopedPickable(null);
    setPickerUnavailable(null);
    setPickerError(false);
    if (!scopeRepoId) return;
    pickableForRepo(scopeRepoId)
      .then((res) => {
        if (request !== scopeRequest.current) return;
        if (res.state === "ready") setScopedPickable(res.value);
        else setPickerUnavailable(res);
      })
      .catch(() => {
        if (request === scopeRequest.current) setPickerError(true);
      });
    return () => { scopeRequest.current = null; };
  }, [scopeRepoId, pickerRetry]);
  const pickable = scopedPickable?.components ?? components;

  // stacked-share is inherently a share view; force the metric so preview + save agree.
  const effectiveMetric: DashboardMetric = chartType === "stacked-share" ? "share" : metric;

  // The picker's Groups section holds the library tags, only those the repo's components
  // use under a repo scope, plus a synthetic entry that adds the `local` series.
  const pickerGroups = useMemo(
    () => [
      ...(scopedPickable ? tagsInUse(libraryTags, scopedPickable.components) : libraryTags).map((t) => ({ id: t.id, label: t.label })),
      { id: "__local", label: "Local components", selector: { kind: "local" as const } },
    ],
    [libraryTags, scopedPickable],
  );

  // The picker toggles: picking an already-added selector removes it (the picker
  // stays open for multi-add, so rows behave like checkable entries).
  function toggleSeries(sel: CohortSelector) {
    setCohorts((prev) =>
      prev.some((p) => selectorKey(p) === selectorKey(sel))
        ? prev.filter((p) => selectorKey(p) !== selectorKey(sel))
        : [...prev, sel],
    );
  }
  function removeSeries(i: number) {
    setCohorts((prev) => prev.filter((_, idx) => idx !== i));
  }
  function toggleDeprecatedOnly(i: number) {
    setCohorts((prev) =>
      prev.map((sel, idx) => {
        if (idx !== i || (sel.kind !== "package" && sel.kind !== "tag")) return sel;
        return { ...sel, deprecatedOnly: sel.deprecatedOnly ? undefined : true };
      }),
    );
  }

  const config = useMemo<DashboardConfig>(
    () => ({
      scope: scopeRepoId ? { kind: "repo", repoId: scopeRepoId } : { kind: "all" },
      cohorts,
      chartType,
      metric: effectiveMetric,
    }),
    [scopeRepoId, cohorts, chartType, effectiveMetric],
  );

  // A series in the last landed view takes its label, colour and role from there; any
  // other tag series brings its tag's colour. `chartColors` colours them all in saved
  // order, as the chart does. An unknown series reads by any name the lists or the
  // saved chart hold, and shows no colour.
  const legend = useMemo<LegendSeries[]>(() => {
    const seen = new Map<string, number>();
    const rows = cohorts.map((sel) => {
      const key = selectorKey(sel);
      const nth = seen.get(key) ?? 0;
      seen.set(key, nth + 1);
      const drawn = landed ? previewCohort(landed.view, key, nth) : undefined;
      const cohort: ChartCohort = drawn ?? {
        cohortKey: key,
        color: sel.kind === "tag" ? (libraryTags.find((t) => t.id === sel.tagId)?.color ?? "") : "",
      };
      return { sel, key, drawn, cohort, unknown: landed?.unknown.has(key) ?? false };
    });
    const colors = chartColors(rows.map((r) => r.cohort));
    return rows.map(({ sel, key, drawn, unknown }) => {
      const saved = unknown && sel.kind === "component" ? sel.label : undefined;
      const label = drawn?.label ?? cohortLabel(sel, components, libraryTags) ?? saved ?? "";
      let deprecatedOnly: LegendSeries["deprecatedOnly"] = null;
      if (sel.kind === "package" || sel.kind === "tag") {
        const share = deprecatedShare(sel, pickable, libraryTags);
        if (offersDeprecatedOnly(sel, share)) {
          deprecatedOnly = { on: sel.deprecatedOnly === true, text: deprecatedShareText(share, label) };
        }
      }
      return {
        selector: sel,
        label,
        color: unknown ? "" : (colors.get(key) ?? ""),
        role: drawn?.role,
        unknown,
        deprecatedOnly,
      };
    });
  }, [cohorts, components, libraryTags, landed, pickable]);

  useEffect(() => {
    const request = { config, retry: previewRetry };
    previewRequest.current = request;
    setPreviewUnavailable(null);
    setPreviewError(false);
    const keys = new Set(cohorts.map(selectorKey));
    setLanded((prev) =>
      prev && [...prev.unknown].some((k) => !keys.has(k))
        ? { ...prev, unknown: new Set([...prev.unknown].filter((k) => keys.has(k))) }
        : prev,
    );
    if (cohorts.length === 0) {
      setPreview(null);
      setLoadingPreview(false);
      return;
    }
    const reqConfig = config;
    setLoadingPreview(true);
    previewDashboard(reqConfig)
      .then((result) => {
        if (request === previewRequest.current) {
          if (result.state === "ready") {
            setPreview({ config: reqConfig, view: result.value, skipped: { fallbacks: result.fallbacks, gaps: result.gaps } });
            setLanded({ view: result.value, unknown: unknownCohortKeys(reqConfig.cohorts, result.value) });
          } else {
            setPreview(null);
            setPreviewUnavailable(result);
          }
          setLoadingPreview(false);
        }
      })
      .catch(() => {
        if (request === previewRequest.current) {
          setPreview(null);
          setLoadingPreview(false);
          setPreviewError(true);
        }
      });
    return () => { previewRequest.current = null; };
  }, [config, cohorts, previewRetry]);

  async function save() {
    setError(null);
    setSaving(true);
    // On success the action redirects to the saved chart, so this only resolves
    // on failure; the button stays "Saving…" while the navigation lands.
    const res = await saveDashboard({
      ...(saved ? { id: saved.id } : {}),
      name: name.trim(),
      description: description.trim() || null,
      config,
    });
    setSaving(false);
    setError(actionErrorMessage(res?.error, "save this chart", "Couldn't save the chart. Try again."));
  }

  // The share caption shows only for the share metric, and only when the series can
  // overlap so a component can count toward two of them.
  const showShareCaption =
    effectiveMetric === "share" &&
    seriesCanOverlap(cohorts, {
      components: pickable,
      packages: scopedPickable?.packages ?? packages,
      tags: libraryTags,
    });

  const selectedKeys = new Set(cohorts.map(selectorKey));
  const nameMissing = !name.trim();

  return (
    <div className="panel space-y-4 p-4">
      {/* Controls strip */}
      <div className="space-y-3 border-b pb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] max-w-[20rem] flex-1 space-y-1.5">
            <label htmlFor="dashboard-name" className="block text-label text-muted-foreground">
              Name
            </label>
            <Input
              id="dashboard-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Legacy vs current"
            />
          </div>

          <div className="min-w-[10rem] space-y-1.5">
            <label htmlFor="dashboard-scope" className="block text-label text-muted-foreground">
              Repos
            </label>
            <select
              id="dashboard-scope"
              value={scopeRepoId ?? ""}
              onChange={(e) => setScopeRepoId(e.target.value || null)}
              className={cn(
                "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
                scopeRepoId ? "font-mono" : "font-sans",
              )}
            >
              <option value="">All repos</option>
              {repos.map((r) => (
                <option key={r} value={r} className="font-mono">
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <span className="block text-label text-muted-foreground">Chart type</span>
            <ToggleGroup
              value={[chartType]}
              onValueChange={(v) => v[0] && setChartType(v[0] as ChartType)}
              multiple={false}
              variant="outline"
              className="flex-wrap"
              aria-label="Chart type"
            >
              {CHART_TYPES.map((c) => (
                <ToggleGroupItem key={c.value} value={c.value} className="gap-1.5">
                  {c.glyph}
                  {c.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-label text-muted-foreground">Metric</span>
              <span
                className="whitespace-nowrap text-xs leading-none text-muted-foreground"
                style={effectiveMetric === "share" ? undefined : { visibility: "hidden" }}
              >
                Share of these series
              </span>
            </div>
            <ToggleGroup
              value={[effectiveMetric]}
              onValueChange={(v) => v[0] && setMetric(v[0] as DashboardMetric)}
              multiple={false}
              variant="outline"
              aria-label="Metric"
            >
              <ToggleGroupItem value="count" disabled={chartType === "stacked-share"}>Count</ToggleGroupItem>
              <ToggleGroupItem value="share">Share</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="ml-auto space-y-1.5 self-end">
            <p id="dashboard-save-reason" className="min-h-lh text-right text-xs leading-none text-muted-foreground">
              {nameMissing ? "Name the chart to save it." : null}
            </p>
            <div className="flex items-center gap-3">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Link
                href={saved ? `/charts/${encodeURIComponent(saved.id)}` : "/charts"}
                className={cn(buttonVariants({ variant: "ghost" }))}
              >
                Cancel
              </Link>
              <Button
                onClick={() => void save()}
                disabled={saving || cohorts.length === 0 || nameMissing}
                aria-describedby={nameMissing ? "dashboard-save-reason" : undefined}
              >
                {saving ? "Saving…" : "Save chart"}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="dashboard-description" className="block text-label text-muted-foreground">
            Description
          </label>
          <Input
            id="dashboard-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional. Shown under the chart's name."
          />
        </div>
      </div>

      {/* Series rail and chart */}
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside aria-label="Series" className="flex min-w-0 flex-col gap-3 lg:border-r lg:pr-4">
          <span className="text-label text-muted-foreground">Series</span>
          {cohorts.length > 0 ? (
            <div className="border-b pb-3">
              <SeriesLegend
                series={legend}
                onRemove={removeSeries}
                onToggleDeprecatedOnly={toggleDeprecatedOnly}
              />
            </div>
          ) : null}
          {pickerUnavailable ? (
            <ReadModelState {...pickerUnavailable} embedded refresh={() => setPickerRetry(n => n + 1)} />
          ) : pickerError ? (
            <BuilderReadError message="Couldn't load this repo's components." retryLabel="Try again" onRetry={() => setPickerRetry(n => n + 1)} />
          ) : scopeRepoId && !scopedPickable ? (
            <output className="text-sm text-muted-foreground">Loading…</output>
          ) : <SeriesPicker
            components={pickable}
            packages={scopedPickable?.packages ?? packages}
            groups={pickerGroups}
            selectedKeys={selectedKeys}
            onPick={toggleSeries}
          />}
        </aside>

        <div className="min-w-0 space-y-4">
          {/* The scope badge shows only for a repo scope: at "All repos" it would
              repeat the Repos control. */}
          {config.scope.kind === "repo" || loadingPreview ? (
            <div className="flex items-center justify-between gap-2">
              {config.scope.kind === "repo" ? <DashboardScopeBadge scope={config.scope} /> : <span />}
              {loadingPreview ? <span className="text-xs text-muted-foreground">Updating…</span> : null}
            </div>
          ) : null}

          {previewUnavailable ? (
            <ReadModelState {...previewUnavailable} embedded refresh={() => setPreviewRetry(n => n + 1)} />
          ) : previewError ? (
            <BuilderReadError message="Couldn't load the preview." retryLabel="Try again" onRetry={() => setPreviewRetry(n => n + 1)} />
          ) : cohorts.length === 0 ? (
            <SeriesEmptyState />
          ) : preview ? (
            // While a refetch loads, the previous chart stays at reduced opacity. The
            // rail's series list is the legend, so the chart's own legend is off.
            <div className={cn("space-y-4 transition-opacity duration-200", loadingPreview && "opacity-50")}>
              <SkippedScansNotice {...preview.skipped} refresh={() => setPreviewRetry(n => n + 1)} />
              <DashboardChart config={preview.config} view={preview.view} showLegend={false} />
            </div>
          ) : (
            <div className="h-[280px]" />
          )}

          {showShareCaption ? (
            <p className="text-xs text-muted-foreground">
              Some of these series share components, and a shared component counts toward each of them.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BuilderReadError({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <section role="alert" className="min-w-0 space-y-3">
      <p className="flex items-start gap-2 text-sm text-status-err">
        <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {message}
      </p>
      <Button variant="outline" onClick={onRetry}>{retryLabel}</Button>
    </section>
  );
}
