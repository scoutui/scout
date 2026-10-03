import { describe, expect, it } from "vitest";
import type { OccurrencePropChip, OccurrenceRow, PropUsage } from "../src/dto.js";
import { callJsx, cellTitle, copyListText, countText, DEFAULT_USAGE_SORT, emptyText, filterText, nextUsageSort, oneFolderText, pickGroups, propSections, togglePick, usageDue, usageIndex, usageView, valueColumns, valueLabel, valueSpeech, whereHeading, type CopyListInput, type UsageDue, type UsageFilters, type UsageInput, type UsagePick, type UsageSortKey, type UsageView } from "../src/usage-view.js";

const lit = (name: string, value: string): OccurrencePropChip => ({ kind: "literal", name, value });
const ref = (name: string, target: string): OccurrencePropChip => ({ kind: "reference", name, ref: target });
const dyn = (name: string): OccurrencePropChip => ({ kind: "dynamic", name });
let next = 0;
function call(filePath: string, line: number, props: OccurrencePropChip[] = [], extra: Partial<OccurrenceRow> = {}): OccurrenceRow {
  return { occurrenceId: `o${next++}`, filePath, line, column: 1, credit: { kind: "render" }, trace: [], props, events: [], ...extra };
}
function prop(name: string, extra: Partial<PropUsage> = {}): PropUsage {
  return { name, written: [], references: [], dynamicCount: 0, omittedCount: 0, truncatedWrittenCount: 0, status: null, declared: null, ...extra };
}
/** A component's input: its props are every name its calls set, unless given. It has declared props when a prop has a status. */
function input(occurrences: OccurrenceRow[], props?: PropUsage[], events: string[] = []): UsageInput {
  const names = props ?? [...new Set(occurrences.flatMap(o => o.props.map(chip => chip.name)))].map(name => prop(name));
  return { occurrences, props: names, events: events.map(name => ({ name, boundCount: 1 })), hasDeclaredApi: names.some(p => p.status !== null) };
}
function view(given: UsageInput, filters: Partial<UsageFilters> = {}): UsageView {
  return usageView(usageIndex(given), { find: "", area: null, picks: [], sort: DEFAULT_USAGE_SORT, ...filters });
}
const pick = (name: string, kind: UsagePick["kind"], label = ""): UsagePick => ({ prop: name, kind, label });
const valuesOf = (v: UsageView, name: string) => v.props.find(row => row.name === name)?.values.map(value => [value.kind, value.label, value.count]);

describe("usageView values", () => {
  it.each<[string, UsageInput, Partial<UsageFilters>, string, unknown]>([
    ["a written value is its own value", input([call("a.tsx", 1, [lit("size", "large")]), call("a.tsx", 2, [lit("size", "large")]), call("a.tsx", 3, [lit("size", "small")])]), {}, "size", [["value", "large", 2], ["value", "small", 1]]],
    ["a variable counts as {…}", input([call("a.tsx", 1, [ref("tone", "tone")]), call("a.tsx", 2, [lit("tone", "red")])]), {}, "tone", [["value", "red", 1], ["dynamic", "", 1]]],
    ["an expression counts as {…}", input([call("a.tsx", 1, [dyn("label")])]), {}, "label", [["dynamic", "", 1]]],
    ["a call without the prop counts as not set", input([call("a.tsx", 1, [lit("size", "large")]), call("a.tsx", 2)]), {}, "size", [["value", "large", 1], ["unset", "", 1]]],
    ["a bound Vue listener sets its event as {…}", input([call("a.vue", 1, [], { events: ["close"] }), call("a.vue", 2)], [], ["close"]), {}, "close", [["dynamic", "", 1], ["unset", "", 1]]],
    ["a written false is the value false", input([call("a.tsx", 1, [lit("disabled", "false")])]), {}, "disabled", [["value", "false", 1]]],
    ["an empty string is its own value", input([call("a.tsx", 1, [lit("alt", "")])]), {}, "alt", [["value", "", 1]]],
    ["a picked value the other filters leave at 0 stays, at 0", input([call("a.tsx", 1, [lit("size", "large"), lit("tone", "red")]), call("a.tsx", 2, [lit("size", "small"), lit("tone", "blue")])]), { picks: [pick("tone", "value", "red"), pick("size", "value", "small")] }, "size", [["value", "large", 1], ["value", "small", 0]]],
    ["not set stays last, after a picked value left at 0", input([call("a.tsx", 1, [lit("size", "large"), lit("tone", "red")]), call("a.tsx", 2, [lit("size", "small"), lit("tone", "blue")]), call("a.tsx", 3, [lit("tone", "red")])]), { picks: [pick("tone", "value", "red"), pick("size", "value", "small")] }, "size", [["value", "large", 1], ["value", "small", 0], ["unset", "", 1]]],
    ["a prop's own picks don't narrow its own list", input([call("a.tsx", 1, [lit("size", "large")]), call("a.tsx", 2, [lit("size", "small")])]), { picks: [pick("size", "value", "large")] }, "size", [["value", "large", 1], ["value", "small", 1]]],
    ["search narrows every list", input([call("a/One.tsx", 1, [lit("size", "large")]), call("b/Two.tsx", 1, [lit("size", "small")])]), { find: "a/" }, "size", [["value", "large", 1]]],
  ])("%s", (_title, given, filters, name, expected) => {
    expect(valuesOf(view(given, filters), name)).toEqual(expected);
  });

  it("leaves spreads out of the column", () => {
    expect(view(input([call("a.tsx", 1, [dyn("...rest"), lit("size", "large")])])).props.map(row => row.name)).toEqual(["size"]);
  });

  it("orders props by how many calls set them, then by name", () => {
    const calls = [call("a.tsx", 1, [lit("b", "1"), lit("a", "1")]), call("a.tsx", 2, [lit("c", "1")]), call("a.tsx", 3, [lit("c", "1")])];
    expect(view(input(calls, [prop("a"), prop("b"), prop("c"), prop("d", { status: "unused" })])).props.map(row => [row.name, row.set])).toEqual([["c", 2], ["a", 1], ["b", 1], ["d", 0]]);
  });
});

