import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import { createGraphBuilder, MODULE_SCOPE } from "@scoutui/reference-graph";
import { emitReact } from "../src/emit.js";

function emit(source: string) {
  const gb = createGraphBuilder({ moduleResolver: () => null });
  const fb = gb.beginFile("src/App.tsx");
  emitReact({ file: "src/App.tsx", source, ast: parseSync("test.tsx", source).program, fileBuilder: fb });
  return gb.build().files.get("src/App.tsx");
}

describe("emitReact: export emission", () => {
  it("emits ExportRecord for `export const Foo = ...`", () => {
    const fg = emit("export const Foo = () => null;");
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "named", exportedAs: "Foo", local: "Foo" }));
    // Also marks the declaration as exported
    expect(fg?.declarations.get(`${MODULE_SCOPE}::Foo`)?.isExported).toBe(true);
  });

  it("emits ExportRecord for `export function Foo() {...}`", () => {
    const fg = emit("export function Foo() { return null; }");
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "named", exportedAs: "Foo", local: "Foo" }));
  });

  it("emits ExportRecord for `export default Foo`", () => {
    const fg = emit("const Foo = () => null;\nexport default Foo;");
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "default", local: "Foo" }));
  });

  it("emits ExportRecord for `export { Foo }`", () => {
    const fg = emit("const Foo = () => null;\nexport { Foo };");
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "named", exportedAs: "Foo", local: "Foo" }));
  });

  it("emits ExportRecord for `export { Foo as Bar }`", () => {
    const fg = emit("const Foo = () => null;\nexport { Foo as Bar };");
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "named", exportedAs: "Bar", local: "Foo" }));
  });

  it("emits ExportRecord for `export { Foo as Bar } from \"./x\"`", () => {
    const fg = emit(`export { Foo as Bar } from "./x";`);
    expect(fg?.exports).toContainEqual(expect.objectContaining({
      kind: "named", exportedAs: "Bar", from: "./x", fromImported: "Foo",
    }));
  });

  it("emits ExportRecord for `export * from \"./x\"`", () => {
    const fg = emit(`export * from "./x";`);
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "star", from: "./x" }));
  });

  it("emits `default` decl + export for `export default hoc(Inner)`", () => {
    const fg = emit(
      `import { withFallback } from "./hoc";\nimport { PageLayout } from "./page-layout";\nexport default withFallback(PageLayout);`,
    );
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "default", local: "default" }));
    const defaultDecl = fg?.declarations.get(`${MODULE_SCOPE}::default`);
    expect(defaultDecl?.isExported).toBe(true);
    // Value carries the HOC's ReturnTypeOf shape so wrapper-folding can collapse
    // to the inner-arg identity (PageLayout).
    expect(defaultDecl?.value.kind).toBe("ReturnTypeOf");
    if (defaultDecl?.value.kind === "ReturnTypeOf") {
      expect(defaultDecl.value.callee.kind).toBe("TypeOf");
      expect(defaultDecl.value.args).toHaveLength(1);
      expect(defaultDecl.value.args[0]?.kind).toBe("TypeOf");
    }
  });

  it("does not emit a star ExportRecord for namespace `export * as Foo from './a'`", () => {
    const fg = emit("export * as Foo from './a';");
    expect(fg?.exports.find((e) => e.kind === "star")).toBeUndefined();
  });

  it("does not emit a star ExportRecord for type-only `export type * from './a'`", () => {
    const fg = emit("export type * from './a';");
    expect(fg?.exports.find((e) => e.kind === "star")).toBeUndefined();
  });

  it("walks JSX inside anonymous inner arg of `export default hoc(() => <Foo />)`", () => {
    const fg = emit(
      `import { withFallback } from "./hoc";\nimport { Foo } from "./foo";\nexport default withFallback(() => <Foo />);`,
    );
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "default", local: "default" }));
    // JSX usage of <Foo /> attributed to the synthetic "default" owner.
    const fooIdx = fg?.jsxUsages.findIndex((u) => u.ref.symbol === "Foo") ?? -1;
    expect(fooIdx).toBeGreaterThanOrEqual(0);
    const ownership = fg?.ownership.find((o) => o.usageIdx === fooIdx);
    expect(ownership?.ownerSymbolRef?.symbol).toBe("default");
  });
});

describe("emitReact: exports the graph does not record", () => {
  it.each([
    ["an anonymous default object", "export default { Item };"],
    ["an anonymous default class", "export default class {}"],
    ["a namespace re-export", 'export * as Icons from "./icons";'],
    ["a destructured export", "export const { Item } = parts;"],
    ["an exported enum", "export enum Size { Small }"],
    ["an export assignment", "export = Menu;"],
    ["a CommonJS module.exports", "module.exports = { Item };"],
    ["a CommonJS module.exports member", "module.exports.Item = Item;"],
    ["a CommonJS exports member", "exports.Item = Item;"],
  ])("marks %s as unrecorded", (_label, source) => {
    expect(emit(source)?.unrecordedExports).toBe(true);
  });

  it("leaves a file whose exports are all recorded unmarked", () => {
    const fg = emit(
      [
        "export const A = () => null;",
        "export function B() { return null; }",
        'export { C } from "./c";',
        'export * from "./d";',
        'export type * from "./e";',
        "export type T = string;",
        "export interface I {}",
        "export default function () { return null; }",
        "cache.exports = {};",
      ].join("\n"),
    );
    expect(fg?.unrecordedExports).toBeUndefined();
  });
});

describe("emitReact: anonymous default-export arrow", () => {
  it("`export default () => <Foo />` emits a `default` declaration, export and JSX owned by `default`", () => {
    const fg = emit(`import { Foo } from "./foo";\nexport default () => <Foo />;`);
    expect(fg?.exports).toContainEqual(expect.objectContaining({ kind: "default", local: "default" }));
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::default`);
    expect(decl?.isExported).toBe(true);
    expect(decl?.value.kind).toBe("Function");
    const fooIdx = fg?.jsxUsages.findIndex((u) => u.ref.symbol === "Foo") ?? -1;
    expect(fooIdx).toBeGreaterThanOrEqual(0);
    expect(fg?.ownership.find((o) => o.usageIdx === fooIdx)?.ownerSymbolRef?.symbol).toBe("default");
  });

  it("`export default () => { return <Foo />; }` (block body) attributes JSX to `default`", () => {
    const fg = emit(`import { Foo } from "./foo";\nexport default () => {\n  return <Foo />;\n};`);
    const fooIdx = fg?.jsxUsages.findIndex((u) => u.ref.symbol === "Foo") ?? -1;
    expect(fooIdx).toBeGreaterThanOrEqual(0);
    expect(fg?.ownership.find((o) => o.usageIdx === fooIdx)?.ownerSymbolRef?.symbol).toBe("default");
  });
});
