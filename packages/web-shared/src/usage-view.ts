import { isKind } from "@scoutui/scan-format";
import type { ComponentDetail, DeclaredMeta, OccurrencePropChip, OccurrenceRow, PropUsage } from "./dto.js";

/** Which part of the Usage tab's column a prop is listed in. */
export type UsageGroup = "prop" | "styling" | "event" | "attribute";
export type UsagePickKind = "value" | "dynamic" | "unset";
/** One picked value of one prop: a written value (`label` is it), `{…}` or not set (`label` is ""). */
export type UsagePick = { prop: string; kind: UsagePickKind; label: string };
export type UsageSortKey = "uses" | "file" | `prop:${string}`;
export type UsageSort = { key: UsageSortKey; dir: "asc" | "desc" };
export const DEFAULT_USAGE_SORT: UsageSort = { key: "uses", dir: "desc" };
export type UsageFilters = { find: string; area: string | null; picks: readonly UsagePick[]; sort: UsageSort };
export type UsageInput = Pick<ComponentDetail, "occurrences" | "props" | "events" | "hasDeclaredApi">;
export type UsagePropInfo = { name: string; group: UsageGroup; status: PropUsage["status"]; declared: DeclaredMeta | null };

/** The value a call gives a name it sets: a written value, or `{…}` for a variable, an expression or a bound listener. */
type SetValue = { readonly kind: "value" | "dynamic"; readonly label: string };

/** One call with what the filters read from it. */
type IndexedCall = {
  readonly row: OccurrenceRow;
  /** The lower-cased text a search looks in. */
  readonly hay: string;
  /** The key of the package or folder the call's file is in: the package's name, or the folder's path. */
  readonly area: string;
  /** The value of every name the call sets. A name missing here is not set. */
  readonly values: ReadonlyMap<string, SetValue>;
  /** The call's props as its call line shows them. */
  readonly chips: UsageCallChip[];
};

/** Built once per component. Fields after `rows` are the implementation's own. */
export type UsageIndex = {
  readonly total: number;
  readonly few: boolean;
  /** Every call is in a package and they name more than one: the calls are listed by package, not by folder. */
  readonly byPackage: boolean;
  /** The package every call is in, when that's one package; null when they're in several or name none. */
  readonly onePackage: string | null;
  readonly prefix: string;
  readonly rows: readonly UsagePropInfo[];
  readonly calls: readonly IndexedCall[];
  /** Each prop that can be a value column, most set first, with its cell in every file of the component. */
  readonly columns: ReadonlyMap<string, readonly UsageCell[]>;
};
export type UsageValue = { kind: UsagePickKind; label: string; count: number; picked: boolean };
export type UsagePropRow = UsagePropInfo & { set: number; of: number; picked: boolean; values: UsageValue[] };
export type UsageArea = { key: string; label: string; count: number; picked: boolean };
export type UsageOwner = { componentId: string; displayName: string };
/** A prop on a call line. `quiet` marks an event or an attribute. */
export type UsageCallChip = OccurrencePropChip & { quiet: boolean };
/** One call site: the stored rows at one file, line and column. */
export type UsageCallLine = {
  /** `line:column`, unique within its file. */
  key: string;
  line: number;
  column: number;
  /** Every distinct owner once, in stored order; empty for a call outside any component. */
  owners: UsageOwner[];
  /** The first stored row's props: the props most set in the scan first, then spreads, then its styling, events and attributes. */
  props: UsageCallChip[];
  writtenName: string | null;
  /** The name the call reaches the component through, when it isn't rendered by name. */
  via: string | null;
  /** The stored rows at this place: 2 for a site two components render. */
  rows: number;
  /** The first stored row's value under each value column, null where it doesn't set the prop; none on a file's only line. */
  cells: Record<string, UsageLineCell | null>;
};
/** A call's value as written: `large`, `""`, `{tone}` for a variable, `{…}` for an expression. `picked` when the filters pick it. */
export type UsageLineCell = { text: string; expression: boolean; picked: boolean };
/** One of a file's values for a prop. `picked` when the filters pick it. */
export type UsageCellValue = { text: string; count: number; hint: "Empty string" | "Expression" | null; picked: boolean };
/**
 * A file's values for one value column, most used first. `more` is the "+N" beside the top value: the other values,
 * plus 1 when some of the file's calls leave the prop unset and the file has more than one call. `unset` counts the
 * calls without the prop.
 */
export type UsageCell = { values: UsageCellValue[]; more: number; unset: number };
export type UsageFile = {
  path: string;
  base: string;
  lead: string;
  calls: number;
  lines: UsageCallLine[];
  /** The owners every call line has, when they all have the same ones; null otherwise or when they have none. */
  owners: UsageOwner[] | null;
  cells: Record<string, UsageCell>;
  /** The most used value of each line prop, as JSX on one line: `size="large" isFullWidth`. A prop whose most used value is `{…}` is left off. */
  jsx: string;
};
/**
 * A package's or a folder's files, or with `key` and `label` null, every file in view. `shared` is the folders its files
 * share: below `key` for a folder, from the repo root for a package.
 */
