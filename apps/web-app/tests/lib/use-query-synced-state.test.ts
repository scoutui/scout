// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Reactive stand-in for Next's useSearchParams: Next intercepts
// history.replaceState and re-renders with the new params; the test simulates
// that by re-reading location.search on rerender.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { hrefFrom, parseSel, parseSort, serializeSel, serializeSort } from "@/lib/usage-url";
import { useQueryParamsState, useQuerySyncedState } from "@/lib/use-query-synced-state";

const parse = (q: string) => ({ text: q });
const serialize = (s: { text: string }) => s.text;

describe("useQuerySyncedState", () => {
  // jsdom's default origin is http://localhost:3000, and replaceState throws a
  // SecurityError on a cross-origin URL, so these must match that origin.
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos/x?scan=abc"));

  it("derives state from the live URL, not a snapshot", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/x?q=date+picker");
    const { result } = renderHook(() => useQuerySyncedState(parse, serialize));
    expect(result.current[0]).toEqual({ text: "date picker" });
  });

  it("writes changes to the URL via replaceState, preserving other params", () => {
    const { result, rerender } = renderHook(() => useQuerySyncedState(parse, serialize));
    act(() => result.current[1]({ text: "@acme/ui" }));
    expect(window.location.search).toBe("?scan=abc&q=@acme/ui");
    rerender(); // the Next-sync re-render
    expect(result.current[0]).toEqual({ text: "@acme/ui" });
  });

  it("clearing state removes q from the URL entirely", () => {
    const { result, rerender } = renderHook(() => useQuerySyncedState(parse, serialize));
    act(() => result.current[1]({ text: "kind:react" }));
    act(() => result.current[1]({ text: "" }));
    rerender();
    expect(window.location.search).toBe("?scan=abc");
    expect(result.current[0]).toEqual({ text: "" });
  });
});

const NAMES = ["tag", "deprecated"];
type Picked = { tags: string[]; deprecated: boolean };
const readPicked = (params: URLSearchParams): Picked => ({ tags: params.getAll("tag"), deprecated: params.get("deprecated") === "true" });
const writePicked = (p: Picked): [string, string][] => [
  ...p.tags.map((t): [string, string] => ["tag", t]),
  ...(p.deprecated ? [["deprecated", "true"] as [string, string]] : []),
];

describe("useQueryParamsState", () => {
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos/x?scan=abc"));

  it("reads every value of the params it owns", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/x?tag=icons&scan=abc&tag=acme-ui&deprecated=true");
    const { result } = renderHook(() => useQueryParamsState(NAMES, readPicked, writePicked));
    expect(result.current[0]).toEqual({ tags: ["icons", "acme-ui"], deprecated: true });
  });

  it("writes one param per value and keeps the params it doesn't own", () => {
    const { result, rerender } = renderHook(() => useQueryParamsState(NAMES, readPicked, writePicked));
    act(() => result.current[1]({ tags: ["icons", "acme-ui"], deprecated: true }));
    expect(window.location.search).toBe("?scan=abc&tag=icons&tag=acme-ui&deprecated=true");
    rerender();
    expect(result.current[0]).toEqual({ tags: ["icons", "acme-ui"], deprecated: true });
  });

  it("removes its params when the state is empty", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/x?scan=abc&tag=icons&deprecated=true");
    const { result } = renderHook(() => useQueryParamsState(NAMES, readPicked, writePicked));
    act(() => result.current[1]({ tags: [], deprecated: false }));
    expect(window.location.search).toBe("?scan=abc");
  });
});

describe("usage URL", () => {
  it.each([
    ["variant~value~ghost,variant~value~outline", [{ prop: "variant", kind: "value", label: "ghost" }, { prop: "variant", kind: "value", label: "outline" }]],
    ["size~unset~", [{ prop: "size", kind: "unset", label: "" }]],
    ["tone~ref~t", [{ prop: "tone", kind: "dynamic", label: "" }]],
    ["tone~dynamic~", [{ prop: "tone", kind: "dynamic", label: "" }]],
    ["gap~value~1%2C2", [{ prop: "gap", kind: "value", label: "1,2" }]],
    ["a~value~x,a~value~x", [{ prop: "a", kind: "value", label: "x" }]],
    ["nonsense", []],
  ])("reads sel %s", (raw, picks) => {
    expect(parseSel(raw)).toEqual(picks);
  });

  it("writes picks back to what it reads", () => {
    const picks = [{ prop: "gap", kind: "value" as const, label: "1,2 %" }, { prop: "size", kind: "unset" as const, label: "" }];
    expect(parseSel(serializeSel(picks))).toEqual(picks);
  });

  it.each([
    ["", { key: "uses", dir: "desc" }],
    ["file~asc", { key: "file", dir: "asc" }],
    ["prop:size~desc", { key: "prop:size", dir: "desc" }],
    ["uses~sideways", { key: "uses", dir: "desc" }],
  ])("reads sort %j", (raw, sort) => {
    expect(parseSort(raw)).toEqual(sort);
  });

  it.each([
    [{ key: "uses", dir: "desc" }, ""],
    [{ key: "uses", dir: "asc" }, "uses~asc"],
    [{ key: "prop:size", dir: "asc" }, "prop:size~asc"],
  ] as const)("writes sort %j as %j", (sort, raw) => {
    expect(serializeSort(sort)).toBe(raw);
  });

  it("builds a link to the same page with params set and removed, keeping the rest", () => {
    expect(hrefFrom("/repos/shop/components/abc", "?scan=s1&sel=a~value~x&find=q", { tab: "composition", pin: "up:p1", find: null }))
      .toBe("/repos/shop/components/abc?scan=s1&sel=a~value~x&tab=composition&pin=up:p1");
  });
});
