"use client";
import { ArrowUpRight, ChevronRight, ChevronsUpDown } from "lucide-react";
import { Fragment, useLayoutEffect, useRef } from "react";
import type { OccurrencePropChip } from "@scoutui/web-shared";
import { callJsx, cellTitle, plural, type UsageCallLine, type UsageCell, type UsageFile, type UsageLineCell, type UsageOwner, type UsageSection, type UsageSortKey, type UsageValueColumn, type UsageView } from "@scoutui/web-shared/client";
import { ariaSort, SortButton } from "@/components/ui/sortable";
import { TableHead } from "@/components/ui/table";
import { type SourceRef, sourceFileUrl } from "@/lib/source-link";
import { pushQuery, useHrefWith, useKeepPlace, useKept } from "@/lib/usage-url";
import { cn } from "@/lib/utils";
import { CopyListButton } from "./usage-toolbar";

/** The most of a prop's JSX a call line shows before cutting its value short. */
const PROP_MAX = 40;

const TH = "h-9 border-b bg-muted px-3 text-left align-middle font-medium text-muted-foreground";
const SORT_TH =
  "[&_button]:min-h-6 [&_button]:cursor-pointer [&_button]:rounded-sm [&_button]:outline-none [&_button]:transition-colors [&_button]:duration-150 [&_button]:ease-out [&_button]:motion-reduce:transition-none [&_button:hover]:text-foreground [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ring/50";
const HEAD_TOP = { top: "calc(var(--pin-top, 3.5rem) + var(--bar-h, 3rem))" };
const SECTION_TOP = { top: "calc(var(--pin-top, 3.5rem) + var(--bar-h, 3rem) + var(--head-h, 0px))" };

type HrefWith = ReturnType<typeof useHrefWith>;

/**
 * The files in view, one row each, grouped into the view's sections. A row opens to one line per call site. Rows start
 * open while few calls are in view; a row the reader opens or closes stays that way. From md each of `columns` shows a
 * prop's values; below md a line of JSX under each file name shows them. The File, value and Calls headings sort the
 * files by `view.sort` and report a click through `onSort`. Each folder's heading copies its files through
 * `onCopyFolder`; the one whose key is `copiedFolder` reads "Copied". The headings pin under the file toolbar, except
 * when the component has `few` calls.
 */