export type UsageSection = { key: string | null; label: string | null; shared: string | null; calls: number; files: UsageFile[] };
export type UsageValueColumn = { prop: string; width: number };
export type UsageView = {
  total: number;
  shown: number;
  files: number;
  /** The search holds more than spaces. */
  searched: boolean;
  filtered: boolean;
  active: number;
  /** `areas` and `sections` are packages, not folders. */
  byPackage: boolean;
  areas: UsageArea[];
  props: UsagePropRow[];
  sections: UsageSection[];
  grouped: boolean;
  /** The sort applied: a value column's sort reads as calls, highest first, while the column isn't shown. */
  sort: UsageSort;
  /** The value columns, as passed. */
  columns: string[];
  /** File rows start open: 5 calls or fewer are in view. */
  rowsOpen: boolean;
};

/** At or below this many calls a component counts as having few calls, and while this many or fewer are in view, file rows start open. */
const FEW = 5;

const ATTRIBUTE = /^(data-|aria-)|^(key|ref)$/;
/** HTML attributes listed under Attributes for every component, unless it declares a prop of that name. */
const PASS_THROUGH = new Set(["id", "role", "tabIndex", "tabindex"]);
/** HTML attributes listed under Attributes only for a component with declared props that doesn't declare one of that name. */
const OTHER_HTML_ATTRIBUTE = new Set(["slot", "dir", "lang", "hidden", "title"]);
/**
 * Test ids: names that start with the word `qa` or `e2e` (`qa`, `qaSelector`, `qa-id`, `e2eId`), or end in the words
 * `test` and `id` (`testId`, `testID`, `test-id`, `dataTestId`). `latestId`, `quantity` and `TestId` don't match.
 */
const TEST_ID = /^(qa|e2e)(?![a-z])|(^|[-_])test[-_]?(id|Id|ID)$|[a-z]Test(Id|ID)$/;
const STYLING = new Set(["className", "class", "style", "sx", "css"]);

const MAX_COLUMNS = 3;
/** A value at least this share of a prop's set calls use is common, and its column is sized to show it in full. */
const VALUE_COMMON = 0.02;
/** The widest a value column gets, in pixels. */
const VALUE_COL_MAX = 180;
/** Only a list of more than this many files in view is grouped by folder. */
const GROUP_PAST = 24;
/** File names that say nothing on their own, so their folder stays attached. */
const GENERIC = /^(index|page|layout|route|styles?|types?|constants|utils|helpers|hooks|default|main|app)\.[\w.]+$/i;

const REPO_ROOT = "(repo root)";
const DYNAMIC: SetValue = { kind: "dynamic", label: "" };
const UNSET = { kind: "unset", label: "" } as const;

const isSpread = (name: string) => name.startsWith("...");

function groupOf(name: string, status: PropUsage["status"], events: ReadonlySet<string>, hasDeclaredApi: boolean): UsageGroup {
  const declared = status === "used" || status === "unused";
  const html = PASS_THROUGH.has(name) || (hasDeclaredApi && OTHER_HTML_ATTRIBUTE.has(name));
  if (ATTRIBUTE.test(name)) return "attribute";
  if (events.has(name)) return "event";
  if ((html && !declared) || TEST_ID.test(name)) return "attribute";
  if (STYLING.has(name)) return "styling";
  return "prop";
}

/**
 * The component's props and each Vue listener that isn't a prop, without spreads, most set in the scan first, then by
 * name. A prop's set calls are its written values, variables and expressions; a listener's are the calls that bind it.
 */
function propRows(input: UsageInput): UsagePropInfo[] {
  const events = new Set(input.events.map((e) => e.name));
  const sum = (counts: readonly { count: number }[]) => counts.reduce((n, c) => n + c.count, 0);
  const set = new Map(input.props.map((p) => [p.name, sum(p.written) + sum(p.references) + p.dynamicCount]));
  const rows: UsagePropInfo[] = input.props.map((p) => ({ name: p.name, group: groupOf(p.name, p.status, events, input.hasDeclaredApi), status: p.status, declared: p.declared }));
  for (const { name, boundCount } of input.events) {
    if (set.has(name)) continue;
    set.set(name, boundCount);
    rows.push({ name, group: groupOf(name, null, events, input.hasDeclaredApi), status: null, declared: null });
  }
  const setOf = (name: string) => set.get(name) ?? 0;
  return rows.filter((r) => !isSpread(r.name)).sort((a, b) => setOf(b.name) - setOf(a.name) || a.name.localeCompare(b.name));
}

/** The leading directories every path shares. */
function sharedDirs(paths: readonly string[]): string[] {
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  const first = dirs[0] ?? [];
  let shared = 0;
  while (shared < first.length && dirs.every((d) => d[shared] === first[shared])) shared++;
  return first.slice(0, shared);
}

/** A file's folder: the first directory below `prefix`, or `prefix` itself (`.` at the repo root) for a file directly in it. */
function areaOf(path: string, prefix: readonly string[]): string {
  const parts = path.split("/");
  if (parts.length - 1 <= prefix.length) return prefix.length ? prefix.join("/") : ".";
  return parts.slice(0, prefix.length + 1).join("/");
}

/** How a package or folder reads: a package's name, a folder's name, `src/` for the shared folder itself, or `(repo root)`. */
function areaLabel(key: string, prefix: string, byPackage: boolean): string {
  if (byPackage) return key;
  if (key === ".") return REPO_ROOT;
  const name = key.slice(key.lastIndexOf("/") + 1);
  return key === prefix ? `${name}/` : name;
}

