import { Fragment } from "react";
import type { RepoDelta } from "@scoutui/web-shared";
import { movementParts, signedCount } from "@/lib/scan-diff-view";

/**
 * What moved since the previous scan, as one item in the repo header's status
 * line: `+3 added · −16 removed · 4 changed since previous scan`, zero parts
 * omitted, in the repos list's words. The deprecated count's movement sits
 * beside the deprecated count instead.
 */
export function ScanDiffLine({ delta }: { delta: RepoDelta | null }) {
  if (delta === null) {
    return <span className="text-xs text-muted-foreground">First scan, nothing to compare</span>;
  }
  const parts = movementParts(delta);
  if (parts.length === 0) {
    return <span className="text-xs text-muted-foreground">No change since previous scan</span>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      {parts.map((p, i) => (
        <Fragment key={p.word}>
          {i > 0 ? <span aria-hidden className="text-faint">· </span> : null}
          <span className="font-medium tabular-nums text-foreground">
            {p.word === "changed" ? p.n.toLocaleString() : signedCount(p.word === "added" ? p.n : -p.n)}
          </span>
          {i < parts.length - 1 ? ` ${p.word} ` : ` ${p.word}`}
        </Fragment>
      ))}
      {" since previous scan"}
    </span>
  );
}
