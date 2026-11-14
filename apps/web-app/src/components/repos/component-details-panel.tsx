"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, Code, X } from "lucide-react";
import type { ComponentRow, DiffMark, TopProp, TopPropValue } from "@scoutui/web-shared";
import { friendlyKind, plural, valueLabel, valueSpeech } from "@scoutui/web-shared/client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { MigrationLine } from "@/components/governance/migration-line";
import { Track } from "@/components/component-detail/usage/usage-column";
import type { ComponentPanelFacts } from "@/lib/component-panel";
import { kindLabel, NO_PACKAGE_TITLE } from "@/lib/component-facets";
import { changeText } from "@/lib/scan-diff-view";
import { type SourceRef, sourceFileUrl } from "@/lib/source-link";
import { componentHref, packageArea, serializeSel } from "@/lib/usage-url";
import { cn } from "@/lib/utils";

/** The panel's read for the selected component: still loading, done, or failed. */
export type PanelFactsState = { state: "loading" } | { state: "ready"; facts: ComponentPanelFacts } | { state: "error" };

/**
 * Where the panel sits: beside the table, in a drawer over it, or in a bottom sheet on tablets and phones, which has
 * no previous and next buttons. The drawer and the sheet cover the row's numbers, so they repeat them.
 */
export type PanelMode = "column" | "drawer" | "sheet";

const TOP = 3;
const LINK = "rounded-sm underline decoration-border underline-offset-3 hover:decoration-current";
const ROW = "grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_3.5rem] items-center gap-x-2.5 gap-y-1.5 text-sm";

/**
 * The selected component's details: name and status, where else it's used,
 * its replacement or retirement, the way to its usage and source, then its
 * most set props and the packages that use it most.
 */
