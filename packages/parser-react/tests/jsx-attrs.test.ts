import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import { readJsxAttrs } from "../src/jsx-attrs.js";
import type { JSXOpeningElement } from "oxc-parser";

function extractOpening(source: string): JSXOpeningElement {
  const ast = parseSync("test.tsx", source).program;
  let opening: JSXOpeningElement | null = null;
  function walk(node: unknown): void {
    if (node === null || typeof node !== "object") return;
    const n = node as { type?: string };
    if (n.type === "JSXOpeningElement") {
      opening = node as JSXOpeningElement;
      return;
    }
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) val.forEach(walk);
      else if (val !== null && typeof val === "object") walk(val);
    }
  }
  walk(ast);
  if (!opening) throw new Error("no JSXOpeningElement found");
  return opening;
}

describe("readJsxAttrs", () => {
  it("spread → dynamic ...rest, deduped", () => {
    const o = extractOpening("const x = <Foo {...a} {...b} />;");
    expect(readJsxAttrs(o)).toEqual([{ name: "...rest", tier: "dynamic" }]);
  });
  it("boolean shorthand → written true", () => {
    expect(readJsxAttrs(extractOpening("const x = <Foo bar />;"))).toEqual([
      { name: "bar", tier: "written", value: true },
    ]);
  });
  it("string / number / boolean literals → written", () => {
    expect(readJsxAttrs(extractOpening('const x = <Foo a="s" b={2} c={true} />;'))).toEqual([
      { name: "a", tier: "written", value: "s" },
      { name: "b", tier: "written", value: 2 },
      { name: "c", tier: "written", value: true },
    ]);
  });
  it("literal null → written null (not dynamic)", () => {
    expect(readJsxAttrs(extractOpening("const x = <Foo a={null} />;"))).toEqual([
      { name: "a", tier: "written", value: null },
    ]);
  });
  it("identifier → reference", () => {
    expect(readJsxAttrs(extractOpening("const x = <Foo size={small} />;"))).toEqual([
      { name: "size", tier: "reference", ref: "small" },
    ]);
  });
  it("static member path → reference", () => {
    expect(readJsxAttrs(extractOpening("const x = <Foo size={props.size} />;"))).toEqual([
      { name: "size", tier: "reference", ref: "props.size" },
    ]);
  });
  it("ternary of literals → written valueSet", () => {
    expect(readJsxAttrs(extractOpening('const x = <Foo v={err ? "a" : "b"} />;'))).toEqual([
      { name: "v", tier: "written", valueSet: ["a", "b"] },
    ]);
  });
  it("call / object / computed member → dynamic", () => {
    expect(readJsxAttrs(extractOpening("const x = <Foo a={f()} b={{}} c={o[k]} />;"))).toEqual([
      { name: "a", tier: "dynamic" },
      { name: "b", tier: "dynamic" },
      { name: "c", tier: "dynamic" },
    ]);
  });
});
