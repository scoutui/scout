"use client";
import { ChevronRight, ListFilter, X } from "lucide-react";
import { type ReactElement, type ReactNode, type RefObject, useRef } from "react";
import {
  oneFolderText,
  plural,
  propSections,
  type UsageDue,
  type UsagePick,
  type UsagePropRow,
  type UsagePropSections,
  type UsageValue,
  type UsageView,
  valueLabel,
  valueSpeech,
  whereHeading,
} from "@scoutui/web-shared/client";
import { useKept } from "@/lib/usage-url";
import { cn } from "@/lib/utils";
import { useElementWidth } from "./usage-layout-hooks";
import { SWAP, SWAP_OFF, SWAP_ON } from "./usage-toolbar";

type Section = UsagePropSections["groups"][number]["group"];
type Declared = NonNullable<UsagePropRow["declared"]>;

const SECTION_LABEL: Record<Section, string> = { styling: "Styling", event: "Events", attribute: "Attributes" };

/** A folder, package or value row: label, bar, count and filter cue. */
const ROW_GRID = "grid-cols-[minmax(0,1fr)_3.5rem_2.5rem_0.75rem]";
// The 1px border, for the selected state, comes out of the padding, so a value row's label, bar and count line up with a
// prop line's, which has no border.
const ROW =
  "group/row focus-inset grid w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-[calc(0.375rem-1px)] py-[calc(0.25rem-1px)] text-left text-xs transition-[background-color,border-color] duration-150 ease-out hover:bg-muted active:bg-accent motion-reduce:transition-none";
/** A prop line: chevron, name, bar, count and an end column that lines up with the values' filter cue. */
const PROP_ROW = "grid w-full grid-cols-[0.875rem_minmax(0,1fr)_3.5rem_2.5rem_0.75rem] items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs";
const PROP_ROW_BUTTON =
  "focus-inset cursor-pointer transition-colors duration-150 ease-out hover:bg-muted active:bg-accent motion-reduce:transition-none";
/** A section heading: the chevron in a prop line's chevron column, then the heading as a label. */
const SECTION_ROW = "text-label focus-inset grid min-h-6 w-full grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-1 text-left text-muted-foreground hover:text-foreground";
const CHEVRON = "size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none";
/** One level of nesting: a chevron and the space after it, so a level starts where its parent's name does. */
const NEST = "ps-[1.375rem]";
/** Keeps a focused field or prop line clear of the pinned top nav when focus scrolls it into view. */
const BELOW_PIN = { scrollMarginTop: "calc(var(--pin-top, 3.5rem) + 0.5rem)" };
// 16px below sm, so a phone doesn't zoom in when it's focused.
const FIND_INPUT =
  "h-7 w-full rounded-md border border-control bg-background px-2 font-mono text-base sm:text-xs placeholder:font-sans placeholder:text-muted-foreground";

/** The `data-filter` of a folder or package row. */
export const areaFilterKey = (area: string) => `area:${area}`;
/** The `data-filter` of a prop line. */
export const propFilterKey = (prop: string) => `prop:${prop}`;
/** The `data-filter` of one of a prop's value rows. */
export const valueFilterKey = (pick: UsagePick) => `prop:${pick.prop}:${pick.kind}:${pick.label}`;

