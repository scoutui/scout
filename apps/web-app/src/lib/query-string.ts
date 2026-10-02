/** Search params in order; a name repeats once per value. */
export type QueryParams = readonly (readonly [string, string])[];

/** Characters `encodeURIComponent` escapes that a query value can hold as typed. */
const KEPT = /%(?:3A|40|2F|3F|2C|3B|24)/g;

function encodeQueryPart(part: string): string {
  return encodeURIComponent(part).replace(KEPT, decodeURIComponent).replace(/%20/g, "+");
}

/**
 * The query every dashboard URL writes. Percent-encodes only what a query
 * can't hold as typed (`&`, `#`, `+`, `%`, `=`, quotes, brackets, non-ASCII);
 * `:`, `@`, `/`, `?`, `,` and `;` stay readable, and a space is `+`.
 */
export function queryString(params: QueryParams): string {
  return params.map(([name, value]) => `${encodeQueryPart(name)}=${encodeQueryPart(value)}`).join("&");
}

export function hrefWithQuery(path: string, params: QueryParams): string {
  const query = queryString(params);
  return query ? `${path}?${query}` : path;
}
