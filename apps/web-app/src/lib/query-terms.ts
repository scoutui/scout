// The `?q=` term grammar every faceted page writes and reads: liqe
// `field:value` terms, ANDed by spaces, with several values of one field ORed in
// parens. Each page's facet module keeps only its own fields.

/** A `field:value` term. liqe treats `/`, whitespace, `:` and parens as
 *  special, so a value holding any of them is quoted; double quotes are dropped. */
export function term(field: string, value: string): string {
  const bare = value.replace(/"/g, "");
  return `${field}:${/[\s/:()]/.test(bare) ? `"${bare}"` : bare}`;
}

/** One term per value, ORed in parens when there are several; "" for none. */
export function orGroup(field: string, values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return term(field, values[0] ?? "");
  return `(${values.map((v) => term(field, v)).join(" OR ")})`;
}

/** The search box's `name:` term, or "" when the text is blank. The text isn't
 *  trimmed: trimming would round-trip a trailing space out of the URL while the
 *  user is still typing. Matching trims it. */
export function nameTerm(text: string): string {
  return text.trim() === "" ? "" : term("name", text);
}

/** The terms joined into one query, leaving out empty ones. */
export function joinTerms(terms: readonly string[]): string {
  return terms.filter(Boolean).join(" ");
}

/** Every term of the given fields in a query, in order, with its value unquoted.
 *  Fields match case-insensitively and come back lower-case; other fields and
 *  empty values are skipped, so a hand-written query reads as far as it can. */
export function readTerms(q: string, fields: readonly string[]): { field: string; value: string }[] {
  const re = new RegExp(`\\b(${fields.join("|")}):("[^"]*"|[^\\s()]+)`, "gi");
  const terms: { field: string; value: string }[] = [];
  for (const m of q.matchAll(re)) {
    const value = (m[2] ?? "").replace(/^"|"$/g, "");
    if (value !== "") terms.push({ field: (m[1] ?? "").toLowerCase(), value });
  }
  return terms;
}
