import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { LeftOutCohort } from "@scoutui/web-shared";
import { CollapsibleNotice, CollapsibleNoticeRow } from "@/components/collapsible-notice";

const SHOWN = 3;

const Dot = () => <span aria-hidden className="text-faint">·</span>;

/** The series a reason row lists: names first, then a count of each kind it has no name for. */
function seriesNames(series: LeftOutCohort[]): string[] {
  const named = series.flatMap(s => (s.label ? [s.label] : []));
  const tags = series.filter(s => !s.label && s.kind === "tag").length;
  const components = series.filter(s => !s.label && s.kind !== "tag").length;
  return [
    ...named,
    ...(tags ? [tags === 1 ? "1 deleted tag" : `${tags} deleted tags`] : []),
    ...(components ? [components === 1 ? "1 unknown component" : `${components} unknown components`] : []),
  ];
}

/**
 * What a saved chart leaves out, closed to a count by reason: series its repo doesn't have, and series no scan holds.
 * Open, each reason names up to three series, and one line says how to get them back: through the editor for someone
 * who can change the chart, otherwise from its creator or an Admin.
 */
export function LeftOutSeriesNotice({ series, repoId, editHref }: { series: LeftOutCohort[]; repoId: string | null; editHref: string | null }) {
  const elsewhere = repoId ? series.filter(s => s.reason === "elsewhere") : [];
  const missing = series.filter(s => !elsewhere.includes(s));
  const reasons: Array<{ key: string; series: LeftOutCohort[]; label: ReactNode }> = [
    ...(elsewhere.length ? [{ key: "elsewhere", series: elsewhere, label: <>not in <span className="font-mono">{repoId}</span></> }] : []),
    ...(missing.length ? [{ key: "missing", series: missing, label: <>can&apos;t be found</> }] : []),
  ];
  const them = series.length === 1 ? "it" : "them";
  const fix = elsewhere.length ? ` to pick All repos or another repo, or remove ${them}.` : ` to remove ${them}.`;
  return (
    <CollapsibleNotice
      icon={<AlertTriangle aria-hidden className="size-3.5 shrink-0 text-status-warn" />}
      summary={
        <>
          <span className="font-medium text-foreground">{series.length === 1 ? "1 series is left out" : `${series.length} series are left out`}</span>
          <span className="flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground">
            <Dot />
            {reasons.map((reason, i) => (
              <span key={reason.key}>
                {reasons.length > 1 ? <span className="tabular-nums">{reason.series.length} </span> : null}
                {reason.label}
                {i < reasons.length - 1 ? "," : null}
              </span>
            ))}
          </span>
        </>
      }
    >
      {reasons.map(reason => {
        const names = seriesNames(reason.series);
        const more = names.length - SHOWN;
        return (
          <CollapsibleNoticeRow key={reason.key}>
            <p className="text-foreground">
              <span className="font-medium tabular-nums">{reason.series.length}</span> {reason.label}
            </p>
            <p className="flex flex-wrap gap-x-1.5 text-muted-foreground">
              {names.slice(0, SHOWN).map((name, i) => (
                <span key={name} className="flex min-w-0 items-baseline gap-x-1.5">
                  {i > 0 ? <Dot /> : null}
                  <span className="break-all font-mono text-foreground/80">{name}</span>
                </span>
              ))}
              {more > 0 ? <span className="flex items-baseline gap-x-1.5 whitespace-nowrap"><Dot /> {more} more</span> : null}
            </p>
          </CollapsibleNoticeRow>
        );
      })}
      <CollapsibleNoticeRow>
        <p className="text-muted-foreground">
          {editHref ? (
            <Link href={editHref} className="rounded-sm text-foreground underline-offset-4 hover:underline">Edit the chart</Link>
          ) : (
            "Ask the chart's creator or an Admin"
          )}
          {fix}
        </p>
      </CollapsibleNoticeRow>
    </CollapsibleNotice>
  );
}
