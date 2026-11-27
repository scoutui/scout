"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, Code, X } from "lucide-react";
import type { ComponentRow, DeclaredVerdictLists, DiffMark, GovernanceTracking, TopProp, TopPropValue } from "@scoutui/web-shared";
import { friendlyKind, plural, topValueLabel, valueSpeech } from "@scoutui/web-shared/client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { MigrationLine } from "@/components/governance/migration-line";
import { Track } from "@/components/component-detail/usage/usage-column";
import { PackageName } from "@/components/package-name";
import { ComponentStory } from "@/components/repos/component-story";
import type { ComponentPanelFacts } from "@/lib/component-panel";
import { kindLabel, NO_PACKAGE_TITLE } from "@/lib/component-facets";
import { changeText } from "@/lib/scan-diff-view";
import { type SourceRef, sourceFileUrl } from "@/lib/source-link";
import { componentHref, packageArea, serializeSel } from "@/lib/usage-url";
import { cn } from "@/lib/utils";

/** A finished read of a component's facts: the facts, or that the read failed. */
export type PanelFactsResult = { state: "ready"; facts: ComponentPanelFacts } | { state: "error" };

/**
 * The panel's read for the selected component: its result, or while it loads, the last result the panel showed, which
 * is another component's, with that component's id, and `slow` once the read has taken long enough to show a skeleton
 * when there's none.
 */
export type PanelFactsState = PanelFactsResult | { state: "loading"; previous: PanelFactsResult | null; previousId: string | null; slow: boolean };

/**
 * Where the panel sits: beside the table, or in a bottom sheet on tablets and phones, which has no previous and next
 * buttons. The sheet covers the row's numbers, so it repeats them.
 */
export type PanelMode = "column" | "sheet";

const TOP = 3;
/** Declared props named in a verdict row before "Show N more"; a list one longer shows in full rather than hide a single name. */
const UNUSED_SHOWN = 6;
/** A prop value or a declared prop's name: the one chip shape the panel uses. */
const CHIP = "inline-flex min-h-6 min-w-0 max-w-full items-center rounded-md border bg-secondary px-1.5 font-mono text-xs";
const LINK = "rounded-sm underline decoration-border underline-offset-3 hover:decoration-current";
const ROW = "grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-x-2.5 gap-y-1.5 text-sm";
/** A Top props row: the name and its bar, with the values on the line below. */
const PROP_ROW = "grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-2.5 gap-y-1.5 text-sm";
/** The name row sticks to the top of its scroll container and covers the container's padding there. */
const STICKY: Record<PanelMode, string> = { column: "-top-5 -mx-5 -mt-5 px-5 pt-5", sheet: "-top-3 -mx-4 -mt-3 px-4 pt-3" };

/**
 * The selected component's details: name and status, where else it's used,
 * its replacement or retirement, the way to its usage and source, its story
 * over time, then its most set props and the packages that use it most.
 */
