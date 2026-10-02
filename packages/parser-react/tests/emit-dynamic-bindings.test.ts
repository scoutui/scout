import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import type { InferredType } from "@scoutui/reference-graph";
import { createGraphBuilder } from "@scoutui/reference-graph";
import { emitReact, extractBindingsFromPattern } from "../src/emit.js";

const SRC_UNKNOWN: InferredType = { kind: "Unknown" };

function patternFromParam(src: string) {
  // `src` is `function f(<pattern>) {}`; returns its first param node.
  const ast = parseSync("test.tsx", src).program;
  const fn = ast.body[0] as unknown as { params: unknown[] };
  return { node: fn.params[0] as never, sourceText: src };
}

describe("extractBindingsFromPattern", () => {
  it("Identifier param: yields { symbol, value=source }", () => {
    const { node, sourceText } = patternFromParam("function f(x) {}");
    const leaves = extractBindingsFromPattern(node, SRC_UNKNOWN, sourceText);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].symbol).toBe("x");
    expect(leaves[0].value).toEqual({ kind: "Unknown" });
    expect(leaves[0].loc.line).toBeGreaterThan(0);
  });

  it("ObjectPattern shorthand: { Component, pageProps } → two leaves with MemberOf(source, key)", () => {
    const { node, sourceText } = patternFromParam("function f({ Component, pageProps }) {}");
    const leaves = extractBindingsFromPattern(node, SRC_UNKNOWN, sourceText);
    expect(leaves.map((l) => l.symbol).sort()).toEqual(["Component", "pageProps"]);
    const component = leaves.find((l) => l.symbol === "Component");
    if (!component) throw new Error("expected Component leaf");
    expect(component.value).toEqual({ kind: "MemberOf", obj: { kind: "Unknown" }, member: "Component" });
  });

  it("ObjectPattern keyed: { X: y } → leaf y with MemberOf(source, 'X')", () => {
    const { node, sourceText } = patternFromParam("function f({ X: y }) {}");
    const leaves = extractBindingsFromPattern(node, SRC_UNKNOWN, sourceText);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].symbol).toBe("y");
    expect(leaves[0].value).toEqual({ kind: "MemberOf", obj: { kind: "Unknown" }, member: "X" });
  });

  it("ArrayPattern: [Tab, Counter] → two leaves with MemberOf(source, '0'|'1')", () => {
    const { node, sourceText } = patternFromParam("function f([Tab, Counter]) {}");
    const leaves = extractBindingsFromPattern(node, SRC_UNKNOWN, sourceText);
    expect(leaves.map((l) => l.symbol)).toEqual(["Tab", "Counter"]);
    expect(leaves[0].value).toEqual({ kind: "MemberOf", obj: { kind: "Unknown" }, member: "0" });
    expect(leaves[1].value).toEqual({ kind: "MemberOf", obj: { kind: "Unknown" }, member: "1" });
  });

  it("AssignmentPattern (default value): recurses into .left", () => {
    const { node, sourceText } = patternFromParam("function f({ Component = Foo }) {}");
    const leaves = extractBindingsFromPattern(node, SRC_UNKNOWN, sourceText);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].symbol).toBe("Component");
    expect(leaves[0].value).toEqual({ kind: "MemberOf", obj: { kind: "Unknown" }, member: "Component" });
  });

  it("RestElement in object: { ...rest } → leaf rest with source (lossy)", () => {
    const { node, sourceText } = patternFromParam("function f({ ...rest }) {}");
    const leaves = extractBindingsFromPattern(node, SRC_UNKNOWN, sourceText);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].symbol).toBe("rest");
    expect(leaves[0].value).toEqual({ kind: "Unknown" });
  });

  it("nested ObjectPattern: { outer: { inner } } → MemberOf chain", () => {
    const { node, sourceText } = patternFromParam("function f({ outer: { inner } }) {}");
    const leaves = extractBindingsFromPattern(node, SRC_UNKNOWN, sourceText);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].symbol).toBe("inner");
    expect(leaves[0].value).toEqual({
      kind: "MemberOf",
      obj: { kind: "MemberOf", obj: { kind: "Unknown" }, member: "outer" },
      member: "inner",
    });
  });

  it("mixed nesting: { a: [b, c] } → MemberOf chains via MemberOf(MemberOf(src, 'a'), index)", () => {
    const { node, sourceText } = patternFromParam("function f({ a: [b, c] }) {}");
    const leaves = extractBindingsFromPattern(node, SRC_UNKNOWN, sourceText);
    expect(leaves.map((l) => l.symbol)).toEqual(["b", "c"]);
    expect(leaves[0].value).toEqual({
      kind: "MemberOf",
      obj: { kind: "MemberOf", obj: { kind: "Unknown" }, member: "a" },
      member: "0",
    });
    expect(leaves[1].value).toEqual({
      kind: "MemberOf",
      obj: { kind: "MemberOf", obj: { kind: "Unknown" }, member: "a" },
      member: "1",
    });
  });
});