export function FileTable({
  view,
  few,
  source,
  columns,
  onSort,
  copiedFolder,
  onCopyFolder,
}: {
  view: UsageView;
  few: boolean;
  source: SourceRef | null;
  columns: readonly UsageValueColumn[];
  onSort: (key: UsageSortKey) => void;
  copiedFolder: string | null;
  onCopyFolder: (section: UsageSection) => void;
}) {
  const hrefWith = useHrefWith();
  const [allOpen, setAllOpen] = useKept<boolean | null>("allOpen", null);
  const [toggled, setToggled] = useKept<ReadonlyMap<string, boolean>>("toggled", new Map());
  const base = allOpen ?? view.rowsOpen;
  const toggle = (path: string) => setToggled((prev) => new Map(prev).set(path, !(prev.get(path) ?? base)));

  const tableRef = useRef<HTMLTableElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);
  // Section headings pin under the column headings, so the table measures them.
  useLayoutEffect(() => {
    const table = tableRef.current;
    const head = headRef.current;
    if (!table || !head) return;
    const update = () => table.style.setProperty("--head-h", `${head.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(head);
    return () => observer.disconnect();
  }, []);
  const cols = 3 + columns.length;
  const { key: sortKey, dir } = view.sort;
  const th = cn(TH, !few && "sticky z-10");
  const headTop = few ? undefined : HEAD_TOP;

  return (
    <table ref={tableRef} className="w-full table-fixed border-separate border-spacing-0 text-sm">
      <colgroup>
        <col className="w-9 md:w-10" />
        <col />
        {columns.map((c) => (
          <col key={c.prop} style={{ width: c.width }} />
        ))}
        <col className="w-12 md:w-20" />
      </colgroup>
      <thead ref={headRef} className="hidden md:table-header-group">
        <tr>
          <th scope="col" className={cn(th, "pl-4 pr-0")} style={headTop}>
            <button
              type="button"
              onClick={() => {
                setAllOpen(!base);
                setToggled(new Map());
              }}
              aria-label={base ? "Collapse all rows" : "Expand all rows"}
              title={base ? "Collapse all rows" : "Expand all rows"}
              className="flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors duration-150 ease-out hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              <ChevronsUpDown aria-hidden className="size-3.5" />
            </button>
          </th>
          <TableHead scope="col" aria-sort={ariaSort("file", sortKey, dir)} className={cn(th, SORT_TH)} style={headTop}>
            <SortButton label="File" sortKey="file" current={sortKey} dir={dir} onClick={onSort} />
          </TableHead>
          {columns.map((c) => {
            const key: UsageSortKey = `prop:${c.prop}`;
            return (
              <th key={c.prop} scope="col" aria-sort={ariaSort(key, sortKey, dir)} className={cn(th, "font-mono text-xs font-normal", SORT_TH)} style={headTop}>
                <SortButton label={c.prop} sortKey={key} current={sortKey} dir={dir} onClick={onSort} title={c.prop.length > 14 ? c.prop : undefined} />
              </th>
            );
          })}
          <TableHead scope="col" aria-sort={ariaSort("calls", sortKey, dir)} className={cn(th, "pl-3 pr-4 text-right", SORT_TH)} style={headTop}>
            <SortButton label="Calls" sortKey="calls" current={sortKey} dir={dir} onClick={onSort} align="right" />
          </TableHead>
        </tr>
      </thead>
      {view.sections.map((section, i) => (
        <tbody key={section.key ?? "all"}>
          <SectionHeading section={section} cols={cols} first={i === 0} pinned={!few} copied={section.key !== null && section.key === copiedFolder} onCopy={() => onCopyFolder(section)} />
          {section.files.map((file, j) => (
            <FileRow
              key={file.path}
              file={file}
              first={j === 0}
              open={toggled.get(file.path) ?? base}
              onToggle={() => toggle(file.path)}
              columns={columns}
              cols={cols}
              source={source}
              hrefWith={hrefWith}
            />
          ))}
        </tbody>
      ))}
    </table>
  );
}

/** The folders below which a section's files sit, in full, for the heading's title. */
function headingTitle(section: UsageSection): string | undefined {
  if (section.key === null || section.key === ".") return section.shared ?? undefined;
  return section.shared ? `${section.key}/${section.shared}` : section.key;
}

/**
 * A folder's label, the folders its files share and its own Copy, shown on hover or focus and always on touch; or for a
 * flat list only the folders every file shares.
 */
function SectionHeading({ section, cols, first, pinned, copied, onCopy }: { section: UsageSection; cols: number; first: boolean; pinned: boolean; copied: boolean; onCopy: () => void }) {
  if (section.label === null && section.shared === null) return null;
  return (
    <tr className="group/g">
      <th colSpan={cols} scope="rowgroup" className={cn("bg-card px-4 pb-1 pt-2 text-left font-normal", pinned && "sticky z-[5]", !first && "border-t")} style={pinned ? SECTION_TOP : undefined}>
        <div className="flex min-h-6 min-w-0 items-center gap-2">
          <span className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs" title={headingTitle(section)}>
            {section.label !== null ? <span className="shrink-0 font-medium">{section.label}</span> : null}
            {section.label !== null && section.shared !== null ? (
              <span aria-hidden className="shrink-0 text-muted-foreground">
                ·
              </span>
            ) : null}
            {section.shared !== null ? <span className="min-w-0 truncate text-muted-foreground">{section.shared}</span> : null}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {plural(section.calls, "call")} in {plural(section.files.length, "file")}
          </span>
          {section.label !== null ? (
            <span
              className={cn(
                "ml-auto opacity-0 transition-opacity duration-150 ease-out group-focus-within/g:opacity-100 group-hover/g:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100",
                copied && "opacity-100",
              )}
            >
              <CopyListButton files={section.files.length} folder={section.label} copied={copied} onCopy={onCopy} />
            </span>
          ) : null}
        </div>
      </th>
    </tr>
  );
}

function FileRow({
  file,
  first,
  open,
  onToggle,
  columns,
  cols,
  source,
  hrefWith,
}: {
  file: UsageFile;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  columns: readonly UsageValueColumn[];
  cols: number;
  source: SourceRef | null;
  hrefWith: HrefWith;
}) {
  const firstLine = file.lines[0];
  const href = firstLine && source ? sourceFileUrl(source.remote, source.commit, file.path, firstLine.line) : null;
  const owners = open ? file.owners : null;
  const td = cn("py-1.5 align-top", !first && "border-t");

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the chevron button is the keyboard path; the row click is a larger target for a pointer. */}
      <tr
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button")) return;
          if (window.getSelection()?.toString()) return;
          onToggle();
        }}
        className={cn("cursor-pointer transition-colors duration-150 ease-out hover:bg-muted/50 active:bg-muted motion-reduce:transition-none", open && "bg-muted/30")}
      >
        <td className={cn(td, "pl-3 pr-0 md:pl-4")}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`Calls in ${file.path}`}
            className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
          >
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-90")} />
          </button>
        </td>
        <td className={cn(td, "px-3 md:pr-0")}>
          {href && firstLine ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${file.path} at line ${firstLine.line}`}
              className="group/link relative inline-flex max-w-full shrink-0 items-center gap-1 rounded-sm font-mono text-sm leading-6 text-foreground decoration-muted-foreground/60 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <FileName file={file} />
              <ArrowUpRight
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 ease-out group-hover/link:opacity-100 group-focus-visible/link:opacity-100 motion-reduce:transition-none"
              />
            </a>
          ) : (
            <span className="flex max-w-full font-mono text-sm leading-6" title={file.path}>
              <FileName file={file} />
            </span>
          )}
          {file.jsx ? (
            <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground md:hidden" title={file.jsx}>
              {file.jsx}
            </span>
          ) : null}
        </td>
        {columns.map((c) => (
          <td key={c.prop} className={cn(td, "hidden px-3 md:table-cell")}>
            <ValueCell prop={c.prop} cell={file.cells[c.prop]} />
          </td>
        ))}
        <td className={cn(td, "pl-2 pr-3 text-right text-xs leading-6 tabular-nums md:pl-3 md:pr-4")}>
          <span className="sr-only">Calls: </span>
          {file.calls.toLocaleString()}
        </td>
      </tr>
      {open && owners ? (
        <tr className="bg-muted/30">
          <td />
          <td colSpan={cols - 1} className="px-3 pb-0.5 md:pr-4">
            <p className="break-words text-xs leading-5 text-muted-foreground">
              Rendered by <Owners owners={owners} hrefWith={hrefWith} />
            </p>
          </td>
        </tr>
      ) : null}
      {open
        ? file.lines.map((line, i) => (
            <CallRow
              key={line.key}
              path={file.path}
              line={line}
              last={i === file.lines.length - 1}
              owners={owners ? [] : line.owners}
              columns={columns}
              source={source}
              hrefWith={hrefWith}
            />
          ))
        : null}
    </>
  );
}