/** A folder as Copy list and the filters text name it: its full key, or `(repo root)`. */
function areaName(key: string): string {
  return key === "." ? REPO_ROOT : key;
}

/** A prop as JSX: `size="large"`, `isFullWidth` for a written true, `variant={tone}`, `label={…}`, `{...rest}`. */
function jsxText(chip: OccurrencePropChip): string {
  if (isSpread(chip.name)) return `{${chip.name}}`;
  if (chip.kind === "literal") return chip.value === "true" ? chip.name : `${chip.name}="${chip.value}"`;
  if (chip.kind === "reference") return `${chip.name}={${chip.ref}}`;
  return `${chip.name}={…}`;
}

/** A prop as a call line shows it: `size="large"`, `isFullWidth`, `disabled={false}`, `variant={tone}`, `label={…}`, `{...rest}`. */
export function callJsx(chip: OccurrencePropChip): string {
  return chip.kind === "literal" && chip.value === "false" ? `${chip.name}={false}` : jsxText(chip);
}

/** How a value reads: `large`, quoted when empty or holding a space (`""`, `"me-2 ms-2"`), `{…}`, `not set`. */
export function valueLabel(value: Pick<UsageValue, "kind" | "label">): string {
  if (value.kind === "value") return value.label === "" || /\s/.test(value.label) ? `"${value.label}"` : value.label;
  return value.kind === "dynamic" ? "{…}" : "not set";
}

/** How a value is read aloud: as `valueLabel`, with `{…}` read as `expression`. */
export function valueSpeech(value: Pick<UsageValue, "kind" | "label">): string {
  return value.kind === "dynamic" ? "expression" : valueLabel(value);
}

/** The path, each prop as JSX, with its quotes dropped and as a call line shows it, and the name the file renders it as. */
function haystack(row: OccurrenceRow): string {
  const chips = row.props.flatMap((chip) => {
    const jsx = jsxText(chip);
    return [jsx, jsx.replaceAll('"', ""), callJsx(chip)];
  });
  return [row.filePath, ...chips, row.writtenName ?? ""].join(" ").toLowerCase();
}

/** The value of every name a call sets. A prop's first chip wins, and a listener counts only where no chip sets the name. */
function setValues(row: OccurrenceRow): Map<string, SetValue> {
  const values = new Map<string, SetValue>();
  for (const chip of row.props) {
    if (!values.has(chip.name)) values.set(chip.name, chip.kind === "literal" ? { kind: "value", label: chip.value } : DYNAMIC);
  }
  for (const name of row.events) if (!values.has(name)) values.set(name, DYNAMIC);
  return values;
}

/** What tells values apart: a written value by its text, `{…}` and not set by kind. */
const valueKey = (value: Pick<UsageValue, "kind" | "label">) => (value.kind === "value" ? `value:${value.label}` : value.kind);

type PicksByProp = ReadonlyMap<string, ReadonlyMap<string, UsagePick>>;

/** The picked values by prop, props in the order first picked, each value once. */
function picksByProp(picks: readonly UsagePick[]): Map<string, Map<string, UsagePick>> {
  const byProp = new Map<string, Map<string, UsagePick>>();
  for (const p of picks) {
    const byKey = byProp.get(p.prop) ?? new Map<string, UsagePick>();
    if (!byKey.has(valueKey(p))) byKey.set(valueKey(p), p);
    byProp.set(p.prop, byKey);
  }
  return byProp;
}

/** The picked values of each prop, props in the order first picked, each value once. */
export function pickGroups(picks: readonly UsagePick[]): { prop: string; picks: UsagePick[] }[] {
  return [...picksByProp(picks)].map(([prop, byKey]) => ({ prop, picks: [...byKey.values()] }));
}

/** Calls by file, files in the order first seen, each file's calls in location order. */
function filesOf(calls: readonly IndexedCall[]): Map<string, IndexedCall[]> {
  const byPath = new Map<string, IndexedCall[]>();
  for (const c of calls) {
    const list = byPath.get(c.row.filePath);
    if (list) list.push(c);
    else byPath.set(c.row.filePath, [c]);
  }
  for (const list of byPath.values()) list.sort((a, b) => a.row.line - b.row.line || a.row.column - b.row.column);
  return byPath;
}

/** A file's values for one prop, most used first, ties in location order. `picked` holds the prop's picked values. */
function cellOf(calls: readonly IndexedCall[], prop: string, picked?: ReadonlyMap<string, UsagePick>): UsageCell {
  const byText = new Map<string, UsageCellValue>();
  let unset = 0;
  for (const c of calls) {
    const value = c.values.get(prop);
    if (!value) {
      unset++;
      continue;
    }
    const text = valueLabel(value);
    const found = byText.get(text);
    if (found) found.count++;
    else byText.set(text, { text, count: 1, hint: value.kind === "dynamic" ? "Expression" : value.label === "" ? "Empty string" : null, picked: picked?.has(valueKey(value)) ?? false });
  }
  const values = [...byText.values()].sort((a, b) => b.count - a.count);
  const more = values.length ? values.length - 1 + (unset > 0 && calls.length > 1 ? 1 : 0) : 0;
  return { values, more, unset };
}