export function ComponentDetailsPanel({
  repoId,
  row,
  linked,
  usedIn,
  mark,
  showChange,
  facts,
  previousUsesStory,
  entry,
  olderScanAt,
  otherRepos,
  source,
  mode,
  replacementHref,
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
  /** Says the row's change since the previous scan, from `mark`. */
  showChange: boolean;
  facts: PanelFactsState;
  /** While the facts load, the last facts shown drew a uses story. */
  previousUsesStory: boolean;
  /** The stored tracking entry that charts the row's governing record in this repo, if any. */
  entry: GovernanceTracking | null;
  /** Where the shown scan sits in the repo's history when it isn't the latest; null on the latest. */
  olderScanAt: string | null;
  /** Other repos whose latest scan holds the component; null until it's known. */
  otherRepos: number | null;
  source: SourceRef | null;
  mode: PanelMode;
  /** The replacement's page, when this repo's latest scan holds the replacement. */
  replacementHref?: string | undefined;
  /** Undefined at the first row. */
  onPrevious?: (() => void) | undefined;
  /** Undefined at the last row. */
  onNext?: (() => void) | undefined;
  onClose: () => void;
}) {
  const usage = componentHref(repoId, row.componentId, packageArea(row.usedIn, usedIn));
  const ready = facts.state === "ready" ? facts.facts : null;
  const sourceHref = ready?.source && source ? sourceFileUrl(source.remote, source.commit, ready.source.filePath, ready.source.line ?? undefined) : null;
  // A uses story, or its place while the facts load, says the row's change after its summary, so the facts don't.
  const usesStory = entry === null && facts.state !== "error";
  const change = showChange && !usesStory ? changeText(mark, row.occurrenceCount) : null;
  const factItems = [
    ...(mode !== "column"
      ? [
          <span key="uses"><span className="font-medium tabular-nums text-foreground">{row.occurrenceCount.toLocaleString()}</span> {row.occurrenceCount === 1 ? "use" : "uses"}</span>,
          <span key="files"><span className="font-medium tabular-nums text-foreground">{row.fileCount.toLocaleString()}</span> {row.fileCount === 1 ? "file" : "files"}</span>,
        ]
      : []),
    ...(change ? [<span key="change" className="text-foreground">{change}</span>] : []),
    ...(otherRepos !== null && otherRepos > 0
      ? [
          <span key="repos">
            Used in{" "}
            <Link href={`/components/${encodeURIComponent(row.componentId)}`} className={LINK} title={`Opens ${row.displayName} across all repos`}>
              {plural(otherRepos, "other repo")}
            </Link>
          </span>,
        ]
      : mode === "column" && otherRepos === null
        ? [<span key="repos" aria-hidden className="h-5" />]
        : []),
  ];

  return (
    <div>
      <div className={cn("sticky z-10 flex items-start gap-2 bg-card pb-1.5", STICKY[mode])}>
        <h2 aria-label={row.displayName} className="min-w-0 flex-1 font-mono text-xl font-medium leading-tight text-balance wrap-anywhere">
          <WordBreaks text={row.displayName} />
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

      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <span className="min-w-0 font-mono" title={row.packageName ? undefined : NO_PACKAGE_TITLE}>
              {row.packageName ? <SlashSegments text={row.packageName} /> : "—"}
            </span>
            {row.disambiguator ? <span className="min-w-0 font-mono"><SlashSegments text={row.disambiguator} /></span> : null}
            <span>{kindLabel(friendlyKind(row.kind))}</span>
            {row.deprecated ? (
              <Badge variant="warning">
                <AlertTriangle aria-hidden />
                <span className="self-baseline leading-3.5">Deprecated</span>
              </Badge>
            ) : null}
          </div>

          {factItems.length > 0 ? (
            <p className={cn("flex gap-x-4 gap-y-1 text-sm text-muted-foreground", mode === "column" ? "flex-col" : "flex-wrap")}>{factItems}</p>
          ) : null}

          {row.migration ? <MigrationLine status={row.migration.status} replacementHref={replacementHref} /> : null}

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
        </div>

        <ComponentStory repoId={repoId} row={row} mark={mark} showChange={showChange} entry={entry} facts={facts} previousUsesStory={previousUsesStory} olderScanAt={olderScanAt} usedIn={usedIn} />

        <TopProps repoId={repoId} row={row} linked={linked} facts={facts} />
        <TopPackages repoId={repoId} row={row} linked={linked} />
      </div>
    </div>
  );
}

