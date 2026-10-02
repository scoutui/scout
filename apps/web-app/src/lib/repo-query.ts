/** The launchpad's `?q=`: free text, optionally led by the one structured
 *  token the page understands. The token leads so the text after it can keep
 *  its trailing whitespace exactly: trimming would round-trip a mid-word
 *  trailing space back out of the URL and clobber it while the user is still
 *  typing (the explorer's `filterRepoRows` trims for matching). */
export type RepoQuery = { text: string; changed: boolean };

const TOKEN = "changed:true";

export function parseRepoQuery(q: string): RepoQuery {
  if (q === TOKEN) return { text: "", changed: true };
  if (q.startsWith(`${TOKEN} `)) return { text: q.slice(TOKEN.length + 1), changed: true };
  return { text: q, changed: false };
}

export function serializeRepoQuery(s: RepoQuery): string {
  if (!s.changed) return s.text;
  return s.text === "" ? TOKEN : `${TOKEN} ${s.text}`;
}
