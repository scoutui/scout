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
import { useQuerySyncedState } from "@/lib/use-query-synced-state";

const parse = (q: string) => ({ text: q });
const serialize = (s: { text: string }) => s.text;

describe("useQuerySyncedState", () => {
  // jsdom's default origin is http://localhost:3000, and replaceState throws a
  // SecurityError on a cross-origin URL, so these must match that origin.
  beforeEach(() => window.history.replaceState(null, "", "http://localhost:3000/repos/x?scan=abc"));

  it("derives state from the live URL, not a snapshot", () => {
    window.history.replaceState(null, "", "http://localhost:3000/repos/x?q=deprecated%3Atrue");
    const { result } = renderHook(() => useQuerySyncedState(parse, serialize));
    expect(result.current[0]).toEqual({ text: "deprecated:true" });
  });

  it("writes changes to the URL via replaceState, preserving other params", () => {
    const { result, rerender } = renderHook(() => useQuerySyncedState(parse, serialize));
    act(() => result.current[1]({ text: "kind:react" }));
    expect(window.location.search).toBe("?scan=abc&q=kind%3Areact");
    rerender(); // the Next-sync re-render
    expect(result.current[0]).toEqual({ text: "kind:react" });
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
    ["", { key: "calls", dir: "desc" }],
    ["file~asc", { key: "file", dir: "asc" }],
    ["prop:size~desc", { key: "prop:size", dir: "desc" }],
    ["calls~sideways", { key: "calls", dir: "desc" }],
  ])("reads sort %j", (raw, sort) => {
    expect(parseSort(raw)).toEqual(sort);
  });

  it.each([
    [{ key: "calls", dir: "desc" }, ""],
    [{ key: "calls", dir: "asc" }, "calls~asc"],
    [{ key: "prop:size", dir: "asc" }, "prop:size~asc"],
  ] as const)("writes sort %j as %j", (sort, raw) => {
    expect(serializeSort(sort)).toBe(raw);
  });

  it("builds a link to the same page with params set and removed, keeping the rest", () => {
    expect(hrefFrom("/repos/shop/components/abc", "?scan=s1&sel=a~value~x&find=q", { tab: "composition", pin: "up:p1", find: null }))
      .toBe("/repos/shop/components/abc?scan=s1&sel=a%7Evalue%7Ex&tab=composition&pin=up%3Ap1");
  });
});