/** The calls by package or folder and each prop's values, each row a filter. Below lg it folds away above the files. */
export function UsageColumn({
  view,
  prefix,
  onePackage,
  chPx,
  onArea,
  onPick,
  due,
  open,
  onOpenChange,
  columnRef,
  spacerRef,
}: {
  view: UsageView;
  /** The folders every call shares, or "" when they share none. */
  prefix: string;
  /** The package every call is in, when that's one package. */
  onePackage: string | null;
  /** The width of one character of the column's monospace text, or 0 before it's measured. */
  chPx: number;
  onArea: (area: string | null) => void;
  /** A value row of `prop` was pressed. */
  onPick: (prop: string, value: UsageValue) => void;
  /** What a deprecated component's calls still need, or null. */
  due: UsageDue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnRef: RefObject<HTMLElement | null>;
  spacerRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    // From lg this fills its grid area, and the spacer sets where in that area the sticky column sits.
    <div className="min-w-0">
      <div ref={spacerRef} aria-hidden className="max-lg:hidden" />
      <aside ref={columnRef} aria-labelledby="usage-column-title" className="max-lg:@container max-lg:border-b lg:sticky" style={{ scrollMarginTop: "var(--pin-top, 3.5rem)" }}>
        <h2 id="usage-column-title" className="sr-only">
          Where it’s used and prop values
        </h2>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls="usage-column-body"
          className="focus-inset flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-xs text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted/50 hover:text-foreground motion-reduce:transition-none lg:hidden"
        >
          <ChevronRight aria-hidden className={cn(CHEVRON, open && "rotate-90")} />
          Where it’s used and prop values
        </button>
        {/* Folded above the files: from sm at most 24rem wide, and two columns once the panel has room for two columns of
            at least 20rem, the column's width from lg. Where it's used is on the left, the props on the right. */}
        <div
          id="usage-column-body"
          className={cn(
            "space-y-5 px-3 pb-4 pt-1 sm:@max-[43.5rem]:max-w-sm lg:pt-3",
            open
              ? "@min-[43.5rem]:grid @min-[43.5rem]:grid-cols-[repeat(2,minmax(0,22rem))] @min-[43.5rem]:items-start @min-[43.5rem]:gap-x-8 @min-[43.5rem]:space-y-0"
              : "max-lg:hidden",
          )}
        >
          {/* While no calls match and no folder or package is filtered, there are no folders or packages to count. */}
          {view.areas.length > 0 ? (
            <section aria-labelledby="usage-where">
              <div className="mb-1 flex items-baseline gap-2 px-1.5">
                <h3 id="usage-where" className="text-label shrink-0 text-muted-foreground">
                  {whereHeading(due, view.byPackage || onePackage !== null)}
                </h3>
                {onePackage ? (
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={onePackage}>
                    {onePackage}
                  </span>
                ) : prefix ? (
                  <span className="min-w-0 truncate text-xs text-muted-foreground" title={`${prefix}/`}>
                    under <span className="font-mono">{prefix}/</span>
                  </span>
                ) : null}
              </div>
              <FolderRows view={view} chPx={chPx} onArea={onArea} />
            </section>
          ) : null}
          <div className="space-y-5 @min-[43.5rem]:col-start-2">
            <PropValues view={view} onPick={onPick} />
          </div>
        </div>
      </aside>
    </div>
  );
}

/** A bar of a share of the calls. It shows at its length at once; only its dimming fades. */
function Track({ share, dim = false, muted = false }: { share: number; dim?: boolean; muted?: boolean }) {
  const scale = share > 0 ? Math.min(1, Math.max(0.03, share)) : 0;
  return (
    <span aria-hidden className="relative h-1.5 overflow-hidden rounded-full bg-border/70">
      <span
        className={cn(
          "absolute inset-0 origin-left rounded-full transition-opacity duration-150 ease-out motion-reduce:transition-none",
          muted ? "bg-faint" : "bg-viz-primary",
          dim && "opacity-60",
        )}
        style={{ transform: `scaleX(${scale})` }}
      />
    </span>
  );
}

function FilterRow({
  filterKey,
  label,
  count,
  share,
  selected,
  dim,
  muted = false,
  ariaLabel,
  title,
  onClick,
}: {
  filterKey: string;
  label: ReactNode;
  count: number;
  share: number;
  selected: boolean;
  dim: boolean;
  muted?: boolean;
  ariaLabel: string;
  title?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-filter={filterKey}
      aria-pressed={selected}
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      className={cn(ROW, ROW_GRID, selected && "selected")}
      style={BELOW_PIN}
    >
      {/* Top-aligned, a monospace label keeps the row as tall as a prop line. */}
      <span className="min-w-0 truncate [&>*]:align-top">{label}</span>
      <Track share={share} dim={dim} muted={muted} />
      <span className="text-right tabular-nums">{count.toLocaleString()}</span>
      <FilterCue selected={selected} />
    </button>
  );
}

