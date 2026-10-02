"use client";

import { useMemo } from "react";
import { GitCompareArrows, Search, X } from "lucide-react";
import type { RepoSummary } from "@scoutui/web-shared";
import { repoDeltaMoved } from "@scoutui/web-shared/client";
import { Input } from "@/components/ui/input";
import { StatusFilterChip } from "@/components/status-filter-chip";
import { ReposTable } from "@/components/repos/repos-table";
import { parseGitRemote } from "@scoutui/scan-format/git-remote";
import { useQueryParamsState } from "@/lib/use-query-synced-state";
import { parseRepoQuery, REPO_QUERY_PARAMS, serializeRepoQuery, type RepoQuery } from "@/lib/repo-query";

/**
 * The repos page's search strip: a text search plus the `since previous scan`
 * status chip. The server ships every row once and filtering runs here; the
 * query lives in the URL via useQueryParamsState and writes back through
 * history.replaceState, so a filtered view stays shareable.
 */
export function ReposExplorer({
  rows,
}: {
  rows: RepoSummary[];
}) {
  const [query, setQuery] = useQueryParamsState<RepoQuery>(REPO_QUERY_PARAMS, parseRepoQuery, serializeRepoQuery);
  const text = query.text;
  const setText = (next: string) => setQuery({ ...query, text: next });

  const movedCount = useMemo(() => rows.filter(moved).length, [rows]);
  // A pasted ?changed=true with nothing moved narrows nothing: the chip is absent
  // at zero, so nothing on the page could clear it (the repo page ignores the
  // token on a first scan the same way).
  const changedActive = query.changed && movedCount > 0;
  const filtered = useMemo(() => {
    const byText = filterRepoRows(rows, text);
    return changedActive ? byText.filter(moved) : byText;
  }, [rows, text, changedActive]);
  const filtering = text.trim().length > 0 || changedActive;

  return (
    <div className="panel overflow-hidden">
      {/* The search caps at max-w-md and the narrowed count sits at the right
          edge (`ml-auto`), so the count appearing only fills the free gap and
          never moves the chip. */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <div className="relative min-w-0 max-w-md flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search repos by id, remote, or branch"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Search ${rows.length.toLocaleString()} repos…`}
            className="h-8 pl-8 font-mono text-xs placeholder:font-sans"
          />
          {text ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setText("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        {/* Counts repos that moved; pressing it again clears it. */}
        {movedCount > 0 ? (
          <StatusFilterChip
            icon={GitCompareArrows}
            tone="neutral"
            label="since previous scan"
            count={movedCount}
            active={changedActive}
            onToggle={() => setQuery({ ...query, changed: !changedActive })}
          />
        ) : null}
        {/* Only a narrowed count shows here: the total is in the page meta
            and the placeholder. */}
        {filtering ? (
          <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
            <span className="font-medium text-foreground">{filtered.length.toLocaleString()}</span> of {rows.length.toLocaleString()}
          </span>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No repos match <span className="font-mono">{text.trim()}</span>.
          </p>
          <button
            type="button"
            onClick={() => setText("")}
            className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear search
          </button>
        </div>
      ) : (
        <ReposTable rows={filtered} />
      )}
    </div>
  );
}

function filterRepoRows(rows: RepoSummary[], text: string): RepoSummary[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => {
    const remote = parseGitRemote(r.gitRemote)?.display ?? r.gitRemote ?? "";
    return (
      r.repoId.toLowerCase().includes(needle) ||
      remote.toLowerCase().includes(needle) ||
      (r.branch ?? "").toLowerCase().includes(needle)
    );
  });
}

/** Moved since its previous scan: a component added, removed or changed, or the
 *  deprecated count moved. A first scan (no delta) never moved. */
function moved(r: RepoSummary): boolean {
  return r.delta !== null && repoDeltaMoved(r.delta);
}
