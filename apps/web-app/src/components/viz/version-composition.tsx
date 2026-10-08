/** Occurrences split by version: the latest in the primary colour, everything
 *  older in legacy grey. The package and component mastheads both use it for
 *  version ordering and latest detection. */

import { compareVersions } from "@/lib/version-order";

export type VersionShare = {
  label: string;
  occurrences: number;
  percent: number;
  latest: boolean;
};


/** Occurrences per version, latest first, unversioned last. Empty when there
 *  are no versions at all (a workspace-local package). */
export function computeVersionShare(
  entries: readonly { version: string | null; occurrenceCount: number }[],
  distinctVersionCount: number,
): VersionShare[] {
  if (distinctVersionCount === 0) return [];
  const byVersion = new Map<string | null, number>();
  for (const e of entries) {
    byVersion.set(e.version, (byVersion.get(e.version) ?? 0) + e.occurrenceCount);
  }
  const total = [...byVersion.values()].reduce((n, v) => n + v, 0);
  if (total === 0) return [];
  const sorted = [...byVersion.entries()].sort((a, b) => {
    if (a[0] === null) return 1;
    if (b[0] === null) return -1;
    return compareVersions(b[0], a[0]);
  });
  return sorted.map(([version, occurrences], i) => ({
    label: version ?? "unversioned",
    occurrences,
    percent: (occurrences / total) * 100,
    latest: i === 0 && version !== null,
  }));
}

/** The latest real version in a share, or null when fully unversioned. */
export function latestVersion(share: readonly VersionShare[]): string | null {
  const head = share.find(s => s.latest);
  return head ? head.label : null;
}

export function VersionComposition({ share }: { share: VersionShare[] }) {
  if (share.length === 0) return null;
  const latest = share.find(v => v.latest);
  const others = share.filter(v => !v.latest);
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-2 w-56 gap-px overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Uses by version: ${share
          .map(v => `${v.label} ${v.occurrences.toLocaleString()}`)
          .join(", ")}`}
      >
        {share.map(v => (
          <div
            key={v.label}
            className={v.latest ? "bg-viz-primary" : "bg-viz-legacy"}
            style={{ width: `${v.percent}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {latest ? <LegendDot className="bg-viz-primary" label={latest.label} mono value={latest.occurrences} /> : null}
        {others.length > 0 ? (
          <LegendDot
            className="bg-viz-legacy"
            label="other"
            mono={false}
            value={others.reduce((n, v) => n + v.occurrences, 0)}
          />
        ) : null}
      </div>
    </div>
  );
}

function LegendDot({
  className,
  label,
  value,
  mono,
}: {
  className: string;
  label: string;
  value: number;
  mono: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${className}`} />
      <span className={mono ? "font-mono tabular-nums text-muted-foreground" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums text-foreground">{value.toLocaleString()}</span>
    </span>
  );
}