describe("usageView groups", () => {
  it.each([
    ["className", "styling"], ["class", "styling"], ["style", "styling"], ["sx", "styling"], ["css", "styling"],
    ["key", "attribute"], ["ref", "attribute"], ["data-state", "attribute"], ["aria-label", "attribute"],
    ["qaSelector", "attribute"], ["qa-id", "attribute"], ["e2eId", "attribute"], ["testId", "attribute"], ["test_id", "attribute"], ["dataTestId", "attribute"],
    ["onClick", "event"],
    ["variant", "prop"], ["quantity", "prop"], ["latestId", "prop"], ["TestId", "prop"],
  ])("%s is listed under %s", (name, group) => {
    expect(view(input([call("a.tsx", 1, [lit(name, "x")])])).props.find(row => row.name === name)?.group).toBe(group);
  });

  it.each<[string, string, string, PropUsage["status"]]>([
    ["title", "without declared props", "prop", null],
    ["id", "without declared props", "attribute", null],
    ["title", "that doesn't declare it", "attribute", "undeclared"],
    ["title", "that declares it", "prop", "used"],
    ["id", "that declares it", "prop", "used"],
  ])("%s on a component %s is listed under %s", (name, _component, group, status) => {
    expect(view(input([call("a.tsx", 1, [lit(name, "x")])], [prop(name, { status })])).props.find(row => row.name === name)?.group).toBe(group);
  });

  it.each(["close", "hidden"])("lists a Vue listener %s under events on a component with declared props", (name) => {
    expect(view({ ...input([call("a.vue", 1, [], { events: [name] })], [], [name]), hasDeclaredApi: true }).props.find(row => row.name === name)?.group).toBe("event");
  });
});

describe("usageView filters", () => {
  const sizes = input([call("a.tsx", 1, [lit("size", "large")]), call("a.tsx", 2, [lit("size", "small")]), call("a.tsx", 3, [lit("size", "medium")])]);
  const both = input([
    call("a.tsx", 1, [lit("size", "large"), lit("tone", "red")]),
    call("a.tsx", 2, [lit("size", "small"), lit("tone", "red")]),
    call("a.tsx", 3, [lit("size", "small"), lit("tone", "blue")]),
  ]);

  it.each<[string, UsageInput, Partial<UsageFilters>, number]>([
    ["two values of one prop match either", sizes, { picks: [pick("size", "value", "large"), pick("size", "value", "small")] }, 2],
    ["picks on two props must both match", both, { picks: [pick("size", "value", "large"), pick("tone", "value", "red")] }, 1],
    ["a not-set pick matches calls without the prop", input([call("a.tsx", 1, [lit("size", "large")]), call("a.tsx", 2)]), { picks: [pick("size", "unset")] }, 1],
    ["a {…} pick matches variables and expressions", input([call("a.tsx", 1, [ref("tone", "t")]), call("a.tsx", 2, [dyn("tone")]), call("a.tsx", 3, [lit("tone", "red")])]), { picks: [pick("tone", "dynamic")] }, 2],
    ["search matches the path", both, { find: "A.TSX" }, 3],
    ["search matches a prop as written", sizes, { find: 'size="large"' }, 1],
    ["search matches a prop without quotes", sizes, { find: "size=large" }, 1],
    ["search matches a written false as a call line shows it", input([call("a.tsx", 1, [lit("disabled", "false")]), call("a.tsx", 2)]), { find: "disabled={false}" }, 1],
    ["search and a filter apply together", both, { find: "tone=red", picks: [pick("size", "value", "small")] }, 1],
  ])("%s", (_title, given, filters, shown) => {
    expect(view(given, filters).shown).toBe(shown);
  });

  it("counts a call that fails only one prop's filter in that prop's list, and nowhere else", () => {
    const v = view(both, { picks: [pick("size", "value", "large"), pick("tone", "value", "red")] });
    expect({ size: valuesOf(v, "size"), tone: valuesOf(v, "tone"), shown: v.shown }).toEqual({ size: [["value", "large", 1], ["value", "small", 1]], tone: [["value", "red", 1]], shown: 1 });
  });

  it("counts one active filter per filtered prop plus the folder, and search only as filtered", () => {
    expect([view(both, { picks: [pick("size", "value", "large"), pick("size", "value", "small"), pick("tone", "value", "red")], area: "." }), view(both, { find: "a" })].map(v => [v.active, v.filtered])).toEqual([[3, true], [0, true]]);
  });

  it("counts a search only when it holds more than spaces", () => {
    expect([view(both, { find: " a " }), view(both, { find: "  " })].map(v => [v.searched, v.filtered])).toEqual([[true, true], [false, false]]);
  });

  it("counts every stored row, including two at one place", () => {
    expect(view(input([call("a.tsx", 6, [], { owner: { componentId: "x", displayName: "X" } }), call("a.tsx", 6, [], { owner: { componentId: "y", displayName: "Y" } })])).total).toBe(2);
  });
});

