import chartColorData from "@scoutui/palette/chart-colors.json";
import type { TagColour } from "@scoutui/web-shared";

/** The theme token each tag colour draws with. */
const TAG_COLOUR_TOKENS = new Map<string, string>(
  Object.entries({
    teal: "var(--viz-primary)",
    violet: "var(--viz-cat-2)",
    blue: "var(--viz-cat-3)",
    berry: "var(--viz-cat-4)",
    orchid: "var(--viz-cat-5)",
  } satisfies Record<TagColour, string>),
);

/** A tag colour's theme token, or undefined for anything that isn't a tag colour. */
export function paletteToken(colour: string): string | undefined {
  return TAG_COLOUR_TOKENS.get(colour);
}

/**
 * The colours a chart gives, in order, to lines that bring no colour of their own.
 * The order and the lookalike pairs live in `@scoutui/palette/chart-colors.json`.
 */
export const CHART_ORDER = chartColorData.order.map((c) => c.token);

const PRIMITIVE_BY_TOKEN = new Map(
  [...chartColorData.order, ...chartColorData.fixed].map((c) => [c.token, c.primitive] as const),
);

const LOOKALIKE_PAIRS: readonly (readonly string[])[] = chartColorData.lookalikes;
const LOOKALIKES = new Set(LOOKALIKE_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

/** Whether two chart colours are the same, or a pair some readers can't tell apart in either theme. */
export function looksAlike(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = PRIMITIVE_BY_TOKEN.get(a);
  const pb = PRIMITIVE_BY_TOKEN.get(b);
  return pa !== undefined && pb !== undefined && LOOKALIKES.has(`${pa}|${pb}`);
}

export function tagColourName(colour: TagColour): string {
  return colour.charAt(0).toUpperCase() + colour.slice(1);
}
