import { describe, expect, it } from "vitest";
import { canonicalValueSet } from "../src/value-set.js";

describe("canonicalValueSet", () => {
  it.each<[string, (string | number | boolean)[], (string | number | boolean)[]]>([
    ["sorts by text", ["small", "medium"], ["medium", "small"]],
    ["compares with localeCompare, so a comes before B", ["B", "a"], ["a", "B"]],
    ["sorts numbers by their text and keeps them numbers", [9, 12], [12, 9]],
    ["keeps each value once", ["small", "medium", "small"], ["medium", "small"]],
  ])("%s", (_title, values, expected) => {
    expect(canonicalValueSet(values)).toEqual(expected);
  });
});