describe("count and empty-list text", () => {
  const calls = input([call("src/a/Pay.tsx", 1, [lit("size", "large")]), call("src/a/Pay.tsx", 2), call("src/b/Panel.tsx", 1, [lit("size", "small")])]);

  it.each<[string, Partial<UsageFilters>, UsageDue | null, ReturnType<typeof countText>]>([
    ["every call without filters", {}, null, { short: "3 uses", long: "3 uses · 2 files" }],
    ["the calls in view of every call under a filter", { picks: [pick("size", "value", "large")] }, null, { short: "1 of 3 uses", long: "1 of 3 uses · 1 file" }],
    ["the calls in view of every call under a folder filter", { area: "src/b" }, null, { short: "1 of 3 uses", long: "1 of 3 uses · 1 file" }],
    ["a deprecated component's calls as still to migrate", {}, "to migrate", { short: "3 to migrate", long: "3 uses still to migrate · 2 files" }],
    ["a deprecated component's calls in view as still to migrate under a filter", { picks: [pick("size", "value", "large")] }, "to migrate", { short: "1 of 3 to migrate", long: "1 of 3 uses still to migrate · 1 file" }],
  ])("counts %s", (_title, filters, due, text) => {
    expect(countText(view(calls, filters), due)).toEqual(text);
  });

  it.each<[string, boolean, CopyListInput["migrationStatus"], UsageDue | null]>([
    ["says a superseded component's calls are to migrate", true, { status: "superseded", by: { packageName: "@example/ui", exportName: "Button" } }, "to migrate"],
    ["says a retired component's calls are to remove", true, { status: "retired", reason: "Use a link instead" }, "to remove"],
    ["says nothing is due for a component that isn't deprecated", false, { status: "active" }, null],
  ])("%s", (_title, deprecated, status, due) => {
    expect(usageDue(deprecated, status)).toBe(due);
  });

  it.each<[string, UsageDue | null, string]>([
    ["as where it's used for a component that isn't deprecated", null, "Where it’s used"],
    ["as where it's still used for a deprecated one", "to remove", "Where it’s still used"],
  ])("heads the folders %s", (_title, due, heading) => {
    expect(whereHeading(due)).toBe(heading);
  });

  it.each<[string, Partial<UsageFilters>, string | null]>([
    ["names the search and the filters when together they leave no calls", { find: "zzz", picks: [pick("size", "value", "large")] }, "No uses match this search and these filters."],
    ["names the search when it leaves no calls", { find: "zzz" }, "No uses match this search."],
    ["names the filters when they leave no calls", { picks: [pick("size", "value", "medium")] }, "No uses match these filters."],
    ["says nothing while calls are in view", { find: "pay" }, null],
  ])("%s", (_title, filters, text) => {
    expect(emptyText(view(calls, filters))).toBe(text);
  });
});

describe("usageView folders", () => {
  const spread = input([call("src/a/One.tsx", 1, [lit("size", "large")]), call("src/b/Two.tsx", 1, [lit("size", "small")]), call("src/b/Three.tsx", 1, [lit("size", "small")])]);

  it("counts folders under every filter but the folder, highest first", () => {
    expect(view(spread, { area: "src/a" }).areas.map(a => [a.key, a.label, a.count, a.picked])).toEqual([["src/b", "b", 2, false], ["src/a", "a", 1, true]]);
  });

  it("lists a picked folder the other filters leave empty first, at 0", () => {
    expect(view(spread, { area: "src/b", picks: [pick("size", "value", "large")] }).areas.map(a => [a.key, a.count])).toEqual([["src/b", 0], ["src/a", 1]]);
  });

  it("labels files directly in the shared folder with the folder and a slash", () => {
    expect(view(input([call("src/a/One.tsx", 1), call("src/Two.tsx", 1)])).areas.map(a => [a.key, a.label])).toEqual([["src/a", "a"], ["src", "src/"]]);
  });

  it("labels files at the repo root as the repo root", () => {
    expect(view(input([call("One.tsx", 1), call("src/Two.tsx", 1)])).areas.map(a => [a.key, a.label])).toEqual([[".", "(repo root)"], ["src", "src"]]);
  });
});

