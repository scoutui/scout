import type { QueryParams } from "@/lib/query-string";

/** The repos list's search text and its `since previous scan` chip. */
export type RepoQuery = { text: string; changed: boolean };

export const REPO_QUERY_PARAMS = ["q", "changed"];

export function parseRepoQuery(params: URLSearchParams): RepoQuery {
  return { text: params.get("q") ?? "", changed: params.get("changed") === "true" };
}

/** The text is kept untrimmed, so a trailing space survives while the user is still typing. */
export function serializeRepoQuery(s: RepoQuery): QueryParams {
  const params: [string, string][] = [];
  if (s.text !== "") params.push(["q", s.text]);
  if (s.changed) params.push(["changed", "true"]);
  return params;
}
