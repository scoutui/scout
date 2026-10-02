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
  it("records required:false for a non-literal default but omits the value", () => {
    const out = objectPatternToDeclared(pattern("{ items = makeItems() }"));
    expect(out.props.items).toEqual({ required: false });
    expect(out.hasRest).toBe(false);
  });
});

describe("declared-props: typeLiteralToDeclared", () => {
  it("captures required from `?`, type as verbatim source text", () => {
    const { lit, source } = typeLiteral("{ variant?: 'sm' | 'lg'; size: number }");
    const out = typeLiteralToDeclared(lit, source);
    expect(out).toEqual({
      props: {
        variant: { required: false, type: "'sm' | 'lg'" },
        size: { required: true, type: "number" },
      },
      hasRest: false,
    });
  });

  it("maps an index signature to hasRest", () => {
    const { lit, source } = typeLiteral("{ id: string; [k: string]: unknown }");
    const out = typeLiteralToDeclared(lit, source);
    expect(out.props.id).toEqual({ required: true, type: "string" });
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
        size: { type: "Number" },
      },
      hasRest: false,
    });
  });
});