describe("the filter column", () => {
  const names = (rows: readonly { name: string }[]) => rows.map(row => row.name);
  const sized = input([call("a.tsx", 1, [lit("size", "large")])], [prop("size"), prop("tone"), prop("variant")]);

  it.each<[string, Partial<UsageFilters>, string[], string[]]>([
    ["lists the props calls in view set, and the rest under Not set", {}, ["size"], ["tone", "variant"]],
    ["keeps a filtered prop no call sets under Prop values", { picks: [pick("tone", "unset")] }, ["size", "tone"], ["variant"]],
  ])("%s", (_title, filters, listed, unset) => {
    const sections = propSections(view(sized, filters), "");
    expect([names(sections.listed), names(sections.unset)]).toEqual([listed, unset]);
  });

  it("lists styling, events and attributes in that order, each with its props set or not", () => {
    const given = input([call("a.tsx", 1, [lit("className", "x"), dyn("onClick")])], [prop("size"), prop("className"), prop("onClick"), prop("data-state"), prop("style")]);
    expect(propSections(view(given), "").groups.map(g => [g.group, names(g.props)])).toEqual([["styling", ["className", "style"]], ["event", ["onClick"]], ["attribute", ["data-state"]]]);
  });

  it("while no call is in view, leaves Not set empty and keeps only each section's filtered props", () => {
    const given = input([call("a.tsx", 1, [lit("size", "large"), lit("className", "x")])], [prop("size"), prop("tone"), prop("className"), prop("style"), prop("onClick")]);
    const sections = propSections(view(given, { picks: [pick("size", "value", "small"), pick("className", "value", "x")] }), "");
    expect([names(sections.listed), sections.unset, sections.groups.map(g => [g.group, names(g.props)])]).toEqual([["size"], [], [["styling", ["className"]]]]);
  });

  it("finds props by any part of their name, ignoring case and spaces, in every list", () => {
    const given = input([call("a.tsx", 1, [lit("size", "large"), lit("tone", "red"), dyn("onClick")])], [prop("size"), prop("tone"), prop("onClick"), prop("iconName"), prop("variant")]);
    const sections = propSections(view(given), " ON ");
    expect([sections.finding, names(sections.listed), names(sections.unset), sections.groups.map(g => [g.group, names(g.props)])]).toEqual([true, ["tone"], ["iconName"], [["event", ["onClick"]]]]);
  });

  it.each([
    [10, false],
    [11, true],
  ])("with %i props, offers Find a prop: %s", (count, findable) => {
    const given = input([call("a.tsx", 1)], Array.from({ length: count }, (_, i) => prop(`p${i}`)));
    expect(propSections(view(given), "").findable).toBe(findable);
  });

  const inOne = (n: number) => input(Array.from({ length: n }, (_, i) => call(`src/a/F${i}.tsx`, 1)));
  it.each<[string, UsageInput, Partial<UsageFilters>, ReturnType<typeof oneFolderText>]>([
    ["names the folder of a single call", inOne(1), {}, { lead: "The only use is in", label: "a/" }],
    ["names the folder of both calls", inOne(2), {}, { lead: "Both uses are in", label: "a/" }],
    ["names the folder of every call", inOne(3), {}, { lead: "All 3 uses are in", label: "a/" }],
    ["says nothing for calls in two folders", input([call("src/a/One.tsx", 1), call("src/b/Two.tsx", 1)]), {}, null],
    ["says nothing while the folder is filtered", inOne(2), { area: "src/a" }, null],
  ])("one-folder sentence: %s", (_title, given, filters, sentence) => {
    expect(oneFolderText(view(given, filters))).toEqual(sentence);
  });

  it.each<[string, UsagePick[], UsagePick, UsagePick[]]>([
    ["removes a picked value and keeps the others", [pick("size", "value", "large"), pick("size", "value", "small")], pick("size", "value", "large"), [pick("size", "value", "small")]],
    ["adds a value another prop has picked too, and keeps that pick", [pick("disabled", "value", "true")], pick("fullWidth", "value", "true"), [pick("disabled", "value", "true"), pick("fullWidth", "value", "true")]],
  ])("togglePick %s", (_title, picks, toggled, after) => {
    expect(togglePick(picks, toggled)).toEqual(after);
  });
});

describe("value and call text", () => {
  it.each<[Parameters<typeof valueLabel>[0], string]>([
    [{ kind: "value", label: "large" }, "large"],
    [{ kind: "value", label: "" }, '""'],
    [{ kind: "value", label: "me-2 ms-2" }, '"me-2 ms-2"'],
    [{ kind: "dynamic", label: "" }, "{…}"],
    [{ kind: "unset", label: "" }, "not set"],
  ])("valueLabel(%j) is %s", (value, text) => {
    expect(valueLabel(value)).toBe(text);
  });

  it.each<[OccurrencePropChip, string]>([
    [lit("size", "large"), 'size="large"'],
    [lit("isFullWidth", "true"), "isFullWidth"],
    [lit("disabled", "false"), "disabled={false}"],
    [ref("variant", "tone"), "variant={tone}"],
    [dyn("label"), "label={…}"],
    [dyn("...rest"), "{...rest}"],
  ])("callJsx(%j) is %s", (chip, text) => {
    expect(callJsx(chip)).toBe(text);
  });
});

