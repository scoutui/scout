import type { CohortSeries, DashboardConfig, DashboardView } from "@scoutui/web-shared";
import { chartColors, drawnChartCohorts, savedChartCohorts, seriesWashes } from "@/lib/dashboard-chart-data";

const W = 112;
const H = 32;
const PAD = 3;

/** The minimal cohort shape the mini marks need. */
type SparkPoint = { cohortKey: string; color: string; value: number };

/**
 * A small SVG preview of a dashboard, sized for a list row. Each kind mirrors its
 * full chart: trend lines washed per `seriesWashes`, horizontal bars, or stacked
 * share bands. `uid` namespaces the SVG gradient ids per row.
 */
export function DashboardSparkline({
  uid,
  config,
  view,
}: {
  uid: string;
  config: DashboardConfig;
  view: DashboardView | null;
}) {
  if (!view) return <EmptySpark />;
  const gid = `spark-${uid.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const colors = chartColors(savedChartCohorts(config.cohorts, drawnChartCohorts(view)));
  if (config.chartType === "trend") {
    return view.kind === "series" ? <TrendSpark gid={gid} series={view.series} colors={colors} /> : <EmptySpark />;
  }
  if (config.chartType === "stacked-share") {
    return view.kind === "series" ? <ShareSpark series={view.series} colors={colors} /> : <EmptySpark />;
  }
  if (view.kind === "series") return <EmptySpark />;
  return <BarsSpark points={view.points.map((p) => ({ cohortKey: p.cohortKey, color: colors.get(p.cohortKey) ?? "", value: p.value }))} />;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  // Hidden from assistive tech so its kind ("library share over time") stays out of
  // the enclosing link's accessible name. `title` stays for the pointer tooltip.
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden focusable="false" className="shrink-0">
      <title>{title}</title>
      {children}
    </svg>
  );
}

function TrendSpark({ gid, series, colors }: { gid: string; series: CohortSeries[]; colors: ReadonlyMap<string, string> }) {
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (values.length === 0) return <EmptySpark />;
  const max = Math.max(1, ...values);
  const n = Math.max(...series.map((s) => s.points.length));
  const xAt = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const yAt = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const washes = seriesWashes(series);
  return (
    <Frame title="usage trend">
      <defs>
        {series.map((s, si) => (
          <linearGradient key={s.cohortKey} id={`${gid}-${si}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: colors.get(s.cohortKey), stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: colors.get(s.cohortKey), stopOpacity: 0.02 }} />
          </linearGradient>
        ))}
      </defs>
      {series.map((s, si) => {
        const color = colors.get(s.cohortKey);
        const [first] = s.points;
        const last = s.points[s.points.length - 1];
        if (s.points.length === 1 && first) {
          return <circle key={s.cohortKey} cx={xAt(0)} cy={yAt(first.value)} r={2} fill={color} />;
        }
        const line = s.points
          .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`)
          .join(" ");
        const area = `${line} L${xAt(s.points.length - 1).toFixed(1)},${H - PAD} L${xAt(0).toFixed(1)},${H - PAD} Z`;
        return (
          <g key={s.cohortKey}>
            {washes[si] ? <path d={area} fill={`url(#${gid}-${si})`} stroke="none" /> : null}
            <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            {last ? <circle cx={xAt(s.points.length - 1)} cy={yAt(last.value)} r={2} fill={color} /> : null}
          </g>
        );
      })}
    </Frame>
  );
}

/** Horizontal mini bars, one row per cohort, as in the full chart. */
function BarsSpark({ points }: { points: SparkPoint[] }) {
  if (points.length === 0) return <EmptySpark />;
  const ranked = [...points].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...ranked.map((p) => p.value));
  const slot = (H - 2 * PAD) / ranked.length;
  const bh = Math.max(2.5, Math.min(6, slot - 1.5));
  return (
    <Frame title="cohort comparison">
      {ranked.map((p, i) => {
        const w = Math.max(1.5, (p.value / max) * (W - 2 * PAD));
        const y = PAD + i * slot + (slot - bh) / 2;
        return <rect key={p.cohortKey} x={PAD} y={y} width={w} height={bh} rx={1.5} fill={p.color} />;
      })}
    </Frame>
  );
}

/** 100%-stacked mini area over scans; a single-scan dashboard falls back to the flat bands. */
function ShareSpark({ series, colors }: { series: CohortSeries[]; colors: ReadonlyMap<string, string> }) {
  const n = Math.max(0, ...series.map((s) => s.points.length));
  if (n === 0) return <EmptySpark />;
  if (n === 1) {
    const segs = series.map((s) => ({ cohortKey: s.cohortKey, color: colors.get(s.cohortKey) ?? "", value: s.points[0]?.value ?? 0 }));
    return <StackedBandsSpark points={segs} />;
  }
  const xAt = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const yAt = (frac: number) => PAD + (1 - frac) * (H - 2 * PAD);
  // Cumulative share per timestamp, normalised so bands always fill the frame.
  const totals = Array.from({ length: n }, (_, ti) => Math.max(1e-9, series.reduce((sum, s) => sum + (s.points[ti]?.value ?? 0), 0)));
  let lower = Array.from({ length: n }, () => 0);
  const bands = series.map((s) => {
    const upper = lower.map((lo, ti) => lo + (s.points[ti]?.value ?? 0) / (totals[ti] ?? 1));
    const top = upper.map((u, ti) => `${ti === 0 ? "M" : "L"}${xAt(ti).toFixed(1)},${yAt(u).toFixed(1)}`).join(" ");
    const back = [...lower.keys()]
      .reverse()
      .map((ti) => `L${xAt(ti).toFixed(1)},${yAt(lower[ti] ?? 0).toFixed(1)}`)
      .join(" ");
    const d = `${top} ${back} Z`;
    lower = upper;
    return { key: s.cohortKey, d, color: colors.get(s.cohortKey) ?? "" };
  });
  return (
    <Frame title="library share over time">
      {bands.map((b) => (
        <path key={b.key} d={b.d} fill={b.color} fillOpacity={0.85} />
      ))}
    </Frame>
  );
}

function StackedBandsSpark({ points }: { points: SparkPoint[] }) {
  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return <EmptySpark />;
  const barH = 10;
  const y = (H - barH) / 2;
  const GAP = 2;
  const usable = W - 2 * PAD - GAP * Math.max(0, points.length - 1);
  let cursor = PAD;
  const segs = points.map((p) => {
    const w = Math.max(2, (p.value / total) * usable);
    const seg = { key: p.cohortKey, x: cursor, w, color: p.color };
    cursor += w + GAP;
    return seg;
  });
  return (
    <Frame title="library share">
      {segs.map((s) => (
        <rect key={s.key} x={s.x} y={y} width={s.w} height={barH} rx={2} fill={s.color} />
      ))}
    </Frame>
  );
}

function EmptySpark() {
  return (
    <Frame title="no data">
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="var(--border)" strokeWidth={1} />
    </Frame>
  );
}
