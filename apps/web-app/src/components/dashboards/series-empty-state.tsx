import { useId } from "react";
import { CHART_SERIES_PALETTE, paletteToken } from "@/lib/chart-palette";

/**
 * Empty state for the chart builder: a faded example of a legacy library declining
 * as its replacement rises, drawn like the real trend chart. It is static, so it
 * needs no reduced-motion handling.
 */
export function SeriesEmptyState() {
  const gid = useId();
  const replacementColor = paletteToken(CHART_SERIES_PALETTE[0]); // teal: the rising replacement
  const legacyColor = paletteToken(CHART_SERIES_PALETTE[3]); // grey: the declining legacy library
  const rising = "0,108 64,92 128,70 192,46 256,26 320,12";
  const declining = "0,14 64,28 128,46 192,70 256,90 320,104";
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-5 px-4 text-center">
      <svg
        viewBox="-4 0 380 120"
        className="h-[120px] w-full max-w-[380px] opacity-60"
        role="img"
        aria-label="Example chart: one library declining while another rises"
      >
        <defs>
          <linearGradient id={`${gid}-rise`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: replacementColor, stopOpacity: 0.2 }} />
            <stop offset="100%" style={{ stopColor: replacementColor, stopOpacity: 0.02 }} />
          </linearGradient>
          <linearGradient id={`${gid}-fall`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: legacyColor, stopOpacity: 0.16 }} />
            <stop offset="100%" style={{ stopColor: legacyColor, stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>
        {/* recessive gridlines, as in the real chart */}
        {[24, 56, 88].map((y) => (
          <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="var(--border)" strokeOpacity="0.6" strokeWidth="1" />
        ))}
        <line x1="0" y1="118" x2="320" y2="118" stroke="var(--border)" strokeWidth="1" />
        {/* declining legacy (grey) with its wash */}
        <polygon points={`${declining} 320,118 0,118`} fill={`url(#${gid}-fall)`} />
        <polyline
          points={declining}
          fill="none"
          stroke={legacyColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="320" cy="104" r="3.5" fill={legacyColor} stroke="var(--card)" strokeWidth="2" />
        <text x="328" y="107" fontSize="11" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
          legacy
        </text>
        {/* rising replacement (teal) with its wash */}
        <polygon points={`${rising} 320,118 0,118`} fill={`url(#${gid}-rise)`} />
        <polyline
          points={rising}
          fill="none"
          stroke={replacementColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="320" cy="12" r="3.5" fill={replacementColor} stroke="var(--card)" strokeWidth="2" />
        <text x="328" y="15" fontSize="11" fontFamily="var(--font-mono)" fill="var(--muted-foreground)">
          core
        </text>
      </svg>
      <p className="max-w-xs text-sm text-muted-foreground">
        Add two or more series to compare them over time, such as an old library declining as its
        replacement rises.
      </p>
    </div>
  );
}