const columnsFor = (given: UsageInput, picks: UsagePick[] = [], room = 1000) => valueColumns(usageIndex(given), picks, room, 7).map(c => c.prop);
function viewWith(given: UsageInput, filters: Partial<UsageFilters> = {}, columns: string[] = []): UsageView {
  return usageView(usageIndex(given), { find: "", area: null, picks: [], sort: DEFAULT_USAGE_SORT, ...filters }, columns);
}
const files = (v: UsageView) => v.sections.flatMap(s => s.files.map(f => `${f.lead}${f.base}`));
const owned = (id: string) => ({ owner: { componentId: id, displayName: id.toUpperCase() } });

describe("usageView call lines", () => {
  it("merges the rows at one place into one line listing every owner once, and still counts each row", () => {
    const v = viewWith(input([call("src/Pay.tsx", 6, [lit("size", "large")], owned("form")), call("src/Pay.tsx", 6, [lit("size", "large")], owned("dialog")), call("src/Pay.tsx", 6, [lit("size", "large")], owned("form")), call("src/Pay.tsx", 9, [], owned("form"))]));
    const file = v.sections[0]?.files[0];
    expect({ calls: file?.calls, lines: file?.lines.map(l => [l.line, l.owners.map(o => o.componentId), l.rows]) }).toEqual({ calls: 4, lines: [[6, ["form", "dialog"], 3], [9, ["form"], 1]] });
  });

  it("gives a call outside any component no owners", () => {
    expect(viewWith(input([call("src/config.tsx", 4)])).sections[0]?.files[0]?.lines[0]?.owners).toEqual([]);
  });

  it("lists a line's props most set in the scan first, then spreads, then its styling, events and attributes", () => {
    const given = input([call("src/a.tsx", 1, [lit("className", "x"), dyn("onClick"), dyn("...rest"), lit("tone", "red"), lit("size", "large")])], [prop("size", { written: [{ value: "large", count: 1 }] }), prop("className"), prop("onClick"), prop("tone", { written: [{ value: "red", count: 2 }] })]);
    expect(viewWith(given).sections[0]?.files[0]?.lines[0]?.props.map(c => c.name)).toEqual(["tone", "size", "...rest", "className", "onClick"]);
  });

  it("names a file's owners once when every call line has the same ones", () => {
    const file = viewWith(input([call("src/Pay.tsx", 6, [], owned("form")), call("src/Pay.tsx", 6, [], owned("dialog")), call("src/Pay.tsx", 9, [], owned("dialog")), call("src/Pay.tsx", 9, [], owned("form"))])).sections[0]?.files[0];
    expect(file?.owners?.map(o => o.componentId)).toEqual(["form", "dialog"]);
  });

  it("marks a line's events and attributes quiet, and its props and spreads not", () => {
    const line = viewWith(input([call("src/a.tsx", 1, [dyn("onClick"), lit("data-state", "open"), lit("size", "large"), dyn("...rest")])])).sections[0]?.files[0]?.lines[0];
    expect(Object.fromEntries(line?.props.map(c => [c.name, c.quiet]) ?? [])).toEqual({ onClick: true, "data-state": true, size: false, "...rest": false });
  });

  it.each<[string, Partial<OccurrenceRow>, string | null]>([
    ["a component passed to a function shows the function", { credit: { kind: "argument", callee: "makeControl", index: 0 } }, "makeControl"],
    ["a call through a helper shows the helper", { trace: [{ kind: "helper-call", callee: "renderRow" }] }, "renderRow"],
    ["a rendered call shows nothing", {}, null],
  ])("%s", (_title, extra, via) => {
    expect(viewWith(input([call("src/a.tsx", 1, [], extra)])).sections[0]?.files[0]?.lines[0]?.via).toBe(via);
  });
});

