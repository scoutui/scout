/** Every string in a figure that a viewer reads, leaving out colours and the marks' kind. */
export function figureTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(figureTexts);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => (["color", "palette", "kind", "align"].includes(key) ? [] : figureTexts(v)));
}