/**
 * The props that can be value columns: listed under the component's props, set on at least a fifth of all calls with
 * at least one written value, most set first, at most three. None for a component with few calls.
 */
function columnProps(rows: readonly UsagePropInfo[], calls: readonly IndexedCall[], few: boolean): string[] {
  if (few) return [];
  const set = new Map<string, number>();
  const written = new Set<string>();
  for (const c of calls) {
    for (const [name, value] of c.values) {
      set.set(name, (set.get(name) ?? 0) + 1);
      if (value.kind === "value") written.add(name);
    }
  }
  const count = (name: string) => set.get(name) ?? 0;
  return rows
    .filter((r) => r.group === "prop" && written.has(r.name) && count(r.name) >= calls.length / 5)
    .sort((a, b) => count(b.name) - count(a.name))
    .slice(0, MAX_COLUMNS)
    .map((r) => r.name);
}

type ChipRank = { rank: number; quiet: boolean };

/**
 * Each name's place on a call line, and whether it reads quiet: the props in the order `rows` lists them, then any name
 * it doesn't list (a spread), then the styling, events and attributes in that order. Events and attributes are quiet.
 */
function chipRanks(rows: readonly UsagePropInfo[]): (name: string) => ChipRank {
  const ranks = new Map(rows.map((r, i): [string, ChipRank] => [r.name, { rank: r.group === "prop" ? i : rows.length + 1 + i, quiet: r.group === "event" || r.group === "attribute" }]));
  const unlisted: ChipRank = { rank: rows.length, quiet: false };
  return (name) => ranks.get(name) ?? unlisted;
}

/** A call's props as its call line shows them, in their place; props in the same place keep their stored order. */
function callChips(row: OccurrenceRow, rankOf: (name: string) => ChipRank): UsageCallChip[] {
  return row.props.map((chip) => ({ ...chip, quiet: rankOf(chip.name).quiet })).sort((a, b) => rankOf(a.name).rank - rankOf(b.name).rank);
}

export function usageIndex(input: UsageInput): UsageIndex {
  const prefix = sharedDirs(input.occurrences.map((o) => o.filePath));
  const packages = new Set(input.occurrences.map((o) => o.usedIn));
  const byPackage = !packages.has(undefined) && packages.size > 1;
  const rows = propRows(input);
  const few = input.occurrences.length <= FEW;
  const rankOf = chipRanks(rows);
  const calls = input.occurrences.map((row) => ({ row, hay: haystack(row), area: byPackage ? (row.usedIn as string) : areaOf(row.filePath, prefix), values: setValues(row), chips: callChips(row, rankOf) }));
  const files = [...filesOf(calls).values()];
  return {
    total: input.occurrences.length,
    few,
    byPackage,
    onePackage: packages.size === 1 ? ([...packages][0] ?? null) : null,
    prefix: byPackage ? "" : prefix.join("/"),
    rows,
    calls,
    columns: new Map(columnProps(rows, calls, few).map((prop) => [prop, files.map((list) => cellOf(list, prop))])),
  };
}

/**
 * A value column's width: its header with the sort glyph, or its widest cell, with any "+N", that leads with a common
 * value, whichever is wider, plus the cell padding, up to VALUE_COL_MAX. `chPx` is the width of one character.
 */
function columnWidth(prop: string, cells: readonly UsageCell[], chPx: number): number {
  const uses = new Map<string, number>();
  let set = 0;
  for (const { values } of cells) {
    for (const v of values) {
      uses.set(v.text, (uses.get(v.text) ?? 0) + v.count);
      set += v.count;
    }
  }
  let widest = prop.length * chPx + 16;
  for (const { values, more } of cells) {
    const head = values[0];
    if (!head || (uses.get(head.text) ?? 0) < set * VALUE_COMMON) continue;
    widest = Math.max(widest, head.text.length * chPx + (more ? 6 + (String(more).length + 1) * chPx : 0));
  }
  return Math.min(VALUE_COL_MAX, Math.ceil(widest + 24));
}

/**
 * The value columns to show: the props that can be columns, minus any filtered to one value, added in order while each
 * fits in `roomPx`, stopping at the first that doesn't. Widths come from every file, so filters don't change them.
 */
export function valueColumns(index: UsageIndex, picks: readonly UsagePick[], roomPx: number, chPx: number): UsageValueColumn[] {
  const out: UsageValueColumn[] = [];
  if (roomPx <= 0 || chPx <= 0) return out;
  const picked = picksByProp(picks);
  let room = roomPx;
  for (const [prop, cells] of index.columns) {
    if (picked.get(prop)?.size === 1) continue;
    const width = columnWidth(prop, cells, chPx);
    if (width > room) break;
    out.push({ prop, width });
    room -= width;
  }
  return out;
}

/**
 * The name a call reaches the component through when it isn't rendered by name: the function it's passed to, the
 * wrapper, loader or helper, the map it's picked from, or the prop it's rendered as.
 */
function viaOf(row: OccurrenceRow): string | null {
  if (isKind(row.credit, "argument") && row.credit.callee) return row.credit.callee;
  for (const step of row.trace) {
    const name =
      isKind(step, "hoc") || isKind(step, "lazy") || isKind(step, "helper-call")
        ? step.callee
        : isKind(step, "dynamic-map")
          ? step.mapName
          : isKind(step, "prop-forward")
            ? step.bindingName
            : null;
    if (name) return name;
  }
  return null;
}