describe("usageView sort and grouping", () => {
  const calls = [call("src/c/Gamma.tsx", 1), call("src/b/Beta.tsx", 1, [lit("size", "small")]), call("src/a/Zeta.tsx", 1, [lit("size", "large")]), call("src/a/Zeta.tsx", 2, [lit("size", "large")])];

  it.each<[string, UsageFilters["sort"], string[], string[]]>([
    ["calls, highest first, then path", { key: "calls", dir: "desc" }, [], ["Zeta.tsx", "Beta.tsx", "Gamma.tsx"]],
    ["calls, lowest first", { key: "calls", dir: "asc" }, [], ["Beta.tsx", "Gamma.tsx", "Zeta.tsx"]],
    ["file name, A to Z", { key: "file", dir: "asc" }, [], ["Beta.tsx", "Gamma.tsx", "Zeta.tsx"]],
    ["a value column, highest first, files without it last", { key: "prop:size", dir: "desc" }, ["size"], ["Beta.tsx", "Zeta.tsx", "Gamma.tsx"]],
    ["a value column, lowest first, files without it last", { key: "prop:size", dir: "asc" }, ["size"], ["Zeta.tsx", "Beta.tsx", "Gamma.tsx"]],
  ])("sorts by %s", (_title, sort, columns, order) => {
    expect(files(viewWith(input(calls), { sort }, columns))).toEqual(order);
  });

  it.each<[string, UsageFilters["sort"], UsageSortKey, UsageFilters["sort"]]>([
    ["flips the sorted column", { key: "file", dir: "asc" }, "file", { key: "file", dir: "desc" }],
    ["starts calls highest first", { key: "file", dir: "asc" }, "calls", { key: "calls", dir: "desc" }],
    ["starts the file name A to Z", { key: "calls", dir: "desc" }, "file", { key: "file", dir: "asc" }],
    ["starts a value column A to Z", { key: "calls", dir: "desc" }, "prop:size", { key: "prop:size", dir: "asc" }],
  ])("a header click %s", (_title, sort, key, next) => {
    expect(nextUsageSort(sort, key)).toEqual(next);
  });

  it.each<[string, string[], UsageFilters["sort"]]>([
    ["calls, highest first, while the sorted value column isn't shown", [], DEFAULT_USAGE_SORT],
    ["the value column's sort while it's shown", ["size"], { key: "prop:size", dir: "asc" }],
  ])("reports the sort applied: %s", (_title, columns, sort) => {
    expect(viewWith(input(calls), { sort: { key: "prop:size", dir: "asc" } }, columns).sort).toEqual(sort);
  });

  const many = (count: number) => Array.from({ length: count }, (_, i) => call(`src/${i % 2 ? "odd" : "even"}/File${i}.tsx`, 1));

  it.each<[string, OccurrenceRow[], Partial<UsageFilters>, boolean]>([
    ["groups by folder past 24 files in more than one folder", many(25), {}, true],
    ["keeps one list at 24 files", many(24), {}, false],
    ["keeps one list when sorted by anything but calls", many(25), { sort: { key: "file", dir: "asc" } }, false],
    ["keeps one list under a folder filter", many(50), { area: "src/odd" }, false],
    ["keeps one list when every file is in one folder", Array.from({ length: 25 }, (_, i) => call(`src/odd/File${i}.tsx`, 1)), {}, false],
  ])("%s", (_title, given, filters, grouped) => {
    expect(viewWith(input(given), filters).grouped).toBe(grouped);
  });
});

describe("usageView rows open", () => {
  const calls = [...Array.from({ length: 5 }, (_, i) => call(`src/a/F${i}.tsx`, 1)), call("src/b/G.tsx", 1)];
  it.each<[string, Partial<UsageFilters>, boolean]>([
    ["start open with 5 uses in view", { find: "src/a/" }, true],
    ["start closed with 6 uses in view", {}, false],
  ])("file rows %s", (_title, filters, open) => {
    expect(view(input(calls), filters).rowsOpen).toBe(open);
  });
});

describe("usageView file names", () => {
  it.each<[string, string[], Partial<UsageFilters>, string[]]>([
    ["a unique name shows no folder", ["src/a/Button.tsx", "src/b/Card.tsx"], { sort: { key: "file", dir: "asc" } }, ["Button.tsx", "Card.tsx"]],
    ["a generic name shows its parent folder", ["src/a/index.tsx"], {}, ["a/index.tsx"]],
    ["shared names show parent folders until they differ", ["src/a/x/Button.tsx", "src/b/x/Button.tsx"], { sort: { key: "file", dir: "asc" } }, ["a/x/Button.tsx", "b/x/Button.tsx"]],
    ["names are compared among the files in view", ["src/a/x/Button.tsx", "src/b/x/Button.tsx"], { find: "src/a/" }, ["Button.tsx"]],
  ])("%s", (_title, paths, filters, shown) => {
    expect(files(viewWith(input(paths.map(path => call(path, 1))), filters))).toEqual(shown);
  });
});

