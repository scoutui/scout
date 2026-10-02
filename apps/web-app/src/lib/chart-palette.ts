/**
 * The ordered cohort and series colour palette, used wherever a cohort or tag
 * gets a colour that no role assigns.
 *
 * Authored sRGB hex, not theme tokens (`var(--chart-*)`): a tag's colour is a
 * stable authored value, and a saved chart's lines must not shift if the tokens
 * are re-tuned. The values are the sRGB renderings of the `--viz-cat-*` hues, at
 * a lightness that reads on both the light and the near-black dark chart
 * surfaces.
 *
 * The status hues (red, orange, green) are left out, so a cohort dot can't be
 * misread as an error, as deprecated or as gain. A series that repeats a colour
 * already in use takes the next dash step instead (`seriesDashes`).
 *
 * Violet and blue sit at different lightness (0.62 vs 0.50), not just hue: at
 * equal lightness the pair collapses under deuteranopia (ΔE 1.9). As stepped,
 * the worst adjacent pair clears CVD ΔE 8.1 and normal-vision ΔE 15.5 on both
 * the white and near-black chart surfaces (dataviz validator). Grey sits below
 * the validator's chroma floor on purpose: it is the legacy and "other"
 * neutral, not an identity hue.
 */
export const CHART_SERIES_PALETTE = [
  "#009598", // teal    (viz-primary)  oklch(0.60 0.12 196)
  "#9b6bce", // violet  (viz-cat-2)    oklch(0.62 0.15 305)
  "#2863ab", // blue    (viz-cat-3)    oklch(0.50 0.13 255)
  "#7d8088", // grey    (viz-legacy)   oklch(0.60 0.012 265), the legacy and "other" neutral
] as const;

// The palette minus its grey slot. Uncoloured chart cohorts rotate over these
// (`cohortColor`): grey means legacy or local in a chart, so an auto-assigned grey
// cohort would read as a second `local` series. Grey stays available as an
// authored tag colour (`nextTagColor`).
const IDENTITY_HUES = CHART_SERIES_PALETTE.slice(0, 3);

/** Stroke/fill for the Nth uncoloured chart cohort: identity hues only, wrapping. */
export function identityColor(index: number): string {
  return IDENTITY_HUES[index % IDENTITY_HUES.length] ?? CHART_SERIES_PALETTE[0];
}

/**
 * Tag colours render through `paletteToken`: a stored hex that is one of the
 * four palette values becomes its theme token, so palette-picked tags get the
 * dark-mode variants. Any other hex is the user's exact choice and renders as
 * written.
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
