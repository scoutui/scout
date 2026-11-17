"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleX } from "lucide-react";
import type { ChartRange, ChartType, ChartVisibility, CohortSelector, Dashboard, DashboardConfig, DashboardMetric, DashboardView } from "@scoutui/web-shared";
import { cohortKey, selectorRole, unknownCohortKeys } from "@scoutui/web-shared/client";
import { actionErrorMessage } from "@/lib/action-error";
import { type LibraryTag, type PickableComponent, deprecatedShare, deprecatedShareText, offersDeprecatedOnly, tagsInUse } from "@/lib/chart-builder-series";
import { searchSeries } from "@/lib/identity-search";
import type { ReadModelUnavailable, SkippedNotices } from "@/lib/read-model-state";
import { type ChartCohort, chartColors, deprecatedOnlyKeys, drawnChartCohorts, isEmptyView, lineColors } from "@/lib/dashboard-chart-data";
import { cn } from "@/lib/utils";
import { type LegendSeries, MissingFrom, SeriesActions, legendNames } from "@/components/dashboards/series-legend";
import { SeriesPicker } from "@/components/dashboards/series-picker";
import { type AddedRows, TrendLegendTable } from "@/components/dashboards/trend-legend-table";
import { CohortTable } from "@/components/dashboards/cohort-table";
import { SeriesEmptyState } from "@/components/dashboards/series-empty-state";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { toggleVariants } from "@/components/ui/toggle";
import { DashboardChart } from "@/components/dashboards/dashboard-chart";
import { DashboardScopeBadge } from "@/components/dashboards/dashboard-scope-badge";
import { VISIBILITY, visibilityTitle } from "@/components/dashboards/chart-visibility";
import { ReadModelState, SkippedScansNotice } from "@/components/read-model-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
 * Chart builder. The page's heading sits beside Cancel and Save chart, which submits the
 * form below. Its controls strip holds the name, scope, chart type, metric and who can see
 * the chart, then the description; a series column beside the
 * chart (`SeriesPicker`) adds and removes series. The column scrolls on its own, as tall as the chart and the table
 * under it. That table lists the series in the order added, each with its remove button and, for a package or tag
 * series that offers it, a menu that narrows it to its deprecated components; for a Table chart that table is the
 * preview. Controls build a DashboardConfig, and the preview re-projects it through previewDashboard, keeping
 * only the latest request's result.
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
 *  and colour, which win over what the client derives from the picker lists. */
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
  deprecatedPackages,
  saved,
  duplicate = false,
}: {
  libraryTags: LibraryTag[];
  repos: string[];
  components: PickableComponent[];
  packages: string[];
  /** The packages deprecated whole. */
  deprecatedPackages: string[];
  /** A saved chart to edit: the builder opens with it and saves back to it, or with `duplicate`, saves a new chart. */
  saved?: Pick<Dashboard, "id" | "name" | "description" | "config" | "visibility">;
  duplicate?: boolean;
}) {
  const [name, setName] = useState(saved?.name ?? "");
  const [description, setDescription] = useState(saved?.description ?? "");
  const [scopeRepoId, setScopeRepoId] = useState<string | null>(
    saved?.config.scope.kind === "repo" ? saved.config.scope.repoId : null,
  );
  const [cohorts, setCohorts] = useState<CohortSelector[]>(saved?.config.cohorts ?? []);
  const [chartType, setChartType] = useState<ChartType>(saved?.config.chartType ?? "trend");
  const [metric, setMetric] = useState<DashboardMetric>(saved?.config.metric ?? "count");
  const [range, setRange] = useState<ChartRange>(saved?.config.range ?? "all");
  const [visibility, setVisibility] = useState<ChartVisibility>(saved?.visibility ?? "private");
  const [preview, setPreview] = useState<{ config: DashboardConfig; view: DashboardView; skipped: SkippedNotices } | null>(null);
  // The last preview that landed, the keys of the series its config held that its view left out, and the repo it was scoped to.
  const [landed, setLanded] = useState<{ view: DashboardView; unknown: ReadonlySet<string>; repoId: string | null } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState<ReadModelUnavailable | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [seriesError, setSeriesError] = useState(false);
  // The line a Trend preview shows on its own, and the last series added or removed, for screen readers.
  const [shown, setShown] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  // The series just added, whose row the series table scrolls into view.
  const justAdded = useRef<string | null>(null);
  const seriesTableRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const ids = {
    form: `${id}-form`, title: `${id}-title`, name: `${id}-name`, nameError: `${id}-name-error`, scope: `${id}-scope`,
    metricHint: `${id}-metric-hint`, description: `${id}-description`, seriesError: `${id}-series-error`,
  };
  const previewRequest = useRef<{ config: DashboardConfig; retry: number } | null>(null);

  // A repo scope narrows the picker to what that repo's latest scan contains. The
  // estate-wide lists still supply labels, and come back when the scope clears.
  const [scopedPickable, setScopedPickable] = useState<{ components: PickableComponent[]; packages: string[]; deprecatedPackages: string[] } | null>(null);
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

  // Under a repo scope, the search offers only the tags the repo's components use.
  const pickerTags = useMemo(
    () => (scopedPickable ? tagsInUse(libraryTags, scopedPickable.components) : libraryTags),
    [libraryTags, scopedPickable],
  );
  const pickerPackages = scopedPickable?.packages ?? packages;
  const pickerDeprecatedPackages = scopedPickable?.deprecatedPackages ?? deprecatedPackages;
  const selectedKeys = useMemo(() => new Set(cohorts.map(selectorKey)), [cohorts]);
  const seriesSearchId = useId();
  const seriesSearchRef = useRef<HTMLInputElement>(null);
  const searchSeriesRows = useCallback(
    (query: string, scope: string | null) =>
      searchSeries({ tags: pickerTags, components: pickable, packages: pickerPackages, query, scope, added: selectedKeys }),
    [pickerTags, pickable, pickerPackages, selectedKeys],
  );

  // Each message is a new node in the status region, so one that repeats the last is read again.
  function announce(text: string) {
    setAnnouncement((last) => ({ text, count: last.count + 1 }));
  }
  // Checking a row adds its series; unchecking it removes the series.
  function toggleSeries(sel: CohortSelector) {
    setSeriesError(false);
    const i = cohorts.findIndex((p) => selectorKey(p) === selectorKey(sel));
    if (i >= 0) {
      removeSeries(i);
    } else {
      setCohorts((prev) => [...prev, sel]);
      justAdded.current = selectorKey(sel);
      announce(`Added ${cohortLabel(sel, components, libraryTags) ?? ""}`);
    }
  }
  function removeSeries(i: number) {
    const removed = legend[i];
    setCohorts((prev) => prev.filter((_, idx) => idx !== i));
    if (!removed) return;
    announce(`Removed ${legendNames(removed).spoken}`);
    setShown((key) => (key === selectorKey(removed.selector) ? null : key));
  }
  // Removing a series from its row in the series table moves focus to the next row's remove button, else the
  // previous row's, else the series search.
  function removeFromTable(i: number, button: HTMLButtonElement) {
    const row = button.closest("tr");
    const neighbour = [row?.nextElementSibling, row?.previousElementSibling]
      .map((r) => r?.querySelector<HTMLButtonElement>("[data-remove]"))
      .find((b) => b != null);
    (neighbour ?? seriesSearchRef.current)?.focus();
    removeSeries(i);
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

  const savedNarrowed = useMemo(() => deprecatedOnlyKeys(saved?.config.cohorts ?? []), [saved]);

  // A series in the last landed view takes its label, colour and role from there; any
  // other tag series brings its tag's colour, and any other series but an unknown one takes
  // the role `selectorRole` gives it from the picker lists. They take colours as the chart gives them:
  // `lineColors` for a chart over time, `chartColors` for any other. An unknown series reads by
  // any name the lists or the saved chart hold, and shows no colour.
  const legend = useMemo<LegendSeries[]>(() => {
    const seen = new Map<string, number>();
    const rows = cohorts.map((sel) => {
      const key = selectorKey(sel);
      const nth = seen.get(key) ?? 0;
      seen.set(key, nth + 1);
      const drawn = landed ? previewCohort(landed.view, key, nth) : undefined;
      const unknown = landed?.unknown.has(key) ?? false;
      const role = drawn
        ? drawn.role
        : unknown
          ? undefined
          : selectorRole(sel, {
              isPackageDeprecated: (packageName) => pickerDeprecatedPackages.includes(packageName),
              isComponentDeprecated: (componentId) => pickable.some((c) => c.componentId === componentId && c.deprecated),
            });
      const cohort: ChartCohort = drawn ?? {
        cohortKey: key,
        color: sel.kind === "tag" ? (libraryTags.find((t) => t.id === sel.tagId)?.color ?? "") : "",
        role,
      };
      return { sel, key, drawn, cohort, role, unknown };
    });
    const view = landed?.view;
    const colors =
      (chartType === "trend" || chartType === "stacked-share") && view?.kind === "series"
        ? lineColors(rows.map((r) => r.cohort))
        : chartColors(rows.map((r) => r.cohort));
    return rows.map(({ sel, key, drawn, role, unknown }) => {
      const saved = unknown && sel.kind === "component" ? sel.label : undefined;
      const label = drawn?.label ?? cohortLabel(sel, components, libraryTags) ?? saved ?? "";
      let deprecatedOnly: LegendSeries["deprecatedOnly"] = null;
      if (sel.kind === "package" || sel.kind === "tag") {
        const share = deprecatedShare(sel, pickable, libraryTags);
        if (offersDeprecatedOnly(sel, share) || savedNarrowed.has(key)) {
          deprecatedOnly = { on: sel.deprecatedOnly === true, text: deprecatedShareText(share, label) };
        }
      }
      const elsewhere = sel.kind === "component" && components.some((c) => c.componentId === sel.componentId && c.lastSeenAt === null);
      return {
        selector: sel,
        label,
        color: unknown ? "" : (colors.get(key) ?? ""),
        role,
        unknown,
        missingFrom: unknown && elsewhere ? (landed?.repoId ?? null) : null,
        deprecatedOnly,
      };
    });
  }, [cohorts, components, libraryTags, landed, pickable, pickerDeprecatedPackages, savedNarrowed, chartType]);

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
            setLanded({
              view: result.value,
              unknown: unknownCohortKeys(reqConfig.cohorts, result.value),
              repoId: reqConfig.scope.kind === "repo" ? reqConfig.scope.repoId : null,
            });
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

  useEffect(() => {
    const key = justAdded.current;
    justAdded.current = null;
    const index = cohorts.findIndex((sel) => selectorKey(sel) === key);
    const row = index < 0 ? null : seriesTableRef.current?.querySelector(`[data-series="${index}"]`)?.closest("tr");
    if (row) revealRow(row);
  }, [cohorts]);

  // The series table takes the form of the chart on screen: a Trend or Stacked chart's legend table, or the table of a
  // Bars or Table chart. Its rows are the series in the order added, with the values the preview on screen gives them.
  const previewType = preview?.config.chartType ?? chartType;
  const lineChart = previewType === "trend" || previewType === "stacked-share";
  const lines = previewType === "trend" && preview?.view.kind === "series" ? preview.view.series : null;
  const shownLine = lines?.some((s) => s.cohortKey === shown) ? shown : null;
  const legendColors = useMemo(() => new Map(legend.map((s) => [selectorKey(s.selector), s.color])), [legend]);
  const narrowedKeys = useMemo(() => deprecatedOnlyKeys(cohorts), [cohorts]);
  const legendIndex = new Map(legend.map((s, i) => [selectorKey(s.selector), i]));
  const addedRows: AddedRows = (key) => {
    const i = legendIndex.get(key) ?? -1;
    const s = legend[i];
    if (!s) return { muted: false, note: null, actions: null };
    return {
      muted: s.unknown,
      note: s.missingFrom ? <MissingFrom repoId={s.missingFrom} /> : null,
      actions: <SeriesActions series={s} index={i} onRemove={(button) => removeFromTable(i, button)} onToggleDeprecatedOnly={() => toggleDeprecatedOnly(i)} />,
    };
  };
  function seriesTable() {
    const view = preview?.view;
    const metric = preview?.config.metric ?? effectiveMetric;
    if (lineChart) {
      const drawn = new Map(view?.kind === "series" ? view.series.map((x) => [x.cohortKey, x.points]) : []);
      const series = legend.map((s) => {
        const key = selectorKey(s.selector);
        return { cohortKey: key, label: legendNames(s).label, color: s.color, role: s.role, points: drawn.get(key) ?? [] };
      });
      return (
        <TrendLegendTable
          series={series}
          colors={legendColors}
          deprecatedOnly={narrowedKeys}
          metric={metric}
          shown={shownLine}
          onToggle={lines ? (key) => setShown(shownLine === key ? null : key) : undefined}
          added={addedRows}
        />
      );
    }
    const drawn = new Map(view && view.kind !== "series" ? view.points.map((p) => [p.cohortKey, p]) : []);
    const points = legend.map((s) => {
      const key = selectorKey(s.selector);
      const point = drawn.get(key);
      return { cohortKey: key, label: legendNames(s).label, color: s.color, role: s.role, value: point?.value ?? null, componentCount: point?.componentCount ?? null };
    });
    return (
      <CohortTable
        points={points}
        change={view?.kind === "table" ? view.change : {}}
        colors={legendColors}
        deprecatedOnly={narrowedKeys}
        metric={metric}
        added={addedRows}
      />
    );
  }

  async function save() {
    setError(null);
    setSaving(true);
    // On success the action redirects to the saved chart, so this only resolves
    // on failure; the button stays "Saving…" while the navigation lands.
    const res = await saveDashboard({
      ...(saved && !duplicate ? { id: saved.id } : {}),
      name: name.trim(),
      description: description.trim() || null,
      config: range !== "all" && (chartType === "trend" || chartType === "stacked-share") ? { ...config, range } : config,
      visibility,
    });
    setSaving(false);
    setError(actionErrorMessage(res?.error, "save this chart", "Couldn't save the chart. Try again."));
  }

  // Saving without a name or a series says what's missing beside it and moves focus to the first one.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const noName = !name.trim();
    const noSeries = cohorts.length === 0;
    setNameError(noName);
    setSeriesError(noSeries);
    if (noName) nameRef.current?.focus();
    else if (noSeries) seriesSearchRef.current?.focus();
    else void save();
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 id={ids.title} className="text-2xl font-semibold tracking-headline">
          {saved && !duplicate ? "Edit chart" : "New chart"}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Link href={saved ? `/charts/${encodeURIComponent(saved.id)}` : "/charts"} className={cn(buttonVariants({ variant: "ghost" }))}>
            Cancel
          </Link>
          <Button type="submit" form={ids.form} disabled={saving}>
            {saving ? "Saving…" : "Save chart"}
          </Button>
        </div>
      </div>

      <form id={ids.form} aria-labelledby={ids.title} noValidate onSubmit={submit} className="panel space-y-4 p-4">
        {/* Controls strip */}
        <div className="space-y-3 border-b pb-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-[12rem] max-w-[20rem] flex-1 space-y-1.5">
              <label htmlFor={ids.name} className="block text-label text-muted-foreground">
                Name
              </label>
              <Input
                ref={nameRef}
                id={ids.name}
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setNameError(false);
                }}
                placeholder="Legacy vs current"
                aria-invalid={nameError || undefined}
                aria-describedby={nameError ? ids.nameError : undefined}
              />
              {nameError ? <FieldError id={ids.nameError}>Name the chart to save it.</FieldError> : null}
            </div>

            <div className="flex min-w-[10rem] flex-col gap-1.5">
              <label htmlFor={ids.scope} className="block text-label text-muted-foreground">
                Repos
              </label>
              <Select
                value={scopeRepoId}
                onValueChange={setScopeRepoId}
                items={[{ value: null, label: "All repos" }, ...repos.map((r) => ({ value: r, label: r }))]}
              >
                <SelectTrigger id={ids.scope} className={scopeRepoId ? "font-mono" : "font-sans"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All repos</SelectItem>
                  {repos.map((r) => (
                    <SelectItem key={r} value={r} className="font-mono">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Segments
              legend="Chart type"
              name={`${ids.form}-type`}
              value={chartType}
              onChange={setChartType}
              options={CHART_TYPES.map((c) => ({ value: c.value, label: c.label, icon: c.glyph }))}
            />

            <Segments
              legend="Metric"
              hint={
                <span
                  id={ids.metricHint}
                  aria-hidden
                  className="ms-2 whitespace-nowrap text-xs leading-none font-normal"
                  style={effectiveMetric === "share" ? undefined : { visibility: "hidden" }}
                >
                  Share of these series
                </span>
              }
              describedBy={effectiveMetric === "share" ? ids.metricHint : undefined}
              name={`${ids.form}-metric`}
              value={effectiveMetric}
              onChange={setMetric}
              options={[
                { value: "count", label: "Uses", disabled: chartType === "stacked-share" },
                { value: "share", label: "% of uses" },
              ]}
            />

            <Segments
              legend="Visibility"
              name={`${ids.form}-visibility`}
              value={visibility}
              onChange={setVisibility}
              options={(["private", "everyone"] as const).map((v) => {
                const { label, icon: Icon } = VISIBILITY[v];
                return { value: v, label, icon: <Icon aria-hidden className="size-3.5" />, title: visibilityTitle(v, !saved || duplicate) };
              })}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={ids.description} className="block text-label text-muted-foreground">
              Description
            </label>
            <Input
              id={ids.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional. Shown under the chart's name."
            />
          </div>
        </div>

        {/* Series column and preview. On wide screens the column is as tall as the chart and the series table under it, at least 20rem, and scrolls. */}
        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section aria-label="Series" className="relative min-w-0 lg:border-e">
            <div className="flex max-h-[32rem] min-h-0 flex-col gap-3 lg:absolute lg:inset-0 lg:max-h-none lg:pe-4">
              <span className="text-label text-muted-foreground">Series</span>
              {seriesError ? <FieldError id={ids.seriesError}>Add a series to save the chart.</FieldError> : null}
              <SeriesPicker
                inputId={seriesSearchId}
                inputRef={seriesSearchRef}
                describedBy={seriesError ? ids.seriesError : undefined}
                search={pickerUnavailable || pickerError || (scopeRepoId && !scopedPickable) ? null : searchSeriesRows}
                notice={
                  pickerUnavailable ? (
                    <ReadModelState {...pickerUnavailable} embedded refresh={() => setPickerRetry(n => n + 1)} />
                  ) : pickerError ? (
                    <BuilderReadError message="Couldn't load this repo's components." retryLabel="Try again" onRetry={() => setPickerRetry(n => n + 1)} />
                  ) : (
                    <output className="text-sm text-muted-foreground">Loading…</output>
                  )
                }
                series={legend}
                components={pickable}
                libraryTags={libraryTags}
                onToggle={toggleSeries}
              />
            </div>
          </section>

          <div className="min-w-0 space-y-4 lg:min-h-80">
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
              // series table under it is the legend, so the chart's own legend is off.
              <div className={cn("space-y-4 transition-opacity duration-200", loadingPreview && "opacity-50")}>
                <SkippedScansNotice {...preview.skipped} refresh={() => setPreviewRetry(n => n + 1)} />
                {previewType === "table" && !isEmptyView(preview.view) ? null : (
                  <DashboardChart config={preview.config} view={preview.view} showLegend={false} range={range} onRangeChange={setRange} shown={shownLine} onShownChange={setShown} />
                )}
              </div>
            ) : previewType === "table" ? null : (
              <div className="h-[280px]" />
            )}
            {cohorts.length > 0 ? <div ref={seriesTableRef}>{seriesTable()}</div> : null}
            <output className="sr-only">
              <span key={announcement.count}>{announcement.text}</span>
            </output>
          </div>
        </div>
      </form>
    </>
  );
}

/** Scrolls the table's scroll area, and nothing around it, until `row` sits in view below the sticky headings. */
function revealRow(row: HTMLElement) {
  const area = row.closest<HTMLElement>("[data-slot=table-container]");
  if (!area) return;
  const box = area.getBoundingClientRect();
  const top = box.top + (area.querySelector("thead")?.getBoundingClientRect().height ?? 0);
  const { top: rowTop, bottom: rowBottom } = row.getBoundingClientRect();
  if (rowTop < top) area.scrollTop -= top - rowTop;
  else if (rowBottom > box.bottom) area.scrollTop += rowBottom - box.bottom;
}

/** An inline message under a field that says what to fix. */
function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-xs text-destructive">
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

/**
 * A choice of one, as radios drawn as a row of joined buttons, under a visible legend. `hint` sits beside the legend
 * and is left out of the group's name; give its id as `describedBy` while it applies.
 */
function Segments<T extends string>({
  legend,
  hint,
  describedBy,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  hint?: React.ReactNode;
  describedBy?: string | undefined;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ReactNode; disabled?: boolean; title?: string }>;
}) {
  return (
    <fieldset aria-describedby={describedBy} className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 p-0 text-label text-muted-foreground">
        {legend}
        {hint}
      </legend>
      <div className="flex w-fit flex-wrap">
        {options.map((o) => (
          <label
            key={o.value}
            title={o.title}
            className={cn(
              toggleVariants({ variant: "outline" }),
              "cursor-pointer gap-1.5 rounded-none border-s-0 px-2 first:rounded-s-lg first:border-s last:rounded-e-lg has-checked:selected has-disabled:pointer-events-none has-disabled:opacity-50 has-focus-visible:z-10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.icon}
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
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
