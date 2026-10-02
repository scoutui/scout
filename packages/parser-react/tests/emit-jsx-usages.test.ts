import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import { createGraphBuilder } from "@scoutui/reference-graph";
import { emitReact } from "../src/emit.js";

function emit(source: string) {
  const gb = createGraphBuilder({ moduleResolver: () => null });
  const fb = gb.beginFile("src/App.tsx");
  emitReact({ file: "src/App.tsx", source, ast: parseSync("test.tsx", source).program, fileBuilder: fb });
  return gb.build().files.get("src/App.tsx");
}

describe("emitReact: JSX usage emission", () => {
  it("emits JsxUsage for `<Foo />`", () => {
    const fg = emit("function App() { return <Foo />; }");
    const usages = fg?.jsxUsages ?? [];
    const foo = usages.find((u) => u.ref.symbol === "Foo");
    expect(foo).toBeDefined();
  });

  it("emits JsxUsage with memberChain for `<Foo.Bar.Baz />`", () => {
    const fg = emit("function App() { return <Foo.Bar.Baz />; }");
    const usages = fg?.jsxUsages ?? [];
    const usage = usages.find((u) => u.ref.symbol === "Foo");
    expect(usage?.ref.memberChain).toEqual(["Bar", "Baz"]);
  });

  it("wires ownership: <Foo /> inside function App() → owner ref points to App", () => {
    const fg = emit("function App() { return <Foo />; }");
    const usages = fg?.jsxUsages ?? [];
    const fooIdx = usages.findIndex((u) => u.ref.symbol === "Foo");
    expect(fooIdx).toBeGreaterThanOrEqual(0);
    const ownership = fg?.ownership ?? [];
    const ownerEntry = ownership.find((o) => o.usageIdx === fooIdx);
    expect(ownerEntry?.ownerSymbolRef?.symbol).toBe("App");
  });

  it("emits JsxUsage with null owner for top-level JSX when binding is never read", () => {
    const fg = emit("const X = <Foo />;");
    const usages = fg?.jsxUsages ?? [];
    expect(usages).toHaveLength(1);
    const ownership = fg?.ownership ?? [];
    expect(ownership[0]?.ownerSymbolRef).toBeNull();
    // No viaOverride because there are no read sites.
    expect(ownership[0]?.viaOverride).toBeUndefined();
  });

  it("emits JsxUsage with owner=function when const = <Foo/> is read in a function body", () => {
    const fg = emit("const X = <Foo />; function App() { return <div>{X}</div>; }");
    const usages = fg?.jsxUsages ?? [];
    const fooUsage = usages.find((u) => u.ref.symbol === "Foo");
    expect(fooUsage).toBeDefined();
    const fooIdx = fooUsage ? usages.indexOf(fooUsage) : -1;
    const ownership = fg?.ownership ?? [];
    expect(ownership[fooIdx]?.ownerSymbolRef?.symbol).toBe("App");
    expect(ownership[fooIdx]?.viaOverride?.kind).toBe("prop-forward");
  });

  it("emits the usages inside a module-scope fragment", () => {
    const fg = emit("const X = <><Foo /></>; function App() { return <div>{X}</div>; }");
    expect(fg?.jsxUsages.map((u) => u.ref.symbol)).toEqual(["Foo", "div"]);
  });
});

describe("emitReact: prop emission", () => {
  it("emits empty props for `<Foo />`", () => {
    const fg = emit("function App() { return <Foo />; }");
    const usage = fg?.jsxUsages.find((u) => u.ref.symbol === "Foo");
    expect(usage?.props).toEqual([]);
  });

  it("emits a written prop for `<Foo bar=\"x\" />`", () => {
    const fg = emit('function App() { return <Foo bar="x" />; }');
    const usage = fg?.jsxUsages.find((u) => u.ref.symbol === "Foo");
    expect(usage?.props).toEqual([
      { name: "bar", tier: "written", value: "x" },
    ]);
  });

  it("emits reference prop for `<Foo bar={x} />`", () => {
    const fg = emit("function App() { return <Foo bar={x} />; }");
    const usage = fg?.jsxUsages.find((u) => u.ref.symbol === "Foo");
    expect(usage?.props).toEqual([{ name: "bar", tier: "reference", ref: "x" }]);
  });

  it("emits spread prop for `<Foo {...rest} />`", () => {
    const fg = emit("function App() { return <Foo {...rest} />; }");
    const usage = fg?.jsxUsages.find((u) => u.ref.symbol === "Foo");
    expect(usage?.props).toEqual([{ name: "...rest", tier: "dynamic" }]);
  });

  it("event handlers (onClick) are captured as dynamic props; other props still captured", () => {
    const fg = emit("function App() { return <Foo onClick={x} bar={y} />; }");
    const usage = fg?.jsxUsages.find((u) => u.ref.symbol === "Foo");
    expect(usage?.props).toEqual([
      { name: "onClick", tier: "dynamic" },
      { name: "bar", tier: "reference", ref: "y" },
    ]);
  });
});