describe("value columns", () => {
  const six = (extra: OccurrencePropChip[] = []) => Array.from({ length: 6 }, (_, i) => call(`src/F${i}.tsx`, 1, [lit("size", i < 4 ? "large" : "small"), lit("tone", "red"), ref("label", "t"), lit("className", "x"), ...extra]));

  it.each<[string, OccurrenceRow[], UsagePick[], number, string[]]>([
    ["a prop needs a written value", six(), [], 1000, ["size", "tone"]],
    ["none at 5 uses or fewer", six().slice(0, 5), [], 1000, []],
    ["at most three, most set first", six().map((c, i) => ({ ...c, props: [...c.props, ...(i < 3 ? [lit("a", "1")] : []), lit("b", "1")] })), [], 1000, ["b", "size", "tone"]],
    ["orders props set on the same number of calls by name", Array.from({ length: 6 }, (_, i) => call(`src/F${i}.tsx`, 1, [lit("b", "1"), lit("a", "1")])), [], 1000, ["a", "b"]],
    ["a prop filtered to one value loses its column", six(), [pick("size", "value", "large")], 1000, ["tone"]],
    ["a prop filtered to two values keeps it", six(), [pick("size", "value", "large"), pick("size", "value", "small")], 1000, ["size", "tone"]],
    ["columns stop at the first that doesn't fit", six([lit("z", "1")]), [], 120, ["size"]],
    ["no room, no columns", six(), [], 0, []],
    ["a cell's +N widens its column", [call("src/F0.tsx", 1, [lit("size", "large"), lit("tone", "red")]), call("src/F0.tsx", 2, [lit("size", "small"), lit("tone", "red")]), ...Array.from({ length: 4 }, (_, i) => call(`src/F${i + 1}.tsx`, 1, [lit("size", "large"), lit("tone", "red")]))], [], 140, ["size"]],
  ])("%s", (_title, given, picks, room, shown) => {
    expect(columnsFor(input(given), picks, room)).toEqual(shown);
  });

  it("a file's cell lists its values most used first, with the rest as +N", () => {
    const v = viewWith(input([call("src/A.tsx", 1, [lit("size", "small")]), call("src/A.tsx", 2, [lit("size", "large")]), call("src/A.tsx", 3, [lit("size", "large")]), call("src/A.tsx", 4)]), {}, ["size"]);
    const cell = v.sections[0]?.files[0]?.cells.size;
    expect([cell?.values.map(x => [x.text, x.count]), cell?.more, cell?.unset]).toEqual([[["large", 2], ["small", 1]], 2, 1]);
  });

  it("a file's cell marks an empty string and an expression, with a variable read as an expression", () => {
    const v = viewWith(input([call("src/A.tsx", 1, [lit("label", "")]), call("src/A.tsx", 2, [ref("label", "t")]), call("src/A.tsx", 3, [dyn("label")]), call("src/A.tsx", 4, [lit("label", "Pay")])]), {}, ["label"]);
    expect(v.sections[0]?.files[0]?.cells.label?.values.map(x => [x.text, x.count, x.hint])).toEqual([["{…}", 2, "Expression"], ['""', 1, "Empty string"], ["Pay", 1, null]]);
  });

  it("a file's cell is titled with each value and its calls, then the calls that don't set it", () => {
    const v = viewWith(input([call("src/A.tsx", 1, [lit("label", "Pay")]), call("src/A.tsx", 2, [lit("label", "Pay")]), call("src/A.tsx", 3, [lit("label", "")]), call("src/A.tsx", 4, [dyn("label")]), call("src/A.tsx", 5)]), {}, ["label"]);
    const cell = v.sections[0]?.files[0]?.cells.label;
    expect(cell && cellTitle(cell)).toBe('Pay: 2 uses\n"" (Empty string): 1 use\n{…} (Expression): 1 use\nNot set: 1 use');
  });

  it.each<[string, UsagePick[], boolean[]]>([
    ["marks no value without a filter", [], [false]],
    ["marks a value the filters pick", [pick("size", "value", "large"), pick("size", "value", "small")], [true]],
  ])("a file's cell %s", (_title, picks, picked) => {
    const v = viewWith(input([call("src/A.tsx", 1, [lit("size", "large")])]), { picks }, ["size"]);
    expect(v.sections[0]?.files[0]?.cells.size?.values.map(x => x.picked)).toEqual(picked);
  });

  it.each<[string, OccurrenceRow[], string[], string]>([
    ["a written value", [call("src/A.tsx", 1, [lit("size", "large")])], ["size"], 'size="large"'],
    ["a written true as the bare name", [call("src/A.tsx", 1, [lit("isFullWidth", "true")])], ["isFullWidth"], "isFullWidth"],
    ["a written false in braces", [call("src/A.tsx", 1, [lit("disabled", "false")])], ["disabled"], "disabled={false}"],
    ["an empty string in quotes", [call("src/A.tsx", 1, [lit("alt", "")])], ["alt"], 'alt=""'],
    ["the most used value", [call("src/A.tsx", 1, [lit("size", "small")]), call("src/A.tsx", 2, [lit("size", "large")]), call("src/A.tsx", 3, [lit("size", "large")])], ["size"], 'size="large"'],
    ["nothing for a most used expression", [call("src/A.tsx", 1, [dyn("label")])], ["label"], ""],
    ["nothing for a most used variable", [call("src/A.tsx", 1, [ref("label", "t")])], ["label"], ""],
    ["nothing for a prop the file doesn't set", [call("src/A.tsx", 1)], ["size"], ""],
    ["each prop in the order given, joined by spaces", [call("src/A.tsx", 1, [lit("tone", "red"), lit("size", "large")])], ["size", "tone"], 'size="large" tone="red"'],
  ])("a file's JSX line shows %s", (_title, given, lineProps, jsx) => {
    const v = usageView(usageIndex(input(given)), { find: "", area: null, picks: [], sort: DEFAULT_USAGE_SORT }, [], lineProps);
    expect(v.sections[0]?.files[0]?.jsx).toBe(jsx);
  });

  const written = [call("src/A.tsx", 1, [lit("size", "large")]), call("src/A.tsx", 2, [ref("size", "tone")]), call("src/A.tsx", 3, [dyn("size")]), call("src/A.tsx", 4, [lit("size", "")]), call("src/A.tsx", 5)];
  it("a call line's cell shows its value as written, an expression marked, and nothing where the call doesn't set it", () => {
    const v = viewWith(input(written), {}, ["size"]);
    expect(v.sections[0]?.files[0]?.lines.map(l => l.cells.size)).toEqual([
      { text: "large", expression: false, picked: false },
      { text: "{tone}", expression: false, picked: false },
      { text: "{…}", expression: true, picked: false },
      { text: '""', expression: false, picked: false },
      null,
    ]);
  });

  it("a one-line file's call line has no cells, with two rows at that one place", () => {
    const v = viewWith(input([call("src/A.tsx", 6, [lit("size", "large")], owned("form")), call("src/A.tsx", 6, [lit("size", "large")], owned("dialog"))]), {}, ["size"]);
    expect(v.sections[0]?.files[0]?.lines.map(l => [l.rows, l.cells])).toEqual([[2, {}]]);
  });

  it("a call line's cell marks a variable a {…} filter picks", () => {
    const v = viewWith(input(written), { picks: [pick("size", "dynamic"), pick("size", "unset")] }, ["size"]);
    expect(v.sections[0]?.files[0]?.lines.map(l => l.cells.size?.picked ?? null)).toEqual([true, true, null]);
  });
});

