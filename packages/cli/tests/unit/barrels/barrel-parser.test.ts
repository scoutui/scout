import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import {
  parseBarrelTopLevel,
  parseBarrelTopLevelFromAst,
  type BarrelReExport,
} from "../../../src/barrels/barrel-parser.js";

describe("parseBarrelTopLevel", () => {
  it("extracts export *", () => {
    const result = parseBarrelTopLevel(`export * from "@example/pkg-a";`);
    expect(result).toEqual<BarrelReExport[]>([
      { kind: "star", from: "@example/pkg-a" },
    ]);
  });

  it("extracts named exports with source", () => {
    const result = parseBarrelTopLevel(`export { Foo, Bar as Baz } from "@example/pkg-b";`);
    expect(result).toEqual<BarrelReExport[]>([
      {
        kind: "named",
        from: "@example/pkg-b",
        names: [
          { local: "Foo", exported: "Foo" },
          { local: "Bar", exported: "Baz" },
        ],
      },
    ]);
  });

  it("records the file's own value exports and ignores side-effect imports", () => {
    const src = `
      import "./side-effect.js";
      export const X = 1;
      export const { A } = obj;
      export function F() {}
      export class K {}
      export enum E { One }
      function Y() {}
      export { Y };
      export default Y;
      export interface I {}
      export { type Y as Z };
      export * from "@example/with-source";
    `;
    const result = parseBarrelTopLevel(src);
    expect(result).toEqual<BarrelReExport[]>([
      { kind: "own", exported: "X" },
      { kind: "own", exported: "A" },
      { kind: "own", exported: "F" },
      { kind: "own", exported: "K" },
      { kind: "own", exported: "E" },
      { kind: "own", exported: "Y" },
      { kind: "own", exported: "default" },
      { kind: "star", from: "@example/with-source" },
    ]);
  });

  it("extracts `export { default as Name } from`", () => {
    const result = parseBarrelTopLevel(`export { default as Foo } from "@example/leaf";`);
    expect(result).toEqual<BarrelReExport[]>([
      {
        kind: "named",
        from: "@example/leaf",
        names: [{ local: "default", exported: "Foo" }],
      },
    ]);
  });

  it("ignores type-only re-exports", () => {
    const src = `export type { Foo } from "@example/types";\nexport type * from "@example/types-star";`;
    const result = parseBarrelTopLevel(src);
    expect(result).toEqual([]);
  });

  it("strips per-specifier type-only re-exports while keeping value re-exports", () => {
    const src = `export { type Foo, Bar } from "@example/mixed";`;
    const result = parseBarrelTopLevel(src);
    expect(result).toEqual<BarrelReExport[]>([
      {
        kind: "named",
        from: "@example/mixed",
        names: [{ local: "Bar", exported: "Bar" }],
      },
    ]);
  });

  it("returns empty on parse failure", () => {
    const result = parseBarrelTopLevel("this is not valid JS )))");
    expect(result).toEqual([]);
  });

  it("reads `export * as ns from` as the one name it exports", () => {
    const result = parseBarrelTopLevel(`export * as NS from "@example/ns-pkg";`);
    expect(result).toEqual<BarrelReExport[]>([
      { kind: "namespace", from: "@example/ns-pkg", exported: "NS" },
    ]);
  });
});

describe("unsupported barrel forms are terminal", () => {
  it("still extracts ESM re-exports alongside a CJS reassignment", () => {
    const result = parseBarrelTopLevel(`
      export * from "@example/esm-part";
      module.exports = require("./cjs-part");
    `);
    expect(result).toEqual([{ kind: "star", from: "@example/esm-part" }]);
  });

  it("yields no re-exports for a pure CJS reassignment barrel", () => {
    expect(parseBarrelTopLevel(`module.exports = require("./impl");`)).toEqual([]);
  });

  it("yields no re-exports for try/catch-wrapped CJS re-exports", () => {
    const result = parseBarrelTopLevel(`
      try { module.exports = require("./modern"); }
      catch { module.exports = require("./legacy"); }
    `);
    expect(result).toEqual([]);
  });

  it("yields no re-exports for if-wrapped CJS re-exports", () => {
    const result = parseBarrelTopLevel(`
      if (process.env.NODE_ENV === "production") { module.exports = require("./prod"); }
      else { module.exports = require("./dev"); }
    `);
    expect(result).toEqual([]);
  });
});

describe("parseBarrelTopLevelFromAst", () => {
  it("extracts the re-exports of a pre-parsed mixed barrel", () => {
    const src = `export * from "@example/a"; export { B } from "@example/b";`;
    const ast = parse(src, { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: true });
    expect(parseBarrelTopLevelFromAst(ast)).toEqual<BarrelReExport[]>([
      { kind: "star", from: "@example/a" },
      { kind: "named", from: "@example/b", names: [{ local: "B", exported: "B" }] },
    ]);
  });
});
