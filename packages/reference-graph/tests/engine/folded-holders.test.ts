import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type InferredType, type Reference } from "../../src/index.js";
import { resolve } from "../../src/engine/index.js";

const JSX: InferredType = { kind: "JSX" };
const fn = (...returns: InferredType[]): InferredType => ({ kind: "Function", returns });
const at = (line: number) => ({ line, column: 1 });
const ref = (symbol: string, file: string): Reference => ({ symbol, scope: MODULE_SCOPE, memberChain: [], loc: at(1), originFile: file });
const typeOf = (symbol: string, file: string): InferredType => ({ kind: "TypeOf", ref: ref(symbol, file) });

describe("folded holders are not registry members", () => {
  it("`export default forwardRef(Composer)` keeps one member, Composer, which inherits isDefault; the render lands on Composer", () => {
    const repoRoot = "/repo";
    const resolver = (from: string, spec: string) => (spec === "./Composer" && from === "/repo/src/App.tsx" ? "/repo/src/Composer.tsx" : null);
    const gb = createGraphBuilder({ moduleResolver: resolver, repoRoot });

    const c = gb.beginFile("src/Composer.tsx");
    c.addImport({ specifier: "react", imported: "forwardRef", local: "forwardRef", scope: MODULE_SCOPE, loc: at(1) });
    c.addDeclaration({ symbol: "Composer", value: fn(JSX), loc: at(2), isExported: false });
    c.addDeclaration({
      symbol: "default",
      value: { kind: "ReturnTypeOf", callee: typeOf("forwardRef", "src/Composer.tsx"), args: [typeOf("Composer", "src/Composer.tsx")] },
      loc: at(3),
      isExported: true,
    });
    c.addExport({ kind: "default", local: "default" });
    c.addHeldRef({ symbol: "Composer", memberChain: [], loc: at(3), originFile: "src/Composer.tsx" });

    const app = gb.beginFile("src/App.tsx");
    app.addImport({ specifier: "./Composer", imported: "default", local: "Composer", scope: MODULE_SCOPE, loc: at(1) });
    app.addDeclaration({ symbol: "App", value: fn(JSX), loc: at(2), isExported: true });
    app.addExport({ kind: "named", exportedAs: "App", local: "App" });
    app.addJsxUsage({ ref: { symbol: "Composer", scope: MODULE_SCOPE, memberChain: [], loc: at(3) }, loc: at(3), props: [] });

    const { occurrences, registry } = resolve(gb.build());

    expect(registry.localEntries().map((e) => `${e.filePath}::${e.symbol}${e.isDefault ? "!" : ""}`).sort()).toEqual([
      "src/App.tsx::App",
      "src/Composer.tsx::Composer!",
    ]);
    expect(registry.hasLocal("src/Composer.tsx", "default")).toBe(false);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toMatchObject({ export: "Composer", source: { type: "local", filePath: "src/Composer.tsx" } });
    expect(occurrences[0]?.viaChain.some((v) => v.kind === "hoc-wrapper")).toBe(true);
  });

  it("a holder whose fold has an identity-less terminal stays a member: `memo((p) => <b/>)`", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/a.tsx");
    fb.addImport({ specifier: "react", imported: "memo", local: "memo", scope: MODULE_SCOPE, loc: at(1) });
    fb.addDeclaration({
      symbol: "Inline",
      value: { kind: "ReturnTypeOf", callee: typeOf("memo", "src/a.tsx"), args: [fn(JSX)] },
      loc: at(2),
      isExported: true,
    });
    fb.addExport({ kind: "named", exportedAs: "Inline", local: "Inline" });
    const { registry } = resolve(gb.build());
    expect(registry.localEntries().map((e) => e.symbol)).toEqual(["Inline"]);
  });

  it("a default holder whose fold fans out to two same-file components is excluded and neither inherits isDefault (target: null)", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/a.tsx");
    fb.addImport({ specifier: "react", imported: "memo", local: "memo", scope: MODULE_SCOPE, loc: at(1) });
    fb.addDeclaration({ symbol: "A", value: fn(JSX), loc: at(2), isExported: true });
    fb.addExport({ kind: "named", exportedAs: "A", local: "A" });
    fb.addDeclaration({ symbol: "B", value: fn(JSX), loc: at(3), isExported: true });
    fb.addExport({ kind: "named", exportedAs: "B", local: "B" });
    fb.addDeclaration({
      symbol: "default",
      value: {
        kind: "ReturnTypeOf",
        callee: typeOf("memo", "src/a.tsx"),
        args: [{ kind: "Union", types: [typeOf("A", "src/a.tsx"), typeOf("B", "src/a.tsx")] }],
      },
      loc: at(4),
      isExported: true,
    });
    fb.addExport({ kind: "default", local: "default" });
    const { registry } = resolve(gb.build());
    expect(registry.localEntries().map((e) => `${e.symbol}${e.isDefault ? "!" : ""}`).sort()).toEqual(["A", "B"]);
    expect(registry.hasLocal("src/a.tsx", "default")).toBe(false);
  });
});