describe("copy list", () => {
  it("lists each call site's line once, headed by the component, the counts and the filters", () => {
    const v = viewWith(input([call("src/Pay.tsx", 6, [], owned("form")), call("src/Pay.tsx", 6, [], owned("dialog")), call("src/Pay.tsx", 9)]), { picks: [pick("size", "unset")] });
    expect(copyListText({ sections: v.sections, displayName: "Button", repoId: "shop", deprecated: false, migrationStatus: { status: "active" }, folderKey: null, filters: filterText([pick("size", "unset")], null, ""), href: "https://scout.test/x", urlFor: (path, line) => `https://git.test/${path}#L${line}` }))
      .toBe("Button in shop: 3 uses in 1 file\nFilters: size not set\n\n- src/Pay.tsx:6, 9 https://git.test/src/Pay.tsx#L6\n\nView in Scout: https://scout.test/x");
  });

  const name = (i: number) => `F${String(i).padStart(2, "0")}.tsx`;
  const filesIn = (dir: string, count: number) => Array.from({ length: count }, (_, i) => call(`${dir}${name(i)}`, 1));
  const listed = (dir: string, count: number) => Array.from({ length: count }, (_, i) => `- ${dir}${name(i)}:1`);
  const copy = (v: UsageView, extra: Partial<CopyListInput> = {}) =>
    copyListText({ sections: v.sections, displayName: "Button", repoId: "shop", deprecated: false, migrationStatus: { status: "active" }, folderKey: null, filters: "", href: "https://scout.test/x", urlFor: () => null, ...extra });

  it("lists a grouped view folder by folder, most calls first, each headed by its full path", () => {
    const v = viewWith(input([...filesIn("apps/web/checkout/", 12), ...filesIn("apps/web/", 13)]));
    expect(copy(v)).toBe(["Button in shop: 25 uses in 25 files", "", "apps/web (13 files)", ...listed("apps/web/", 13), "", "apps/web/checkout (12 files)", ...listed("apps/web/checkout/", 12), "", "View in Scout: https://scout.test/x"].join("\n"));
  });

  it("names the folder in the header of a folder's own copy, without a heading line", () => {
    const v = viewWith(input([...filesIn("", 13), ...filesIn("src/", 12)]));
    expect(copy(v, { sections: v.sections.slice(0, 1), folderKey: "." })).toBe(["Button in shop, folder (repo root): 13 uses in 13 files", "", ...listed("", 13), "", "View in Scout: https://scout.test/x"].join("\n"));
  });

  it.each<[string, CopyListInput["migrationStatus"], boolean, string]>([
    ["superseded by an export", { status: "superseded", by: { packageName: "@example/ui", exportName: "Button" } }, false, "Deprecated. Migrate to @example/ui/Button."],
    ["superseded by a package", { status: "superseded", by: { packageName: "@example/ui" } }, false, "Deprecated. Migrate to @example/ui."],
    ["retired", { status: "retired", reason: "Use a link instead" }, false, "Retired: Use a link instead"],
    ["deprecated", { status: "active" }, true, "Deprecated."],
  ])("says under the header when the component is %s", (_title, migrationStatus, deprecated, line) => {
    expect(copy(viewWith(input([call("src/Pay.tsx", 6)])), { migrationStatus, deprecated })).toBe(`Button in shop: 1 use in 1 file\n${line}\n\n- src/Pay.tsx:6\n\nView in Scout: https://scout.test/x`);
  });

  it.each<[UsagePick[], string | null, string, string]>([
    [[pick("size", "value", "large"), pick("size", "value", "small")], null, "", "size = large or small"],
    [[pick("size", "value", "large"), pick("size", "dynamic"), pick("size", "unset")], null, "", "size = large, {…} or not set"],
    [[], "src/a", "", "folder src/a"],
    [[], null, " Pay ", "search “pay”"],
    [[pick("size", "value", "large")], "src/a", "", "size = large; folder src/a"],
  ])("filterText(%j, %j, %j) is %s", (picks, area, find, text) => {
    expect(filterText(picks, area, find)).toBe(text);
  });

  it("reads an expression aloud as the word", () => {
    expect(filterText([pick("size", "value", "large"), pick("size", "dynamic")], null, "", valueSpeech)).toBe("size = large or expression");
  });

  it("groups the picks by prop in the order first picked, each value once", () => {
    expect(pickGroups([pick("size", "value", "large"), pick("variant", "dynamic"), pick("size", "unset"), pick("size", "value", "large")])).toEqual([
      { prop: "size", picks: [pick("size", "value", "large"), pick("size", "unset")] },
      { prop: "variant", picks: [pick("variant", "dynamic")] },
    ]);
  });
});