function emitFile(source: string) {
  const gb = createGraphBuilder({ moduleResolver: () => null });
  const fb = gb.beginFile("src/App.tsx");
  emitReact({ file: "src/App.tsx", source, ast: parseSync("test.tsx", source).program, fileBuilder: fb });
  const fg = gb.build().files.get("src/App.tsx");
  if (!fg) throw new Error("missing file graph");
  return fg;
}

describe("emitParameterBindings: FunctionDeclaration params", () => {
  it("function App({ Component, pageProps }) emits two scope-local decls", () => {
    const fg = emitFile("function App({ Component, pageProps }) { return <Component />; }");
    const compDecls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Component"));
    expect(compDecls).toHaveLength(1);
    const [, comp] = compDecls[0];
    expect(comp.value).toEqual({
      kind: "MemberOf",
      obj: { kind: "ParameterOf", fn: expect.objectContaining({ symbol: "App" }), index: 0 },
      member: "Component",
    });

    const ppDecls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::pageProps"));
    expect(ppDecls).toHaveLength(1);
    expect(ppDecls[0][1].value).toEqual({
      kind: "MemberOf",
      obj: { kind: "ParameterOf", fn: expect.objectContaining({ symbol: "App" }), index: 0 },
      member: "pageProps",
    });
  });

  it("function App(props) emits one param decl with ParameterOf value", () => {
    const fg = emitFile("function App(props) { return <props.X />; }");
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::props"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toMatchObject({ kind: "ParameterOf", index: 0 });
  });

  it("param binding's scope is the function-body scope (not module scope)", () => {
    const fg = emitFile("function App({ Component }) { return <Component />; }");
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Component"));
    expect(decls).toHaveLength(1);
    const [key] = decls[0];
    expect(key.startsWith("0::")).toBe(false); // MODULE_SCOPE is 0
  });
});

describe("emitParameterBindings: arrow/fn-expr VariableDeclarator init", () => {
  it("const App = ({ Component }) => <Component /> emits a Component param decl", () => {
    const fg = emitFile("const App = ({ Component }) => <Component />;");
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Component"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toEqual({
      kind: "MemberOf",
      obj: { kind: "ParameterOf", fn: expect.objectContaining({ symbol: "App" }), index: 0 },
      member: "Component",
    });
  });

  it("const App = function({ Component }) {...} emits a Component param decl", () => {
    const fg = emitFile("const App = function({ Component }) { return <Component />; };");
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Component"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toMatchObject({
      kind: "MemberOf",
      obj: { kind: "ParameterOf", index: 0 },
      member: "Component",
    });
  });
});

describe("emitParameterBindings: HOC inner-arg", () => {
  it("const App = forwardRef(({ Component }, ref) => <Component />) emits Component + ref param decls", () => {
    const fg = emitFile("const App = forwardRef(({ Component }, ref) => <Component />);");
    const compDecls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Component"));
    expect(compDecls).toHaveLength(1);
    expect(compDecls[0][1].value).toEqual({
      kind: "MemberOf",
      obj: { kind: "ParameterOf", fn: expect.objectContaining({ symbol: "App" }), index: 0 },
      member: "Component",
    });

    const refDecls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::ref"));
    expect(refDecls).toHaveLength(1);
    expect(refDecls[0][1].value).toMatchObject({ kind: "ParameterOf", index: 1 });
  });

  it("export default withFallback(({ Component }) => <Component />) emits param decl in default scope", () => {
    const fg = emitFile("export default withFallback(({ Component }) => <Component />);");
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Component"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toEqual({
      kind: "MemberOf",
      obj: { kind: "ParameterOf", fn: expect.objectContaining({ symbol: "default" }), index: 0 },
      member: "Component",
    });
  });
});

