/** Example data for the invented company, Acme: twelve monthly scans across all 14 repos. */

export const MONTHS = [
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
] as const;

/** Month indexes that keep their tick label on narrow screens. */
export const MAJOR_TICKS: ReadonlySet<number> = new Set([0, 3, 6, 9, 11]);

type Scan = { ui: number; legacy: number };

/** Component uses per scan: `@acme/ui` and `@acme/legacy-ui`. */
export const SCANS: readonly Scan[] = [
  { ui: 1670, legacy: 3898 },
  { ui: 1820, legacy: 3812 },
  { ui: 1905, legacy: 3790 },
  { ui: 2450, legacy: 3520 },
  { ui: 2610, legacy: 3480 },
  { ui: 3300, legacy: 3160 },
  { ui: 3420, legacy: 3105 },
  { ui: 4380, legacy: 2740 },
  { ui: 4590, legacy: 2690 },
  { ui: 5020, legacy: 2560 },
  { ui: 5520, legacy: 2391 },
  { ui: 5930, legacy: 2127 },
];

/** The web app's percentage format: one decimal, with a trailing ".0" dropped. */
function formatPct(value: number): string {
  if (value <= 0) return "0%";
  if (value < 0.001) return "<0.1%";
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

/** Uses of `@acme/ui`'s `Button` in each scan, across all repos. */
export const BUTTON_UI: readonly number[] = [88, 92, 110, 124, 124, 190, 214, 214, 280, 331, 454, 486];

/** Uses of the legacy `Button` from `@acme/legacy-ui` in each scan, across all repos. */
export const BUTTON_LEGACY: readonly number[] = [612, 612, 598, 580, 580, 522, 505, 505, 441, 402, 330, 312];

/**
 * A migration's readout and its change, in the web app's words: the successor's share of uses across the pair in
 * the latest scan, and in the scan before.
 */
function migration(successor: readonly number[], legacy: readonly number[]): { now: string; delta: string } {
  const share = (i: number) => successor[i] / (successor[i] + legacy[i]);
  const last = successor.length - 1;
  return { now: formatPct(share(last)), delta: `up from ${formatPct(share(last - 1))} last scan` };
}

/** `@acme/legacy-ui` superseded by `@acme/ui`, the whole package. */
export const PACKAGE_MIGRATION = migration(
  SCANS.map((s) => s.ui),
  SCANS.map((s) => s.legacy),
);

/** The legacy `Button` superseded by `@acme/ui`'s `Button`, one component. */
export const BUTTON_MIGRATION = migration(BUTTON_UI, BUTTON_LEGACY);

/** Uses of the retired `Carousel` from `@acme/legacy-ui` left in each scan, across all repos. The last 31 are in 2 repos. */
export const CAROUSEL_REMAINING: readonly number[] = [118, 118, 112, 104, 104, 96, 81, 81, 66, 52, 40, 31];

/** The retirement readout and its change, in the web app's words. */
export const RETIRED_NOW = CAROUSEL_REMAINING[CAROUSEL_REMAINING.length - 1];
export const RETIRED_DELTA = `down from ${CAROUSEL_REMAINING[CAROUSEL_REMAINING.length - 2]} last scan`;