/** A prop's value as written: `large`, quoted when empty or holding a space, `{tone}` for a variable, `{…}` for an expression. */
function writtenText(chip: OccurrencePropChip): string {
  if (chip.kind === "literal") return valueLabel({ kind: "value", label: chip.value });
  return chip.kind === "reference" ? `{${chip.ref}}` : "{…}";
}

/** A call's value under one value column, from the prop's first chip; null where the call doesn't set the prop. */
function lineCell({ chips, values }: IndexedCall, prop: string, picked: ReadonlyMap<string, UsagePick> | undefined): UsageLineCell | null {
  const chip = chips.find((c) => c.name === prop);
  const value = values.get(prop);
  if (!chip || !value) return null;
  return { text: writtenText(chip), expression: chip.kind === "dynamic", picked: picked?.has(valueKey(value)) ?? false };
}

/**
 * A file's calls as call lines: the rows at one line and column merged, in location order. Lines get cells only in a
 * file with more than one line.
 */
function callLines(calls: readonly IndexedCall[], columns: readonly string[], picks: PicksByProp): UsageCallLine[] {
  const lines = new Map<string, { line: UsageCallLine; first: IndexedCall }>();
  for (const c of calls) {
    const { row, chips } = c;
    const key = `${row.line}:${row.column}`;
    const owner = row.owner ? { componentId: row.owner.componentId, displayName: row.owner.displayName } : null;
    const found = lines.get(key);
    if (!found) {
      const line: UsageCallLine = { key, line: row.line, column: row.column, owners: owner ? [owner] : [], props: chips, writtenName: row.writtenName ?? null, via: viaOf(row), rows: 1, cells: {} };
      lines.set(key, { line, first: c });
      continue;
    }
    found.line.rows++;
    if (owner && !found.line.owners.some((o) => o.componentId === owner.componentId)) found.line.owners.push(owner);
  }
  const merged = [...lines.values()];
  if (merged.length > 1) {
    for (const { line, first } of merged) line.cells = Object.fromEntries(columns.map((prop) => [prop, lineCell(first, prop, picks.get(prop))]));
  }
  return merged.map(({ line }) => line);
}

const splitPath = (path: string) => {
  const dirs = path.split("/");
  const base = dirs.pop() ?? path;
  return { base, dirs };
};
const leadOf = (dirs: readonly string[], depth: number) => (depth > 0 && dirs.length > 0 ? `${dirs.slice(-depth).join("/")}/` : "");

/**
 * How many parent folders each file name shows: none, except a generic name or one another of these paths shares,
 * which takes one, then one more at a time while the names are still shared and the paths have folders left.
 */
function leadDepths(paths: readonly string[]): Map<string, number> {
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const { base } = splitPath(p);
    const same = byBase.get(base);
    if (same) same.push(p);
    else byBase.set(base, [p]);
  }
  const depths = new Map<string, number>();
  for (const [base, same] of byBase) {
    const dirs = same.map((p) => splitPath(p).dirs);
    const deepest = Math.max(...dirs.map((d) => d.length));
    let depth = GENERIC.test(base) || same.length > 1 ? 1 : 0;
    while (same.length > 1 && depth < deepest && new Set(dirs.map((d) => leadOf(d, depth))).size < same.length) depth++;
    for (const p of same) depths.set(p, depth);
  }
  return depths;
}

/** A prop's value as the JSX line shows it: `size="large"`, `isFullWidth`, `disabled={false}`; null for `{…}`. */
function jsxPart(prop: string, value: UsageCellValue | undefined): string | null {
  if (!value || value.hint === "Expression") return null;
  if (value.text === "true") return prop;
  if (value.text === "false") return `${prop}={false}`;
  return `${prop}=${value.text.startsWith('"') ? value.text : `"${value.text}"`}`;
}

/** The owners every line has, when they all have the same ones; otherwise, or when they have none, null. */
function sharedOwners(lines: readonly UsageCallLine[]): UsageOwner[] | null {
  const owners = lines[0]?.owners ?? [];
  if (owners.length === 0) return null;
  const ids = new Set(owners.map((o) => o.componentId));
  return lines.every((l) => l.owners.length === ids.size && l.owners.every((o) => ids.has(o.componentId))) ? owners : null;
}

function fileOf(path: string, calls: readonly IndexedCall[], depth: number, columns: readonly string[], lineProps: readonly string[], picks: PicksByProp): UsageFile {
  const { base, dirs } = splitPath(path);
  const lines = callLines(calls, columns, picks);
  return {
    path,
    base,
    lead: leadOf(dirs, depth),
    calls: calls.length,
    lines,
    owners: sharedOwners(lines),
    cells: Object.fromEntries(columns.map((prop) => [prop, cellOf(calls, prop, picks.get(prop))])),
    jsx: lineProps
      .flatMap((prop) => jsxPart(prop, cellOf(calls, prop).values[0]) ?? [])
      .join(" "),
  };
}

/**
 * Files by calls, highest first, then path; under any other sort, reordered from there by a stable sort: calls lowest
 * first, the name as shown, or a value column's top value, with files that don't set it last in both directions.
 */