function FilterCue({ selected }: { selected: boolean }) {
  return (
    <span aria-hidden className="grid justify-items-end text-muted-foreground">
      <span className={cn(SWAP, "duration-150", selected ? SWAP_OFF : "opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100")}>
        <ListFilter className="size-3" />
      </span>
      <span className={cn(SWAP, selected ? SWAP_ON : SWAP_OFF)}>
        <X className="size-3" />
      </span>
    </span>
  );
}

/**
 * A package's name, its scope faint. On a row too narrow for the whole name the scope reads `@…`, and a name still too
 * long is cut at the end.
 */
function PackageName({ name, chPx }: { name: string; chPx: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const width = useElementWidth(ref);
  const slash = name.startsWith("@") ? name.indexOf("/") : -1;
  if (slash < 0) return <span className="font-mono">{name}</span>;
  const whole = chPx === 0 || width === 0 || name.length * chPx <= width;
  return (
    <span ref={ref} className="flex min-w-0 font-mono">
      <span className="shrink-0 text-faint">{whole ? name.slice(0, slash) : "@…"}</span>
      <span className="min-w-0 truncate">{name.slice(slash)}</span>
    </span>
  );
}

function FolderRows({ view, chPx, onArea }: { view: UsageView; chPx: number; onArea: (area: string | null) => void }) {
  const sentence = oneFolderText(view);
  if (sentence) {
    return (
      // Takes focus in place of a folder or package row that unpicking replaced with this sentence.
      <p tabIndex={-1} data-filter={areaFilterKey("")} className="px-1.5 text-xs text-muted-foreground">
        {sentence.lead} <span className="font-mono text-foreground">{sentence.label}</span>.
      </p>
    );
  }
  const inView = Math.max(1, view.areas.reduce((n, area) => n + area.count, 0));
  const filtered = view.areas.some((area) => area.picked);
  return (
    <ul className="space-y-px">
      {view.areas.map((area) => (
        <li key={area.key}>
          <FilterRow
            filterKey={areaFilterKey(area.key)}
            label={view.byPackage ? <PackageName name={area.label} chPx={chPx} /> : <span className="font-mono">{area.label}</span>}
            count={area.count}
            share={area.count / inView}
            selected={area.picked}
            dim={filtered && !area.picked}
            ariaLabel={`${view.byPackage ? "Package" : "Folder"} ${area.label}, ${plural(area.count, "use")}`}
            title={view.byPackage ? area.label : area.key === area.label || area.key === "." ? undefined : area.key}
            onClick={() => onArea(area.picked ? null : area.key)}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Which props, sections and Not set are open. Each starts closed, or open while it or one of its props is filtered,
 * until it's opened or closed by hand or `keepOpen` holds it open.
 */
function useColumnOpen() {
  const [props, setProps] = useKept<ReadonlyMap<string, boolean>>("props", new Map());
  const [sections, setSections] = useKept<ReadonlyMap<string, boolean>>("sections", new Map());
  // The prop `keepOpen` last held: Not set stays open while it holds that prop, until Not set is toggled by hand.
  const [held, setHeld] = useKept<string | null>("held", null);
  const propOpen = (row: UsagePropRow) => props.get(row.name) ?? row.picked;
  const sectionOpen = (key: string, rows: readonly UsagePropRow[]) =>
    (key === "unset" && rows.some((r) => r.name === held)) || (sections.get(key) ?? rows.some((r) => r.picked));
  return {
    propOpen,
    toggleProp: (row: UsagePropRow) => setProps((prev) => new Map(prev).set(row.name, !propOpen(row))),
    sectionOpen,
    toggleSection: (key: string, rows: readonly UsagePropRow[]) => {
      const open = sectionOpen(key, rows);
      if (key === "unset") setHeld(null);
      setSections((prev) => new Map(prev).set(key, !open));
    },
    /** Holds a prop open, and the section or Not set it's in, whether or not it stays filtered. */
    keepOpen: (row: UsagePropRow) => {
      setProps((prev) => new Map(prev).set(row.name, true));
      setHeld(row.name);
      if (row.group !== "prop") setSections((prev) => new Map(prev).set(row.group, true));
    },
  };
}

function PropValues({ view, onPick }: { view: UsageView; onPick: (prop: string, value: UsageValue) => void }) {
  const [find, setFind] = useKept("find", "");
  const column = useColumnOpen();
  const sections = propSections(view, find);
  const shown = (key: string, rows: readonly UsagePropRow[]) => sections.finding || column.sectionOpen(key, rows);
  const nothing = sections.listed.length === 0 && sections.unset.length === 0 && sections.groups.length === 0;

  const pick = (row: UsagePropRow, value: UsageValue) => {
    column.keepOpen(row);
    onPick(row.name, value);
  };
  const renderProp = (row: UsagePropRow) => <PropLine key={row.name} row={row} open={column.propOpen(row)} onToggle={() => column.toggleProp(row)} onPick={(value) => pick(row, value)} />;

  return (
    <>
      <section aria-labelledby="usage-props">
        <div data-column-pinned className="-mt-2 bg-card pb-1.5 pt-2 lg:sticky lg:z-10" style={{ top: "var(--column-pin, var(--pin-top, 3.5rem))" }}>
          <h3 id="usage-props" className="text-label px-1.5 text-muted-foreground">
            Prop values
          </h3>
          {sections.findable ? (
            <div className="mt-2.5 px-1.5">
              <input
                id="usage-find-prop"
                autoComplete="off"
                spellCheck={false}
                value={find}
                onChange={(e) => setFind(e.target.value)}
                aria-label="Find a prop"
                aria-keyshortcuts="f"
                placeholder="Find a prop"
                className={FIND_INPUT}
                style={BELOW_PIN}
              />
            </div>
          ) : null}
        </div>
        <ul className="space-y-px">
          {sections.finding && nothing ? <li className="px-1.5 py-1 text-xs text-muted-foreground">No props match.</li> : null}
          {sections.listed.map(renderProp)}
        </ul>
        {sections.unset.length > 0 ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => column.toggleSection("unset", sections.unset)}
              aria-expanded={shown("unset", sections.unset)}
              className={cn(PROP_ROW, PROP_ROW_BUTTON, "text-muted-foreground hover:text-foreground")}
            >
              <ChevronRight aria-hidden className={cn(CHEVRON, shown("unset", sections.unset) && "rotate-90")} />
              <span className="col-span-4">Not set</span>
            </button>
            {shown("unset", sections.unset) ? <ul className={cn("space-y-px", NEST)}>{sections.unset.map(renderProp)}</ul> : null}
          </div>
        ) : null}
      </section>
      {sections.groups.length > 0 ? (
        <div className="space-y-1">
          {sections.groups.map(({ group, props }) => (
            <section key={group} aria-labelledby={`usage-group-${group}`}>
              <h3 id={`usage-group-${group}`}>
                <button
                  type="button"
                  onClick={() => column.toggleSection(group, props)}
                  aria-expanded={shown(group, props)}
                  aria-controls={`usage-group-${group}-props`}
                  className={cn(SECTION_ROW, PROP_ROW_BUTTON)}
                >
                  <ChevronRight aria-hidden className={cn(CHEVRON, shown(group, props) && "rotate-90")} />
                  {SECTION_LABEL[group]}
                </button>
              </h3>
              {shown(group, props) ? (
                <ul id={`usage-group-${group}-props`} className="space-y-px pb-2">
                  {props.map(renderProp)}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** What a prop's declaration states: its type, its default and whether it's required. */
export function declaredFacts(declared: Declared): ReactElement[] {
  const out: ReactElement[] = [];
  if (declared.type) {
    out.push(
      <span key="type">
        Type <span className="font-mono">{declared.type}</span>
      </span>,
    );
  }
  if (declared.default) {
    out.push(
      <span key="default">
        Default <span className="font-mono">{declared.default}</span>
      </span>,
    );
  }
  if (declared.required) out.push(<span key="required">Required</span>);
  return out;
}

/**
 * A prop the component declares that no call sets (`unused`) has no bar or count, and opens only to its declared
 * facts.
 */
function PropLine({ row, open, onToggle, onPick }: { row: UsagePropRow; open: boolean; onToggle: () => void; onPick: (value: UsageValue) => void }) {
  const never = row.status === "unused";
  const undeclared = row.status === "undeclared";
  const facts = row.declared ? declaredFacts(row.declared) : [];
  const expandable = !never || facts.length > 0;
  const head = (
    <>
      {expandable ? <ChevronRight aria-hidden className={cn(CHEVRON, "text-muted-foreground", open && "rotate-90")} /> : <span aria-hidden />}
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cn("truncate font-mono font-medium", never ? "text-muted-foreground" : "text-foreground")} title={row.name.length > 22 ? row.name : undefined}>
          {row.name}
        </span>
        {undeclared ? <span className="shrink-0 text-muted-foreground">Undeclared</span> : null}
      </span>
      {never ? <span aria-hidden /> : <Track share={row.set / Math.max(1, row.of)} />}
      <span className="text-right tabular-nums text-muted-foreground">{never ? "" : row.set.toLocaleString()}</span>
      <span aria-hidden />
    </>
  );
  const label = `${row.name}${undeclared ? ", Undeclared" : ""}${never ? "" : `, set on ${row.set.toLocaleString()} of ${plural(row.of, "use")}`}${row.picked ? ", filtered" : ""}`;
  const of = Math.max(1, row.of);

  return (
    <li>
      {expandable ? (
        <button type="button" data-filter={propFilterKey(row.name)} aria-expanded={open} aria-label={label} onClick={onToggle} className={cn(PROP_ROW, PROP_ROW_BUTTON)} style={BELOW_PIN}>
          {head}
        </button>
      ) : (
        <div className={PROP_ROW}>{head}</div>
      )}
      {open && expandable ? (
        <div className={cn("pb-1.5", NEST)}>
          {facts.length > 0 ? (
            <p className="flex flex-wrap gap-x-2 px-1.5 pb-1 pt-0.5 text-xs text-muted-foreground">
              {facts.map((fact, i) => (
                <span key={fact.key} className="min-w-0 break-all">
                  {i > 0 ? (
                    <>
                      {" "}
                      <span aria-hidden>·</span>{" "}
                    </>
                  ) : null}
                  {fact}
                </span>
              ))}
            </p>
          ) : null}
          {never ? null : (
            <ul className="space-y-px">
              {row.values.map((value) => (
                <li key={`${value.kind}:${value.label}`}>
                  <FilterRow
                    filterKey={valueFilterKey({ prop: row.name, kind: value.kind, label: value.label })}
                    label={<ValueText value={value} />}
                    count={value.count}
                    share={value.count / of}
                    selected={value.picked}
                    dim={row.picked && !value.picked}
                    muted={value.kind === "unset"}
                    ariaLabel={`${row.name} ${valueSpeech(value)}, ${plural(value.count, "use")}`}
                    title={value.kind === "dynamic" ? "Expression" : valueLabel(value).length > 18 ? valueLabel(value) : undefined}
                    onClick={() => onPick(value)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ValueText({ value }: { value: UsageValue }) {
  if (value.kind === "unset") return <span className="text-muted-foreground">Not set</span>;
  if (value.kind === "dynamic") {
    return (
      <span className="font-mono text-muted-foreground">
        <span aria-hidden>{"{…}"}</span>
        <span className="sr-only">expression</span>
      </span>
    );
  }
  return <span className="font-mono text-foreground">{valueLabel(value)}</span>;
}
