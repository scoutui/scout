import { describe, expect, it } from "vitest";
import type { Credit, TraceStep } from "@scoutui/scan-format";
import { unseenBy } from "../src/index.js";

const RENDER: Credit = { kind: "render" };
const IMPORT: TraceStep = { kind: "import", specifier: "./card", name: "Card" };

describe("unseenBy: what can pass a use props it doesn't write", () => {
  it.each([
    ["a use that writes its props", ["size", "tone"], RENDER, [IMPORT], null],
    ["a use through a lazy loader", [], RENDER, [{ kind: "lazy", callee: "lazy" }], null],
    ["a spread", ["size", "...rest"], RENDER, [IMPORT], { kind: "spread" }],
    ["a call the component is passed to", [], { kind: "argument", callee: "useModal", index: 0 }, [], { kind: "via", callee: "useModal" }],
    ["a wrapper that may add props", [], RENDER, [{ kind: "hoc", callee: "withTheme", mayAddProps: true }], { kind: "via", callee: "withTheme" }],
    ["a wrapper with no mark", [], RENDER, [{ kind: "hoc", callee: "memo" }], { kind: "via", callee: "memo" }],
    ["a spread through a wrapper, read as the spread", ["...rest"], RENDER, [{ kind: "hoc", callee: "withTheme" }], { kind: "spread" }],
  ] as const)("reads %s", (_case, propNames, credit, trace, expected) => {
    expect(unseenBy({ propNames, credit, trace })).toEqual(expected);
  });
});
