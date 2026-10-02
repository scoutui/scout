import { Fragment } from "react";
import { GitCompareArrows } from "lucide-react";
import type { ScanDiff } from "@scoutui/web-shared";
import { scanDiffMoved, scanDiffRowCount } from "@scoutui/web-shared/client";
import { formatAbsoluteUtc } from "@/lib/format-absolute";
import { durationLabel } from "@/lib/relative-time";
import { movementParts } from "@/lib/scan-diff-view";

/**
 * What moved since the previous scan, as one line in the masthead's status row:
 * `3 added · 8 removed · 18 changed`, zero segments omitted. The deprecated
 * count's movement sits beside the deprecated alarm instead. The icon shows
 * only when rows moved (`scanDiffRowCount`).
 *
 * `since previous scan (3d earlier)` is the gap from the baseline to the shown
 * scan (`committedAt`), with the baseline's absolute time on hover.
 *
 * The line has two flex children, the icon and one inline text span, so the
 * separators sit between real text spaces.
 */
export function ScanDiffLine({ diff, committedAt }: { diff: ScanDiff | null; committedAt: string }) {
  if (diff === null) {
    return <span className="text-xs text-muted-foreground">first scan · nothing to compare</span>;
  }
  const since = <Since diff={diff} committedAt={committedAt} />;
  if (scanDiffRowCount(diff) === 0) {
    // Only the deprecated count moved (the alarm beside this line says by how
    // much), or nothing did.
    return (
      <span className="text-xs text-muted-foreground">
        {scanDiffMoved(diff) ? "nothing added, removed or changed" : "no change"}
        {since}
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1.5 text-xs text-muted-foreground">
      <GitCompareArrows aria-hidden className="size-3.5 shrink-0 translate-y-0.5" />
      <span>
        {movementParts(diff).map((p, i) => (
          <Fragment key={p.word}>
            {i > 0 ? <Sep /> : null}
            <Count n={p.n} word={p.word} />
          </Fragment>
        ))}
        {since}
      </span>
    </span>
  );
}

// Every space that follows an inline element shares a text node with the word
// after it (` added`, ` since previous scan (`). Chrome drops a whitespace-only
// text node beside an inline element from the accessibility tree, so the line
// would read as "3added 8removed 18changedsince previous scan".

/** ` since previous scan (3d earlier)`: the gap between the two scans, `(same
 *  time)` under a minute, the baseline's absolute time on hover. The
 *  parenthetical never breaks: at 390px it split into `(3d` / `earlier)`. */
function Since({ diff, committedAt }: { diff: ScanDiff; committedAt: string }) {
  const gapSeconds = Math.max(0, Math.floor((Date.parse(committedAt) - Date.parse(diff.baselineCommittedAt)) / 1000));
  const gap = durationLabel(gapSeconds);
  return (
    <>
      {" since previous scan "}
      <span className="whitespace-nowrap">
        {"("}
        <span title={formatAbsoluteUtc(diff.baselineCommittedAt)}>{gap === "just now" ? "same time" : `${gap} earlier`}</span>
        {")"}
      </span>
    </>
  );
}

function Count({ n, word }: { n: number; word: string }) {
  return (
    <>
      <span className="font-medium tabular-nums text-foreground">{n.toLocaleString()}</span>
      {` ${word}`}
    </>
  );
}

/** The spaces sit outside the hidden dot, so both the text and the accessible
 *  name keep them: `3 added · 8 removed`, read as "3 added 8 removed". */
function Sep() {
  return (
    <>
      {" "}
      <span aria-hidden className="text-muted-foreground/70">
        ·
      </span>{" "}
    </>
  );
}