describe("emitParameterBindings: anonymous default-export function", () => {
  it("export default function({ Component }) {...} emits param decl in default scope", () => {
    const fg = emitFile("export default function({ Component }) { return <Component />; };");
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Component"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toEqual({
      kind: "MemberOf",
      obj: { kind: "ParameterOf", fn: expect.objectContaining({ symbol: "default" }), index: 0 },
      member: "Component",
    });
  });
});

describe("walkJsxIn: nested arrows / fn decls", () => {
  it("render-prop arrow: <DL>{(Item) => <Item.Foo />}</DL> emits Item param decl in arrow scope", () => {
    const fg = emitFile(`
      function App() {
        return <DataLoader>{(Item) => <Item.Foo />}</DataLoader>;
      }
    `);
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Item"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toMatchObject({ kind: "ParameterOf", index: 0 });
    // Not module scope (0::).
    expect(decls[0][0].startsWith("0::")).toBe(false);
  });

  it("nested fn decl: function outer() { function inner(P) {...} } emits P param decl", () => {
    const fg = emitFile(`
      function outer() {
        function inner(P) { return <P />; }
        return inner;
      }
    `);
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::P"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toMatchObject({ kind: "ParameterOf", index: 0 });
    expect((decls[0][1].value as { kind: "ParameterOf"; fn: { symbol: string } }).fn.symbol).toBe("inner");
  });

  it("inline anonymous arrow with no name uses synthetic <arrow@N> fnRef", () => {
    const fg = emitFile(`
      function App() {
        return <List>{(item) => <item />}</List>;
      }
    `);
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::item"));
    expect(decls).toHaveLength(1);
    const value = decls[0][1].value as { kind: "ParameterOf"; fn: { symbol: string } };
    expect(value.kind).toBe("ParameterOf");
    expect(value.fn.symbol).toMatch(/^<arrow@\d+>$/);
  });
});

describe("emit: destructure of CallExpression init", () => {
  it("const { Modal } = useModal(); <Modal /> emits a Modal decl valued over the call's return", () => {
    const fg = emitFile(`
      function App() {
        const { Modal } = useModal();
        return <Modal />;
      }
    `);
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Modal"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toMatchObject({
      kind: "MemberOf",
      obj: { kind: "ReturnTypeOf" },
      member: "Modal",
    });
  });

  it("const [Tab] = useState(InitialTab); <Tab /> emits Tab decl with member=0", () => {
    const fg = emitFile(`
      function App() {
        const [Tab] = useState(InitialTab);
        return <Tab />;
      }
    `);
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Tab"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toMatchObject({
      kind: "MemberOf",
      obj: { kind: "ReturnTypeOf" },
      member: "0",
    });
  });

  it("const { Modal } = useContext(ModalCtx); <Modal /> emits a decl over the call's return", () => {
    const fg = emitFile(`
      function App() {
        const { Modal } = useContext(ModalCtx);
        return <Modal />;
      }
    `);
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::Modal"));
    expect(decls).toHaveLength(1);
    expect(decls[0][1].value).toMatchObject({ kind: "MemberOf", obj: { kind: "ReturnTypeOf" }, member: "Modal" });
  });

  it("negative: in const { a } = { a: Foo }; the leaf is not valued over a call return", () => {
    const fg = emitFile(`
      function App() {
        const { a } = { a: Foo };
        return <a />;
      }
    `);
    const decls = Array.from(fg.declarations.entries()).filter(([k]) => k.endsWith("::a"));
    // Zero decls, or one valued over the object literal: never over a
    // CallExpression return.
    for (const [, d] of decls) {
      const value = d.value as { kind: string; obj?: { kind: string } };
      expect(value.obj?.kind).not.toBe("ReturnTypeOf");
    }
  });
});
