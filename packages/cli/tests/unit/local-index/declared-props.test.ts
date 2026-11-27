import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import type { ObjectPattern, TSTypeLiteral, ObjectExpression } from "@oxc-project/types";
import {
  readLiteralValue,
  objectPatternToDeclared,
  typeLiteralToDeclared,
  objectRuntimeToDeclared,
} from "../../../src/local-index/declared-props.js";

/** Parse `const <code> = x;` and return the destructure pattern. */
function pattern(code: string): ObjectPattern {
  const { program } = parseSync("t.ts", `const ${code} = x;`);
  const decl = program.body[0] as { declarations: { id: ObjectPattern }[] };
  return decl.declarations[0].id;
}

/** Parse `type T = <code>;` return-typed and grab the TSTypeLiteral. */
function typeLiteral(code: string): { lit: TSTypeLiteral; source: string } {
  const source = `type T = ${code};`;
  const { program } = parseSync("t.ts", source);
  const alias = program.body[0] as { typeAnnotation: TSTypeLiteral };
  return { lit: alias.typeAnnotation, source };
}

/** Parse `const o = <code>;` and grab the ObjectExpression. */
function objectExpr(code: string): ObjectExpression {
  const { program } = parseSync("t.ts", `const o = ${code};`);
  const decl = program.body[0] as { declarations: { init: ObjectExpression }[] };
  return decl.declarations[0].init;
}

describe("declared-props: readLiteralValue", () => {
  it("reads string / number / boolean / null literals, rejects others", () => {
    const val = (c: string) => {
      const { program } = parseSync("t.ts", `const x = ${c};`);
      const d = program.body[0] as { declarations: { init: unknown }[] };
      return readLiteralValue(d.declarations[0].init as never);
    };
    expect(val(`"hi"`)).toBe("hi");
    expect(val("42")).toBe(42);
    expect(val("true")).toBe(true);
    expect(val("null")).toBe(null);
    expect(val("someFn()")).toBeUndefined();
    expect(val("-1")).toBeUndefined(); // unary, not a Literal: out of scope
  });
});

describe("declared-props: objectPatternToDeclared", () => {
  it("records a non-literal default as hasDefault, without its value", () => {
    const out = objectPatternToDeclared(pattern("{ items = makeItems() }"));
    expect(out.props.items).toEqual({ required: false, hasDefault: true });
    expect(out.hasRest).toBe(false);
  });
});

describe("declared-props: typeLiteralToDeclared", () => {
  it("captures required from `?`, type as verbatim source text", () => {
    const { lit, source } = typeLiteral("{ variant?: 'sm' | 'lg'; size: number }");
    const out = typeLiteralToDeclared(lit, source);
    expect(out).toEqual({
      props: {
        variant: { required: false, type: "'sm' | 'lg'", hasDefault: false },
        size: { required: true, type: "number", hasDefault: false },
      },
      hasRest: false,
    });
  });

  it("maps an index signature to hasRest", () => {
    const { lit, source } = typeLiteral("{ id: string; [k: string]: unknown }");
    const out = typeLiteralToDeclared(lit, source);
    expect(out.props.id).toEqual({ required: true, type: "string", hasDefault: false });
    expect(out.hasRest).toBe(true);
  });
});

describe("declared-props: objectRuntimeToDeclared", () => {
  it("reads descriptor type / required / default and shorthand constructor", () => {
    const out = objectRuntimeToDeclared(
      objectExpr("{ variant: { type: String, default: 'primary', required: true }, size: Number }"),
    );
    expect(out).toEqual({
      props: {
        variant: { type: "String", required: true, default: "primary" },
        size: { type: "Number", hasDefault: false },
      },
      hasRest: false,
    });
  });

  it.each([
    ["a descriptor without a default", "{ type: String }", { type: "String", hasDefault: false }],
    ["a factory default", "{ type: Array, default: () => [] }", { type: "Array", hasDefault: true }],
    ["a default that names a binding", "{ type: String, default: sizes.md }", { type: "String", hasDefault: true, defaultRef: "sizes.md" }],
    ["an undefined default", "{ type: String, default: undefined }", { type: "String", hasDefault: false }],
    ["a spread without a later default", "{ ...shared, type: String }", { type: "String" }],
    ["a spread after a default", "{ default: 'md', ...shared }", { hasDefault: true }],
    ["a default after a spread", "{ ...shared, default: 'md' }", { default: "md" }],
    ["a built-in constructor shorthand", "Boolean", { type: "Boolean", hasDefault: false }],
    ["a type list", "[String, Number]", { hasDefault: false }],
    ["a shorthand Scout can't tell from a shared descriptor", "sizeProp", { type: "sizeProp" }],
    ["a call", "makeProp()", {}],
  ])("reads the default state of %s", (_case, value, expected) => {
    expect(objectRuntimeToDeclared(objectExpr(`{ size: ${value} }`)).props.size).toEqual(expected);
  });
});