/** A component name that may break before each capital that starts a word: `DataTableRow` before Table and Row, `HTMLInput` before Input. */
function WordBreaks({ text }: { text: string }) {
  return text.split(/(?<!^|[A-Z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map((word, i, all) => (
    <Fragment key={all.slice(0, i + 1).join("")}>
      {i > 0 ? <wbr /> : null}
      {word}
    </Fragment>
  ));
}

/** A package or path that breaks only after a `/`, or inside a part too long for the line on its own. */
function SlashSegments({ text }: { text: string }) {
  return text.split(/(?<=\/)/).map((segment, i, all) => (
    <Fragment key={all.slice(0, i + 1).join("")}>
      {i > 0 ? <wbr /> : null}
      <span className="inline-block max-w-full wrap-anywhere">{segment}</span>
    </Fragment>
  ));
}

function ListHead({ id, title, more, uses = true }: { id: string; title: string; more?: string | undefined; uses?: boolean }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2 text-label text-muted-foreground">
      <h3 id={id}>
        {title}
        {more ? <span className="font-normal"> · {more}</span> : null}
      </h3>
      {uses ? <span aria-hidden>uses</span> : null}
    </div>
  );
}

/**
 * The three most set props with their most used values, each value but a default linking to usage filtered to it, then
 * the declared props no use passes, by verdict. While they load, the last ones shown, faded and unlinked, or with none,
 * a skeleton once the read is slow, its space held until then.
 */
function TopProps({ repoId, row, linked, facts }: { repoId: string; row: ComponentRow; linked: boolean; facts: PanelFactsState }) {
  if (facts.state === "error") return <p className="text-xs text-muted-foreground">Couldn't load some details.</p>;
  if (facts.state === "loading" && facts.previous) {
    return (
      <div aria-busy="true" className="opacity-60">
        <div className="space-y-6">
          <TopProps repoId={repoId} row={row} linked={false} facts={facts.previous} />
        </div>
      </div>
    );
  }
  if (facts.state === "loading") {
    return (
      <div aria-hidden className={cn(!facts.slow && "invisible")}>
        <div className="mb-2 h-[0.825rem] w-20 rounded bg-muted" />
        <ul className="space-y-3">
          {["first", "second", "third"].map((key) => (
            <li key={key} className={ROW}>
              <span className="h-5 rounded bg-muted" />
              <span className="h-1.5 rounded-full bg-muted" />
              <span />
              <span className="col-span-full h-6 w-2/3 rounded-md bg-muted" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const { props } = facts.facts;
  if (!props.kept) return <p className="text-xs text-muted-foreground">Top props are kept for the latest scan only.</p>;
  const declared = props.declared;
  const showDeclared = declared !== null && (props.uses === 0 || declared.unused.length + declared.possiblyUnused.length > 0);
  if (props.top.length === 0 && !showDeclared) return null;
  return (
    <>
      {props.top.length > 0 ? (
        <section aria-labelledby="details-props">
          <ListHead id="details-props" title="Top props" uses={false} />
          <ul className="space-y-3">
            {props.top.map((p) => (
              <li key={p.name} className={PROP_ROW} aria-label={`${p.name}, set on ${p.set.toLocaleString()} of ${plural(props.uses, "use")}`}>
                <span className="truncate font-mono" title={p.name}>{p.name}</span>
                <Track share={p.set / props.uses} />
                <span className="col-span-full flex flex-wrap gap-1.5">
                  {p.values.slice(0, TOP).map((v) => (
                    <ValueChip
                      key={`${v.kind}:${v.label}`}
                      prop={p}
                      value={v}
                      href={linked && v.kind !== "default" && !v.isDefault ? componentHref(repoId, row.componentId, [["sel", serializeSel([{ prop: p.name, kind: v.kind, label: v.label }])]]) : null}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {showDeclared ? <DeclaredProps key={row.componentId} declared={declared} uses={props.uses} /> : null}
    </>
  );
}

/** The declared props no use passes, a row for each verdict that has any, or "No uses" for a component with none. */
function DeclaredProps({ declared, uses }: { declared: DeclaredVerdictLists; uses: number }) {
  return (
    <section aria-labelledby="details-declared">
      <ListHead id="details-declared" title="Declared props" more={declared.declaredCount.toLocaleString()} uses={false} />
      {uses === 0 ? (
        <p className="text-xs text-muted-foreground">No uses</p>
      ) : (
        <dl className="space-y-3 text-sm">
          <VerdictRow id="details-unused" term="Unused" names={declared.unused} />
          <VerdictRow id="details-possibly-unused" term="Possibly unused" names={declared.possiblyUnused} />
        </dl>
      )}
    </section>
  );
}

/** One verdict's props by name: the first few, then a button that shows the rest. Nothing when it has none. */
function VerdictRow({ id, term, names }: { id: string; term: string; names: string[] }) {
  const [open, setOpen] = useState(false);
  if (names.length === 0) return null;
  const capped = names.length > UNUSED_SHOWN + 1;
  const shown = capped && !open ? names.slice(0, UNUSED_SHOWN) : names;
  return (
    <div className="space-y-1.5">
      <dt id={id}>{term}</dt>
      <dd>
        <ul aria-labelledby={id} className="flex flex-wrap gap-1.5">
          {shown.map((name) => (
            <li key={name} className="min-w-0 max-w-full">
              <span className={CHIP} title={name}><span className="truncate">{name}</span></span>
            </li>
          ))}
          {capped ? (
            <li className="flex items-center">
              <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn(LINK, "text-xs text-muted-foreground hover:text-foreground")}>
                {open ? "Show fewer" : `Show ${(names.length - UNUSED_SHOWN).toLocaleString()} more`}
              </button>
            </li>
          ) : null}
        </ul>
      </dd>
    </div>
  );
}

/** How a top value is read aloud: a non-literal default by the variable it names, `expression` for `{…}`. */
function topValueSpeech(value: TopPropValue): string {
  if (value.kind === "default") return value.label || "expression";
  return valueSpeech({ kind: value.kind, label: value.label });
}

/** One of a prop's values with its uses: `{…}` muted for variables and expressions, and a default, named or literal, marked "default". */
function ValueChip({ prop, value, href }: { prop: TopProp; value: TopPropValue; href: string | null }) {
  const isDefault = value.kind === "default" || value.isDefault === true;
  const speech = topValueSpeech(value);
  const label = `${prop.name} ${speech}${isDefault ? ", the default" : ""}, ${plural(value.count, "use")}`;
  const body = (
    <>
      <span className={cn("min-w-0 truncate", value.kind === "dynamic" && "italic text-muted-foreground")}>{topValueLabel(value)}</span>
      {isDefault ? <span className="ms-1 shrink-0 font-sans text-muted-foreground">default</span> : null}
      <span className="ms-1 shrink-0 tabular-nums text-muted-foreground">{value.count.toLocaleString()}</span>
    </>
  );
  return href ? (
    <Link href={href} aria-label={label} title={`Opens usage filtered to ${prop.name} ${speech}`} className={cn(CHIP, "hover:border-muted-foreground/70")}>
      {body}
    </Link>
  ) : (
    <span aria-label={label} title={topValueLabel(value)} className={CHIP}>{body}</span>
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
              <Link href={componentHref(repoId, row.componentId, packageArea(row.usedIn, name))} className="min-w-0 underline-offset-3 hover:underline" aria-label={name} title={`Opens usage filtered to ${name}`}>
                <PackageName name={name} />
              </Link>
            ) : (
              <span className="min-w-0" title={name}><PackageName name={name} /></span>
            )}
            <Track share={total > 0 ? counts.occurrenceCount / total : 0} />
            <span className="text-end tabular-nums text-muted-foreground">{counts.occurrenceCount.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