function sortFiles(files: readonly UsageFile[], sort: UsageSort): UsageFile[] {
  const sorted = [...files].sort((a, b) => b.calls - a.calls || a.path.localeCompare(b.path));
  const sign = sort.dir === "asc" ? 1 : -1;
  if (sort.key === "uses") return sort.dir === "desc" ? sorted : sorted.sort((a, b) => (a.calls - b.calls) * sign);
  const prop = sort.key.startsWith("prop:") ? sort.key.slice(5) : null;
  const text = (f: UsageFile) => (prop === null ? `${f.lead}${f.base}`.toLowerCase() : (f.cells[prop]?.values[0]?.text ?? null));
  return sorted.sort((a, b) => {
    const x = text(a);
    const y = text(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return x.localeCompare(y) * sign;
  });
}

/** The sort after a click on the header of `key`: the sorted column flips; another starts calls highest first, or A to Z. */
export function nextUsageSort(sort: UsageSort, key: UsageSortKey): UsageSort {
  if (key === sort.key) return { key, dir: sort.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "uses" ? "desc" : "asc" };
}

/**
 * The folders every one of these paths sits under, ending in `/`: below `key` when it's a folder, from the repo root
 * when it's a package or not given; null when none.
 */
function sharedBelow(paths: readonly string[], key: string | null, byPackage: boolean): string | null {
  const dirs = sharedDirs(paths);
  const rest = key === null || key === "." || byPackage ? dirs : dirs.slice(key.split("/").length);
  return rest.length ? `${rest.join("/")}/` : null;
}

const callsIn = (files: readonly UsageFile[]) => files.reduce((n, f) => n + f.calls, 0);

/** Grouped, a section per package or folder by calls, highest first, then label; otherwise one section of every file. */
function sectionsOf(files: readonly UsageFile[], folderOf: ReadonlyMap<string, string>, grouped: boolean, prefix: string, byPackage: boolean): UsageSection[] {
  if (!grouped) return [{ key: null, label: null, shared: sharedBelow(files.map((f) => f.path), null, byPackage), calls: callsIn(files), files: [...files] }];
  const byFolder = new Map<string, UsageFile[]>();
  for (const f of files) {
    const key = folderOf.get(f.path) ?? ".";
    const list = byFolder.get(key);
    if (list) list.push(f);
    else byFolder.set(key, [f]);
  }
  return [...byFolder]
    .map(([key, list]) => ({ key, label: areaLabel(key, prefix, byPackage), shared: sharedBelow(list.map((f) => f.path), key, byPackage), calls: callsIn(list), files: list }))
    .sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label));
}

/** One prop's counts over its list: the shown calls, plus `extra` calls that fail only this prop's filter. */
type Tally = { extra: number; set: number; dynamic: number; written: Map<string, number> };

function count(tally: Tally, value: SetValue | undefined): void {
  if (!value) return;
  tally.set++;
  if (value.kind === "dynamic") tally.dynamic++;
  else tally.written.set(value.label, (tally.written.get(value.label) ?? 0) + 1);
}

/**
 * A prop's values over its list: written values by count, then `{…}`, then each picked value its list leaves at 0, then
 * not set.
 */
function valuesOf(tally: Tally, unset: number, picks: ReadonlyMap<string, UsagePick>): UsageValue[] {
  const value = (kind: UsagePickKind, label: string, n: number): UsageValue => ({ kind, label, count: n, picked: picks.has(valueKey({ kind, label })) });
  const values = [...tally.written]
    .map(([label, n]) => value("value", label, n))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (tally.dynamic > 0) values.push(value("dynamic", "", tally.dynamic));
  for (const [key, p] of picks) {
    if (p.kind !== "unset" && !values.some((v) => valueKey(v) === key)) values.push(value(p.kind, p.kind === "value" ? p.label : "", 0));
  }
  if (unset > 0 || picks.has(valueKey(UNSET))) values.push(value("unset", "", unset));
  return values;
}

/**
 * Every count the Usage tab shows under some filters, and the files shown. A call passes a prop's filter when it has
 * any value picked for that prop. The calls shown match the search, every prop's filter and the folder; each prop's
 * list skips that prop's own filter; the folder counts skip the folder. `columns` are the value columns shown, which
 * get a cell in every file and call line. `lineProps` are the props each file's JSX line shows.
 */