/** A file's name after its faint parent folders, which give way first when the name doesn't fit. */
function FileName({ file }: { file: UsageFile }) {
  return (
    <span className="flex min-w-0">
      {file.lead ? <span className="min-w-0 truncate text-faint">{file.lead}</span> : null}
      <span className="max-w-full shrink-0 truncate">{file.base}</span>
    </span>
  );
}

/** A prop as a call line shows it, with its value cut short to keep it within PROP_MAX characters. */
function shortJsx(chip: OccurrencePropChip): string {
  const text = callJsx(chip);
  if (text.length <= PROP_MAX) return text;
  const keep = Math.max(1, PROP_MAX - chip.name.length - 4);
  if (chip.kind === "literal") return `${chip.name}="${chip.value.slice(0, keep)}…"`;
  if (chip.kind === "reference") return `${chip.name}={${chip.ref.slice(0, keep)}…}`;
  return `${text.slice(0, PROP_MAX - 1)}…`;
}

/**
 * A file's most used value of a prop, with "+N" for its other values and calls without it, each in the title; a dash
 * when no call sets it. The top value is set heavier when the filters pick it.
 */
function ValueCell({ prop, cell }: { prop: string; cell: UsageCell | undefined }) {
  const head = cell?.values[0];
  if (!cell || !head) return <NotSet prop={prop} className="leading-6" />;
  const title = cellTitle(cell);
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-xs leading-6" title={title}>
      <span className="sr-only">{prop}: </span>
      <span className={cn("min-w-0 truncate font-mono", head.hint === "Expression" ? "text-muted-foreground" : "text-foreground", head.picked && "font-medium")}>{head.text}</span>
      {cell.more ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          <span className="sr-only">{title.replaceAll("\n", ", ")}</span>
          <span aria-hidden>+{cell.more}</span>
        </span>
      ) : null}
    </span>
  );
}

/** A faint dash for a prop that isn't set, read as "{prop}: not set". */
function NotSet({ prop, className }: { prop: string; className: string }) {
  return (
    <span className={cn("block text-xs text-faint", className)}>
      <span className="sr-only">{prop}: not set</span>
      <span aria-hidden>–</span>
    </span>
  );
}