export function ComponentDetailsPanel({
  repoId,
  row,
  linked,
  usedIn,
  mark,
  showChange,
  facts,
  otherRepos,
  source,
  mode,
  canEdit,
  onPrevious,
  onNext,
  onClose,
}: {
  repoId: string;
  row: ComponentRow;
  /** The component has a usage page: the latest scan holds it. */
  linked: boolean;
  /** The Used in package the table is scoped to, if any. */
  usedIn: string | null;
  mark: DiffMark | undefined;
  /** The scan has a previous scan to compare with, so the row's change is known. */
  showChange: boolean;
  facts: PanelFactsState;
  /** Other repos whose latest scan holds the component; null until it's known. */
  otherRepos: number | null;
  source: SourceRef | null;
  mode: PanelMode;
  canEdit: boolean;
  /** Undefined at the first row. */
  onPrevious?: (() => void) | undefined;
  /** Undefined at the last row. */
  onNext?: (() => void) | undefined;
  onClose: () => void;
}) {
  const usage = componentHref(repoId, row.componentId, packageArea(row.usedIn, usedIn));
  const ready = facts.state === "ready" ? facts.facts : null;
  const sourceHref = ready?.source && source ? sourceFileUrl(source.remote, source.commit, ready.source.filePath, ready.source.line ?? undefined) : null;
  const factItems = [
    ...(mode !== "column"
      ? [
          <span key="uses"><span className="font-medium tabular-nums text-foreground">{row.occurrenceCount.toLocaleString()}</span> {row.occurrenceCount === 1 ? "use" : "uses"}</span>,
          <span key="files"><span className="font-medium tabular-nums text-foreground">{row.fileCount.toLocaleString()}</span> {row.fileCount === 1 ? "file" : "files"}</span>,
          ...(showChange ? [<span key="change" className="text-foreground">{changeText(mark, row.occurrenceCount)}</span>] : []),
        ]
      : []),
    ...(otherRepos !== null && otherRepos > 0
      ? [
          <span key="repos">
            Used in{" "}
            <Link href={`/components/${encodeURIComponent(row.componentId)}`} className={LINK} title={`Opens ${row.displayName} across all repos`}>
              {plural(otherRepos, "other repo")}
            </Link>
          </span>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 font-mono text-xl font-medium leading-tight wrap-anywhere">
            {linked ? (
              <Link href={usage} className="rounded-sm underline-offset-4 hover:underline" title={`Opens ${row.displayName}'s usage page`}>
                {row.displayName}
              </Link>
            ) : (
              row.displayName
            )}
          </h2>
          <div className="-mt-0.5 flex shrink-0 items-center gap-1">
            {mode !== "sheet" ? (
              <ButtonGroup>
                <Button variant="outline" size="icon-sm" aria-label="Previous component" disabled={!onPrevious} onClick={onPrevious}>
                  <ChevronUp aria-hidden />
                </Button>
                <Button variant="outline" size="icon-sm" aria-label="Next component" disabled={!onNext} onClick={onNext}>
                  <ChevronDown aria-hidden />
                </Button>
              </ButtonGroup>
            ) : null}
            <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}>
              <X aria-hidden />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          <span className="min-w-0 font-mono wrap-anywhere" title={row.packageName ? undefined : NO_PACKAGE_TITLE}>{row.packageName ?? "—"}</span>
          {row.disambiguator ? <span className="min-w-0 font-mono wrap-anywhere">{row.disambiguator}</span> : null}
          <span>{kindLabel(friendlyKind(row.kind))}</span>
          {row.deprecated ? (
            <Badge variant="warning">
              <AlertTriangle aria-hidden />
              <span className="self-baseline leading-3.5">Deprecated</span>
            </Badge>
          ) : null}
        </div>
      </div>

      {factItems.length > 0 ? <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">{factItems}</p> : null}

      {row.migration ? <MigrationLine status={row.migration.status} recordId={canEdit ? row.migration.recordId : null} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {linked ? (
          <Link href={usage} className={cn(buttonVariants({ size: "sm" }))}>
            Open usage
            <ArrowRight aria-hidden />
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">Not in the latest scan, so it has no usage page.</p>
        )}
        {sourceHref && ready?.source ? (
          <a
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            title={ready.source.line === null ? ready.source.filePath : `${ready.source.filePath}:${ready.source.line}`}
            aria-label={`View ${row.displayName} source`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Code aria-hidden />
            View source
          </a>
        ) : null}
      </div>

      <TopProps repoId={repoId} row={row} linked={linked} usage={usage} facts={facts} />
      <TopPackages repoId={repoId} row={row} linked={linked} />
    </div>
  );
}

function ListHead({ id, title, more }: { id: string; title: string; more?: string | undefined }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2 text-label text-muted-foreground">
      <h3 id={id}>
        {title}
        {more ? <span className="font-normal"> · {more}</span> : null}
      </h3>
      <span aria-hidden>uses</span>
    </div>
  );
}

/** The three most set props with their most used values, each value linking to usage filtered to it. */
function TopProps({ repoId, row, linked, usage, facts }: { repoId: string; row: ComponentRow; linked: boolean; usage: string; facts: PanelFactsState }) {
  if (facts.state === "error") return <p className="text-xs text-muted-foreground">Couldn't load some details.</p>;
  if (facts.state === "loading") {
    return (
      <div aria-hidden>
        <div className="mb-2 h-[0.825rem] w-20 rounded bg-muted" />
        <ul className="space-y-3">
          {["first", "second", "third"].map((key) => (
            <li key={key} className={ROW}>
              <span className="h-5 rounded bg-muted" />
              <span className="h-1.5 rounded-full bg-muted" />
              <span />
              <span className="col-span-full h-4.5 w-2/3 rounded-md bg-muted" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const { props } = facts.facts;
  if (!props.kept) return null;
  if (props.uses === 0 || (props.top.length === 0 && !props.neverSet)) return null;
  return (
    <section aria-labelledby="details-props">
      {props.top.length > 0 ? (
        <>
          <ListHead id="details-props" title="Top props" />
          <ul className="space-y-3">
            {props.top.map((p) => (
              <li key={p.name} className={ROW} aria-label={`${p.name}, set on ${p.set.toLocaleString()} of ${plural(props.uses, "use")}`}>
                <span className="truncate font-mono" title={p.name}>{p.name}</span>
                <Track share={p.set / props.uses} />
                <span className="text-right tabular-nums text-muted-foreground">{p.set.toLocaleString()}</span>
                <span className="col-span-full flex flex-wrap gap-1.5">
                  {p.values.slice(0, TOP).map((v) => (
                    <ValueChip
                      key={`${v.kind}:${v.label}`}
                      prop={p}
                      value={v}
                      href={linked ? componentHref(repoId, row.componentId, [["sel", serializeSel([{ prop: p.name, kind: v.kind, label: v.label }])]]) : null}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {props.neverSet ? (
        <p className={cn("text-xs text-muted-foreground", props.top.length > 0 && "mt-3")}>
          {linked ? (
            <Link href={usage} className={LINK} title="Opens usage, which lists the declared props no use sets under Not set">
              {plural(props.neverSet, "prop")} never set
            </Link>
          ) : (
            `${plural(props.neverSet, "prop")} never set`
          )}
        </p>
      ) : null}
    </section>
  );
}

/** One of a prop's values with its uses: `{…}` muted for variables and expressions. */
function ValueChip({ prop, value, href }: { prop: TopProp; value: TopPropValue; href: string | null }) {
  const label = `${prop.name} ${valueSpeech(value)}, ${plural(value.count, "use")}`;
  const className = "inline-flex min-w-0 max-w-full items-baseline rounded-md border bg-secondary px-1.5 font-mono text-xs";
  const body = (
    <>
      <span className={cn("min-w-0 truncate", value.kind === "dynamic" && "italic text-muted-foreground")}>{valueLabel(value)}</span>
      <span className="ml-1 shrink-0 tabular-nums text-muted-foreground">{value.count.toLocaleString()}</span>
    </>
  );
  return href ? (
    <Link href={href} aria-label={label} title={`Opens usage filtered to ${prop.name} ${valueSpeech(value)}`} className={cn(className, "hover:border-muted-foreground/70")}>
      {body}
    </Link>
  ) : (
    <span aria-label={label} title={valueLabel(value)} className={className}>{body}</span>
  );
}

/** The packages in the scan with the most uses of the component, each linking to usage filtered to it. */
function TopPackages({ repoId, row, linked }: { repoId: string; row: ComponentRow; linked: boolean }) {
  const packages = Object.entries(row.usedIn ?? {}).sort(([a, x], [b, y]) => y.occurrenceCount - x.occurrenceCount || a.localeCompare(b));
  if (packages.length === 0) return null;
  const total = packages.reduce((n, [, counts]) => n + counts.occurrenceCount, 0);
  return (
    <section aria-labelledby="details-packages">
      <ListHead id="details-packages" title="Top packages" more={packages.length > TOP ? `${TOP} of ${packages.length.toLocaleString()}` : undefined} />
      <ul className="space-y-2">
        {packages.slice(0, TOP).map(([name, counts]) => (
          <li key={name} className={ROW}>
            {linked ? (
              <Link href={componentHref(repoId, row.componentId, packageArea(row.usedIn, name))} className="truncate font-mono underline-offset-3 hover:underline" title={`Opens usage filtered to ${name}`}>
                {name}
              </Link>
            ) : (
              <span className="truncate font-mono" title={name}>{name}</span>
            )}
            <Track share={total > 0 ? counts.occurrenceCount / total : 0} />
            <span className="text-right tabular-nums text-muted-foreground">{counts.occurrenceCount.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