export function usageView(index: UsageIndex, filters: UsageFilters, columns: readonly string[] = [], lineProps: readonly string[] = []): UsageView {
  const needle = filters.find.trim().toLowerCase();
  const area = filters.area || null;
  const picks = picksByProp(filters.picks);
  const entries = index.rows.map((info): { info: UsagePropInfo; tally: Tally } => ({ info, tally: { extra: 0, set: 0, dynamic: 0, written: new Map() } }));
  const tallies = new Map(entries.map((e) => [e.info.name, e.tally]));
  const areaCounts = new Map<string, number>();
  const inView: IndexedCall[] = [];
  const folderOf = new Map<string, string>();
  let shown = 0;

  for (const c of index.calls) {
    if (needle && !c.hay.includes(needle)) continue;
    let failed: string | null = null;
    let failures = 0;
    for (const [prop, byKey] of picks) {
      if (byKey.has(valueKey(c.values.get(prop) ?? UNSET))) continue;
      failed = prop;
      failures++;
      if (failures > 1) break;
    }
    if (failures > 1) continue;
    const inArea = !area || c.area === area;
    if (failed === null) {
      areaCounts.set(c.area, (areaCounts.get(c.area) ?? 0) + 1);
      if (!inArea) continue;
      shown++;
      inView.push(c);
      folderOf.set(c.row.filePath, c.area);
      for (const [name, value] of c.values) {
        const tally = tallies.get(name);
        if (tally) count(tally, value);
      }
    } else if (inArea) {
      const tally = tallies.get(failed);
      if (tally) {
        tally.extra++;
        count(tally, c.values.get(failed));
      }
    }
  }

  const props = entries
    .map(({ info, tally }): UsagePropRow => {
      const of = shown + tally.extra;
      const own = picks.get(info.name) ?? new Map<string, UsagePick>();
      return { ...info, set: tally.set, of, picked: own.size > 0, values: valuesOf(tally, of - tally.set, own) };
    })
    .sort((a, b) => b.set - a.set || a.name.localeCompare(b.name));
  const areas = [...areaCounts]
    .map(([key, n]): UsageArea => ({ key, label: areaLabel(key, index.prefix, index.byPackage), count: n, picked: key === area }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (area && !areaCounts.has(area)) areas.unshift({ key: area, label: areaLabel(area, index.prefix, index.byPackage), count: 0, picked: true });

  const byPath = filesOf(inView);
  const stale = filters.sort.key.startsWith("prop:") && !columns.includes(filters.sort.key.slice(5));
  const sort = stale ? DEFAULT_USAGE_SORT : filters.sort;
  const depths = leadDepths([...byPath.keys()]);
  const files = sortFiles([...byPath].map(([path, calls]) => fileOf(path, calls, depths.get(path) ?? 0, columns, lineProps, picks)), sort);
  const grouped = !index.few && !area && new Set(folderOf.values()).size > 1 && files.length > GROUP_PAST && sort.key === "uses";

  return {
    total: index.total,
    shown,
    files: files.length,
    searched: Boolean(needle),
    filtered: Boolean(needle) || filters.picks.length > 0 || area !== null,
    active: picks.size + (area ? 1 : 0),
    byPackage: index.byPackage,
    areas,
    props,
    sections: sectionsOf(files, folderOf, grouped, index.prefix, index.byPackage),
    grouped,
    sort,
    columns: [...columns],
    rowsOpen: shown <= FEW,
  };
}

/** Past this many props, the column offers Find a prop. */
const FIND_PAST = 10;
const SECTIONS = ["styling", "event", "attribute"] as const;

/** Where the column lists each prop, in the view's order. */
export type UsagePropSections = {
  /** The column offers Find a prop. */
  findable: boolean;
  /** Find a prop holds more than spaces. */
  finding: boolean;
  /** Under Prop values: each filtered prop, and each prop set on at least one of the calls it counts. */
  listed: UsagePropRow[];
  /** Under Not set: each prop set on none of the calls it counts, unless it's filtered. */
  unset: UsagePropRow[];
  /**
   * Styling, Events and Attributes, each with its props whether set or not; while no call is in view, only its
   * filtered props. One with no props is left out.
   */
  groups: { group: (typeof SECTIONS)[number]; props: UsagePropRow[] }[];
};

/**
 * The column's props whose name holds `find`, ignoring case.
 * While no call is in view, Not set is empty and each section keeps only its filtered props.
 */
export function propSections(view: UsageView, find: string): UsagePropSections {
  const needle = find.trim().toLowerCase();
  const rows = needle ? view.props.filter((r) => r.name.toLowerCase().includes(needle)) : view.props;
  const props = rows.filter((r) => r.group === "prop");
  const none = view.shown === 0;
  return {
    findable: view.props.length > FIND_PAST,
    finding: Boolean(needle),
    listed: props.filter((r) => r.set > 0 || r.picked),
    unset: none ? [] : props.filter((r) => r.set === 0 && !r.picked),
    groups: SECTIONS.map((group) => ({ group, props: rows.filter((r) => r.group === group && (r.picked || !none)) })).filter((s) => s.props.length > 0),
  };
}

/** What the column says in place of the package or folder rows while every call it counts is in one that isn't filtered. */
export function oneFolderText(view: UsageView): { lead: string; label: string } | null {
  const only = view.areas.length === 1 ? view.areas[0] : undefined;
  if (!only || only.picked) return null;
  const lead = only.count === 1 ? "The only use is in" : only.count === 2 ? "Both uses are in" : `All ${only.count.toLocaleString()} uses are in`;
  return { lead, label: only.label };
}

/** The picks with `pick` removed when it's picked, otherwise added after the others. */
export function togglePick(picks: readonly UsagePick[], pick: UsagePick): UsagePick[] {
  const key = valueKey(pick);
  const kept = picks.filter((p) => p.prop !== pick.prop || valueKey(p) !== key);
  return kept.length < picks.length ? kept : [...picks, pick];
}

/** A list read as one choice: `ghost`, `ghost or outline`, `ghost, outline or link`. */
function orList(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/**
 * The active filters in words: `size = large or small; folder src/a; search “x”`, naming a package as
 * `package @example/web` when `byPackage`. `say` reads each value.
 */
export function filterText(picks: readonly UsagePick[], area: string | null, find: string, say: (value: UsagePick) => string = valueLabel, byPackage = false): string {
  const parts = pickGroups(picks).map(({ prop, picks: values }) =>
    values.length === 1 && values[0]?.kind === "unset" ? `${prop} not set` : `${prop} = ${orList(values.map(say))}`,
  );
  if (area) parts.push(`${byPackage ? "package" : "folder"} ${areaName(area)}`);
  const needle = find.trim().toLowerCase();
  if (needle) parts.push(`search “${needle}”`);
  return parts.join("; ");
}

export type CopyListInput = {
  /** The toolbar copies every section in view; a folder's button passes that one section. */
  sections: readonly UsageSection[];
  displayName: string;
  repoId: string;
  deprecated: boolean;
  migrationStatus: ComponentDetail["migrationStatus"];
  /** `folderKey` and the section keys are packages, not folders. */
  byPackage: boolean;
  /** Set on a package's or a folder's own button. */
  folderKey: string | null;
  /** `filterText(...)`, or "" without filters. */
  filters: string;
  /** The page's URL. */
  href: string;
  /** The source link for a line, or null without a source. */
  urlFor: (path: string, line: number) => string | null;
};

/** A count and its word: `1 call`, `2 calls`, `1,250 files`. */
export const plural = (n: number, word: string) => `${n.toLocaleString()} ${n === 1 ? word : `${word}s`}`;

/** What a deprecated component's calls still need. */
export type UsageDue = "to migrate" | "to remove";

/** The calls of a retired component are to remove, of any other deprecated one to migrate; null when it isn't deprecated. */
export function usageDue(deprecated: boolean, status: ComponentDetail["migrationStatus"]): UsageDue | null {
  if (!deprecated) return null;
  return status.status === "retired" ? "to remove" : "to migrate";
}

/**
 * The toolbar's count: the uses, as `n of N uses` under filters, and in the long form the files they're in. With
 * `due`, the short form reads `N to migrate` or `n of N to migrate` and the long form `… uses still to migrate`, or
 * the same with `to remove`.
 */
export function countText(view: UsageView, due: UsageDue | null): { short: string; long: string } {
  const calls = view.filtered ? `${view.shown.toLocaleString()} of ${plural(view.total, "use")}` : plural(view.total, "use");
  const short = due ? `${view.filtered ? `${view.shown.toLocaleString()} of ${view.total.toLocaleString()}` : view.total.toLocaleString()} ${due}` : calls;
  return { short, long: `${calls}${due ? ` still ${due}` : ""} · ${plural(view.files, "file")}` };
}

/** The heading over the packages or the folders the calls are in. */
export function whereHeading(due: UsageDue | null, byPackage = false): string {
  if (byPackage) return due ? "Still used in" : "Used in";
  return due ? "Where it’s still used" : "Where it’s used";
}

/** A file's value cell as its title reads: each value with its hint and calls, one a line, then the calls without the prop. */
export function cellTitle(cell: UsageCell): string {
  const values = cell.values.map((v) => `${v.text}${v.hint ? ` (${v.hint})` : ""}: ${plural(v.count, "use")}`);
  return [...values, ...(cell.unset > 0 ? [`Not set: ${plural(cell.unset, "use")}`] : [])].join("\n");
}

/** What the file list says when the search or the filters leave no calls in view; null while some are. */
export function emptyText(view: UsageView): string | null {
  if (view.files > 0 || !view.filtered) return null;
  if (view.searched && view.active > 0) return "No uses match this search and these filters.";
  return view.searched ? "No uses match this search." : "No uses match these filters.";
}

function lifecycleText(status: ComponentDetail["migrationStatus"], deprecated: boolean): string | null {
  if (status.status === "superseded") return `Deprecated. Migrate to ${status.by.exportName ? `${status.by.packageName}/${status.by.exportName}` : status.by.packageName}.`;
  if (status.status === "retired") return `Retired: ${status.reason}`;
  return deprecated ? "Deprecated." : null;
}

/** The Copy list text: a header, then each file with the line of each of its call sites and a link to the first. */
export function copyListText(input: CopyListInput): string {
  const { sections, folderKey } = input;
  const files = sections.reduce((n, s) => n + s.files.length, 0);
  const where = folderKey ? `, ${input.byPackage ? "package" : "folder"} ${areaName(folderKey)}` : "";
  const out = [`${input.displayName} in ${input.repoId}${where}: ${plural(sections.reduce((n, s) => n + s.calls, 0), "use")} in ${plural(files, "file")}`];
  const lifecycle = lifecycleText(input.migrationStatus, input.deprecated);
  if (lifecycle) out.push(lifecycle);
  if (input.filters) out.push(`Filters: ${input.filters}`);
  out.push("");
  for (const section of sections) {
    if (!folderKey && section.key !== null) out.push(`${areaName(section.key)} (${plural(section.files.length, "file")})`);
    for (const file of section.files) {
      const first = file.lines[0];
      const url = first ? input.urlFor(file.path, first.line) : null;
      out.push(`- ${file.path}:${file.lines.map((l) => l.line).join(", ")}${url ? ` ${url}` : ""}`);
    }
    out.push("");
  }
  out.push(`View in Scout: ${input.href}`);
  return out.join("\n");
}
