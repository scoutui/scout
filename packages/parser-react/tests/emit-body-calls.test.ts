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

describe("emitReact: bodyCalls emission", () => {
  it("emits a bodyCalls entry for a call in the body of an arrow-function component", () => {
    // The canonical pattern: helper called in body, JSX returned directly.
    const source = `
const useFoo = () => [{ x: <span/> }];
const Panel = () => {
  const opts = useFoo();
  return <ul>{opts}</ul>;
};
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    const entry = bodyCalls.find((bc) => bc.ownerSymbol === "Panel" && bc.callee.symbol === "useFoo");
    expect(entry).toBeDefined();
    expect(entry?.callee.symbol).toBe("useFoo");
    expect(entry?.callee.memberChain).toEqual([]);
  });

  it("a body call's callee carries the enclosing function's scope", () => {
    const source = `
function helper() { return <span/>; }
function Panel() {
  const helper = () => <i/>;
  helper();
  return <div/>;
}
`;
    const fg = emit(source);
    const local = [...(fg?.declarations.values() ?? [])].find((d) => d.symbol === "helper" && d.scope !== MODULE_SCOPE);
    const entry = (fg?.bodyCalls ?? []).find((bc) => bc.ownerSymbol === "Panel" && bc.callee.symbol === "helper");
    expect(local).toBeDefined();
    expect(entry?.callee.scope).toBe(local?.scope);
  });

  it("does not emit a bodyCalls entry for useFoo as an owner (its body has no direct calls)", () => {
    // useFoo's body is an array literal: no CallExpression with an Identifier callee at the top level.
    const source = `
const useFoo = () => [{ x: <span/> }];
const Panel = () => {
  const opts = useFoo();
  return <ul>{opts}</ul>;
};
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    const useFooEntry = bodyCalls.find((bc) => bc.ownerSymbol === "useFoo");
    expect(useFooEntry).toBeUndefined();
  });

  it("emits a bodyCalls entry for a call in a function declaration body", () => {
    const source = `
function getItems() { return [<li/>]; }
function List() {
  const items = getItems();
  return <ul>{items}</ul>;
}
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    const entry = bodyCalls.find((bc) => bc.ownerSymbol === "List" && bc.callee.symbol === "getItems");
    expect(entry).toBeDefined();
  });

  it("does not emit bodyCalls for calls inside nested arrow functions", () => {
    const source = `
function helper() { return [<li/>]; }
const Outer = () => {
  const handler = () => {
    const items = helper();
    return items;
  };
  return <div onClick={handler} />;
};
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    const entry = bodyCalls.find((bc) => bc.ownerSymbol === "Outer" && bc.callee.symbol === "helper");
    expect(entry).toBeUndefined();
  });

  it("does not emit bodyCalls for member-expression callees", () => {
    const source = `
const Panel = () => {
  const result = obj.method();
  return <div>{result}</div>;
};
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    const entry = bodyCalls.find((bc) => bc.ownerSymbol === "Panel" && bc.callee.symbol === "method");
    expect(entry).toBeUndefined();
  });

  it("emits bodyCalls for an export named function declaration body", () => {
    const source = `
function getData() { return { jsx: <span/> }; }
export function App() {
  const d = getData();
  return <div>{d.jsx}</div>;
}
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    const entry = bodyCalls.find((bc) => bc.ownerSymbol === "App" && bc.callee.symbol === "getData");
    expect(entry).toBeDefined();
  });

  it("emits bodyCalls for an anonymous default export function body", () => {
    const source = `
function useStuff() { return [<span/>]; }
export default function() {
  const s = useStuff();
  return <div>{s}</div>;
}
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    // ownerSymbol is "default" for anonymous default export
    const entry = bodyCalls.find((bc) => bc.ownerSymbol === "default" && bc.callee.symbol === "useStuff");
    expect(entry).toBeDefined();
  });

  it("emits bodyCalls for a HOC-wrapped component body (memo/forwardRef pattern)", () => {
    const source = `
function useItems() { return [<li/>]; }
const List = React.memo(() => {
  const items = useItems();
  return <ul>{items}</ul>;
});
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    const entry = bodyCalls.find((bc) => bc.ownerSymbol === "List" && bc.callee.symbol === "useItems");
    expect(entry).toBeDefined();
  });

  it("emits multiple bodyCalls entries when a body calls multiple helpers", () => {
    const source = `
function getA() { return [<li/>]; }
function getB() { return [<li/>]; }
const Panel = () => {
  const a = getA();
  const b = getB();
  return <ul>{a}{b}</ul>;
};
`;
    const fg = emit(source);
    const bodyCalls = fg?.bodyCalls ?? [];
    const entryA = bodyCalls.find((bc) => bc.ownerSymbol === "Panel" && bc.callee.symbol === "getA");
    const entryB = bodyCalls.find((bc) => bc.ownerSymbol === "Panel" && bc.callee.symbol === "getB");
    expect(entryA).toBeDefined();
    expect(entryB).toBeDefined();
  });
});

describe("emitReact: bodyCalls for anonymous default-export arrow", () => {
  it("emits bodyCalls with ownerSymbol `default` for `export default () => { ... }`", () => {
    const source = `
function useStuff() { return [<span/>]; }
export default () => {
  const s = useStuff();
  return <div>{s}</div>;
};
`;
    const fg = emit(source);
    const entry = (fg?.bodyCalls ?? []).find((bc) => bc.ownerSymbol === "default" && bc.callee.symbol === "useStuff");
    expect(entry).toBeDefined();
  });
});
