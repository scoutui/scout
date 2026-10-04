import { describe, it, expect } from "vitest";
import { rollupOccurrencesToComponents, type ComponentRow } from "../../src/rollup.js";
import type { Identity, ResolvedOccurrence } from "@scoutui/scan-format";

const baseId = "c-example-button";
const baseIdentity: Identity = { kind: "tag", tagName: "example-button" };

const row = (overrides: Partial<ComponentRow> = {}): ComponentRow => ({
  id: baseId,
  identity: baseIdentity,
  ...overrides,
});

const occ = (
  filePath: string,
  line: number,
  props: ResolvedOccurrence["props"] = {},
  events?: string[],
): ResolvedOccurrence => ({
  occurrenceId: `${filePath}:${line}`,
  resolution: { status: "resolved", componentId: baseId },
  filePath,
  line,
  column: 1,
  credit: { kind: "render" },
  trace: [],
  props,
  ...(events !== undefined ? { events } : {}),
});

describe("rollupOccurrencesToComponents", () => {
  it("counts occurrences and unique files (multi-occurrence in same file keeps fileCount low)", () => {
    const occs = [occ("a.tsx", 1), occ("a.tsx", 2), occ("b.tsx", 1)];
    const out = rollupOccurrencesToComponents(occs, [row()]);
    expect(out).toHaveLength(1);
    expect(out[0].stats).toEqual({ occurrenceCount: 3, fileCount: 2 });
  });

  it("rolls written literals into structured value entries", () => {
    const occs = [
      occ("a.tsx", 1, { size: { tier: "written", value: "large" } }),
      occ("a.tsx", 2, { size: { tier: "written", value: "large" } }),
      occ("a.tsx", 3, { size: { tier: "written", value: "small" } }),
      occ("a.tsx", 4, { size: { tier: "reference", ref: "props.size" } }),
      occ("a.tsx", 5, { size: { tier: "dynamic" } }),
      occ("a.tsx", 6),
    ];
    const out = rollupOccurrencesToComponents(occs, [row()]);
    const d = out[0].props.size;
    expect(d.values).toEqual([
      { provenance: "written", value: "large", count: 2 },
      { provenance: "written", value: "small", count: 1 },
      { provenance: "reference", ref: "props.size", count: 1 },
    ]);
    expect(d.dynamic).toBe(1);
    expect(d.omitted).toBe(1);
    // invariant: 3 (values) + 1 dynamic + 0 other + 1 omitted === 6 occurrences
    const sum = d.values.reduce((s, e) => s + e.count, 0) + d.dynamic + (d.other ?? 0) + d.omitted;
    expect(sum).toBe(out[0].stats.occurrenceCount);
  });

  it("literal null is a written null, not the string \"null\"", () => {
    const out = rollupOccurrencesToComponents([occ("a.tsx", 1, { ariaLabel: { tier: "written", value: null } })], [row()]);
    expect(out[0].props.ariaLabel.values).toEqual([{ provenance: "written", value: null, count: 1 }]);
  });

  it("folds a written valueSet as one entry counted once", () => {
    const occs = [
      occ("a.tsx", 1, { v: { tier: "written", valueSet: ["b", "a"] } }),
      occ("a.tsx", 2, { v: { tier: "written", valueSet: ["a", "b"] } }),
    ];
    const out = rollupOccurrencesToComponents(occs, [row()]);
    expect(out[0].props.v.values).toEqual([{ provenance: "written", valueSet: ["a", "b"], count: 2 }]);
  });

  it("counts dynamic and omitted separately", () => {
    const occs = [
      occ("a.tsx", 1, { size: { tier: "written", value: "large" } }),
      occ("a.tsx", 2, { size: { tier: "dynamic" } }),
      occ("a.tsx", 3),
      occ("a.tsx", 4),
    ];
    const out = rollupOccurrencesToComponents(occs, [row()]);
    expect(out[0].props.size).toEqual({
      values: [{ provenance: "written", value: "large", count: 1 }],
      dynamic: 1,
      omitted: 2,
    });
  });

  it("emits identity and zeroed stats when component has no occurrences", () => {
    const out = rollupOccurrencesToComponents([], [row()]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(baseId);
    expect(out[0].identity).toEqual(baseIdentity);
    expect(out[0].stats).toEqual({ occurrenceCount: 0, fileCount: 0 });
    expect(out[0].props).toEqual({});
  });

  it("preserves the math invariant: values-sum + dynamic + omitted = occurrenceCount per prop", () => {
    const occs = [
      occ("a.tsx", 1, { size: { tier: "written", value: "large" } }),
      occ("a.tsx", 2, { size: { tier: "written", value: "small" } }),
      occ("b.tsx", 1, { size: { tier: "dynamic" } }),
      occ("b.tsx", 2),
      occ("c.tsx", 1, { other: { tier: "written", value: "x" } }),
    ];
    const out = rollupOccurrencesToComponents(occs, [row()]);
    const sizeDist = out[0].props.size;
    const sizeSum = sizeDist.values.reduce((a, e) => a + e.count, 0);
    expect(sizeSum + sizeDist.dynamic + sizeDist.omitted).toBe(out[0].stats.occurrenceCount);

    // `other` was only set in 1 of 5 occurrences; the remaining 4 count as omitted.
    const otherDist = out[0].props.other;
    const otherSum = otherDist.values.reduce((a, e) => a + e.count, 0);
    expect(otherSum + otherDist.dynamic + otherDist.omitted).toBe(out[0].stats.occurrenceCount);
  });

  it("does not emit an edges field on rolled components", () => {
    const out = rollupOccurrencesToComponents([occ("a.tsx", 1)], [row()]);
    expect("edges" in out[0]).toBe(false);

    const empty = rollupOccurrencesToComponents([], [row()]);
    expect("edges" in empty[0]).toBe(false);
  });

  it("rolls events from Vue occurrence events and React on* props into one map", () => {
    const occs = [
      occ("a.vue", 1, {}, ["click"]),
      occ("b.tsx", 1, { onClick: { tier: "dynamic" }, variant: { tier: "written", value: "primary" } }),
    ];
    const out = rollupOccurrencesToComponents(occs, [row()]);
    expect(out[0].events).toEqual({ click: { boundCount: 1 }, onClick: { boundCount: 1 } });
  });

  it("dedupes duplicate event names within a single occurrence (e.g. @click + v-on:click both -> 'click')", () => {
    const out = rollupOccurrencesToComponents([occ("a.vue", 1, {}, ["click", "click"])], [row()]);
    expect(out[0].events).toEqual({ click: { boundCount: 1 } });
  });

  it("type-qualifies written scalar bucket keys so distinct-type values don't collide (0 vs \"0\")", () => {
    const occs = [
      occ("a.tsx", 1, { count: { tier: "written", value: 0 } }),
      occ("a.tsx", 2, { count: { tier: "written", value: "0" } }),
    ];
    const out = rollupOccurrencesToComponents(occs, [row()]);
    const values = out[0].props.count.values;
    expect(values).toHaveLength(2);
    expect(values).toEqual(
      expect.arrayContaining([
        { provenance: "written", value: 0, count: 1 },
        { provenance: "written", value: "0", count: 1 },
      ]),
    );
  });

  it("type-qualifies written scalar bucket keys so null and \"null\" don't collide", () => {
    const occs = [
      occ("a.tsx", 1, { note: { tier: "written", value: null } }),
      occ("a.tsx", 2, { note: { tier: "written", value: "null" } }),
    ];
    const out = rollupOccurrencesToComponents(occs, [row()]);
    const values = out[0].props.note.values;
    expect(values).toHaveLength(2);
    expect(values).toEqual(
      expect.arrayContaining([
        { provenance: "written", value: null, count: 1 },
        { provenance: "written", value: "null", count: 1 },
      ]),
    );
  });

  it("passes a row's declared API through to the component", () => {
    const declared = { props: { variant: { required: false, default: "primary" } }, hasRest: true };
    const out = rollupOccurrencesToComponents([], [row({ declared })]);
    expect(out[0].declared).toEqual(declared);
  });

  it("omits declared when the row has none", () => {
    const out = rollupOccurrencesToComponents([], [row()]);
    expect(out[0].declared).toBeUndefined();
  });
});
