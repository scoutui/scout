import chartColorData from "@scoutui/palette/chart-colors.json";

/**
 * The tag colour palette, in order. Chart lines that bring no colour of their
 * own take theirs from `CHART_ORDER` instead.
 *
 * A tag picked from the palette stores one of these sRGB hex values.
 * `paletteToken` renders each of them through its theme token, so a
 * palette-picked tag follows dark mode and any palette change. The values are
 * the sRGB renderings of the `--viz-cat-*` hues, at a lightness that reads on
 * both the light and the near-black dark chart surfaces.
 *
 * The status hues (red, orange, green) are left out, so a cohort dot can't be
 * misread as an error, as deprecated or as gain.
 *
 * Violet and blue sit at different lightness (0.62 vs 0.50), not just hue: at
 * equal lightness the pair collapses under deuteranopia (ΔE 1.9). As stepped,
 * the worst adjacent pair clears CVD ΔE 8.1 and normal-vision ΔE 15.5 on both
 * the white and near-black chart surfaces (dataviz validator). Grey sits below
 * the validator's chroma floor on purpose: it is the legacy and "other"
 * neutral, and `CHART_ORDER` leaves it out.
 */
export const CHART_SERIES_PALETTE = [
  "#009598", // teal    (viz-primary)  oklch(0.60 0.12 196)
  "#9b6bce", // violet  (viz-cat-2)    oklch(0.62 0.15 305)
  "#2863ab", // blue    (viz-cat-3)    oklch(0.50 0.13 255)
  "#7d8088", // grey    (viz-legacy)   oklch(0.60 0.012 265), the legacy and "other" neutral
] as const;

/**
 * Tag colours render through `paletteToken`: a tag picked from the palette
 * stores one of its four hex values, which becomes its theme token, so the tag
 * gets the dark-mode variant. Any other hex is the user's exact choice and
 * renders as written.
 */
const PALETTE_TOKENS: Record<string, string> = {
  "#009598": "var(--viz-primary)",
  "#9b6bce": "var(--viz-cat-2)",
  "#2863ab": "var(--viz-cat-3)",
  "#7d8088": "var(--viz-legacy)",
};

export function paletteToken(hex: string): string {
  return PALETTE_TOKENS[hex] ?? hex;
}

/**
 * The colours a chart gives, in order, to lines that bring no colour of their own.
 * The order and the lookalike pairs live in `@scoutui/palette/chart-colors.json`.
 */
export const CHART_ORDER = chartColorData.order.map((c) => c.token);

const PRIMITIVE_BY_TOKEN = new Map(
  [...chartColorData.order, ...chartColorData.fixed].map((c) => [c.token, c.primitive] as const),
);

const LOOKALIKES = new Set(chartColorData.lookalikes.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

/** Whether two chart colours are the same, or a pair some readers can't tell apart in either theme. */
export function looksAlike(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = PRIMITIVE_BY_TOKEN.get(a);
  const pb = PRIMITIVE_BY_TOKEN.get(b);
  return pa !== undefined && pb !== undefined && LOOKALIKES.has(`${pa}|${pb}`);
}

const PALETTE_NAMES = ["Teal", "Violet", "Blue", "Grey"];

export function tagColourName(hex: string): string {
  return PALETTE_NAMES[CHART_SERIES_PALETTE.findIndex((c) => c === hex)] ?? hex;
}