/** A call's value under a value column, as written, set heavier when the filters pick it; a dash when the call doesn't set it. */
function CallValue({ prop, cell }: { prop: string; cell: UsageLineCell | null }) {
  if (!cell) return <NotSet prop={prop} className="py-0.5 leading-5" />;
  return (
    <span
      title={cell.expression ? "Expression" : cell.text}
      className={cn("block truncate py-0.5 font-mono text-xs leading-5", cell.expression ? "text-muted-foreground" : "text-foreground", cell.picked && "font-medium")}
    >
      <span className="sr-only">{prop}: </span>
      {cell.text}
    </span>
  );
}

/**
 * One call site of an opened file: its line, the props without a column, how it's imported or reached, and who renders
 * it. When the line has cells, each column's value sits under that column.
 */
function CallRow({
  path,
  line,
  last,
  owners,
  columns,
  source,
  hrefWith,
}: {
  path: string;
  line: UsageCallLine;
  last: boolean;
  owners: readonly UsageOwner[];
  columns: readonly UsageValueColumn[];
  source: SourceRef | null;
  hrefWith: HrefWith;
}) {
  const href = source ? sourceFileUrl(source.remote, source.commit, path, line.line) : null;
  const chips = line.props.filter((c) => !columns.some((col) => col.prop === c.name));
  // Calls sit further apart than the wrapped lines of one call.
  const td = cn("py-0.5 align-top", last && "pb-2");
  return (
    <tr className="bg-muted/30">
      <td className={td} />
      <td className={cn(td, "px-3 md:pr-0")}>
        <div className="flex min-w-0 items-baseline gap-x-3 font-mono text-xs leading-5">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${path} at line ${line.line}`}
              title={`Open ${path} at line ${line.line}`}
              className="w-[5ch] shrink-0 cursor-pointer rounded-sm py-0.5 tabular-nums text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors duration-150 ease-out hover:text-foreground hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              :{line.line}
            </a>
          ) : (
            <span className="w-[5ch] shrink-0 py-0.5 tabular-nums text-muted-foreground">:{line.line}</span>
          )}
          <span className="flex min-w-0 flex-wrap gap-x-3 py-0.5 text-muted-foreground">
            {line.props.length === 0 ? <span className="font-sans">No props</span> : null}
            {chips.map((chip, i) => {
              const text = callJsx(chip);
              return (
                <span key={`${i}:${chip.name}`} title={text.length > PROP_MAX ? text : undefined} className={cn("min-w-0 max-w-full truncate", chip.quiet && "text-faint")}>
                  {shortJsx(chip)}
                </span>
              );
            })}
            {line.writtenName ? (
              <span className="whitespace-nowrap font-sans">
                Imported as <span className="font-mono">{line.writtenName}</span>
              </span>
            ) : null}
            {line.via ? (
              <span className="whitespace-nowrap font-sans">
                via <span className="font-mono">{line.via}</span>
              </span>
            ) : null}
            {owners.length > 0 ? (
              <span className="min-w-0 break-words font-sans">
                Rendered by <Owners owners={owners} hrefWith={hrefWith} />
              </span>
            ) : null}
          </span>
        </div>
      </td>
      {columns.map((c) => {
        const cell = line.cells[c.prop];
        return (
          <td key={c.prop} className={cn(td, "hidden px-3 md:table-cell")}>
            {cell === undefined ? null : <CallValue prop={c.prop} cell={cell} />}
          </td>
        );
      })}
      <td className={td} />
    </tr>
  );
}

/**
 * Each owner as a link to Composition with that owner pinned, joined by commas. A plain click opens it without a page
 * load, after keeping the reader's place for Back.
 */
function Owners({ owners, hrefWith }: { owners: readonly UsageOwner[]; hrefWith: HrefWith }) {
  const keepPlace = useKeepPlace();
  return owners.map((owner, i) => {
    const params = { tab: "composition", pin: `up:${owner.componentId}` };
    const label = `Show ${owner.displayName} in Composition`;
    return (
      <Fragment key={owner.componentId}>
        {i > 0 ? ", " : null}
        <a
          href={hrefWith(params)}
          aria-label={label}
          title={label}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            keepPlace();
            pushQuery(params);
            window.scrollTo({ top: 0 });
          }}
          className="cursor-pointer rounded-sm font-mono text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors duration-150 ease-out hover:text-foreground hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          {owner.displayName}
        </a>
      </Fragment>
    );
  });
}
