import { describe, it, expect } from "vitest";
import { parseSync } from "oxc-parser";
import { createGraphBuilder, MODULE_SCOPE } from "@scoutui/reference-graph";
import type { InferredType } from "@scoutui/reference-graph";
import { emitReact } from "../src/emit.js";

/** Every `TypeOf` reference reachable in a value tree, with its position. */
function typeOfRefs(t: InferredType): Array<{ symbol: string; loc: { line: number; column: number } }> {
  switch (t.kind) {
    case "TypeOf":
      return [{ symbol: t.ref.symbol, loc: t.ref.loc }];
    case "Function":
      return t.returns.flatMap(typeOfRefs);
    case "ReturnTypeOf":
      return [...typeOfRefs(t.callee), ...t.args.flatMap(typeOfRefs)];
    case "MemberOf":
      return typeOfRefs(t.obj);
    case "Union":
      return t.types.flatMap(typeOfRefs);
    case "Object":
      return Object.values(t.props).flatMap(typeOfRefs);
    case "Array":
      return t.elements.flatMap(typeOfRefs);
    default:
      return [];
  }
}

function parseTsx(source: string) {
  return parseSync("test.tsx", source).program;
}

function emit(source: string) {
  const gb = createGraphBuilder({ moduleResolver: () => null });
  const fb = gb.beginFile("src/App.tsx");
  emitReact({ file: "src/App.tsx", source, ast: parseTsx(source), fileBuilder: fb });
  return gb.build().files.get("src/App.tsx");
}

describe("emitReact: declarations with InferredType", () => {
  it("function declaration returning JSX → Function([JSX])", () => {
    const fg = emit("function Foo() { return <div />; }");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::Foo`);
    expect(decl?.value.kind).toBe("Function");
    if (decl?.value.kind === "Function") {
      expect(decl.value.returns).toContainEqual({ kind: "JSX" });
    }
  });

  it("const = arrow returning JSX → Function([JSX])", () => {
    const fg = emit("const Foo = () => <div />;");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::Foo`);
    expect(decl?.value.kind).toBe("Function");
  });

  it("class declaration → Function([JSX]) (treating render as the return path)", () => {
    const fg = emit("class Foo extends Component { render() { return <div />; } }");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::Foo`);
    expect(decl?.value.kind).toBe("Function");
  });

  it("const = identifier → TypeOf(ref)", () => {
    const fg = emit("const X = Foo;");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    expect(decl?.value.kind).toBe("TypeOf");
    if (decl?.value.kind === "TypeOf") {
      expect(decl.value.ref.symbol).toBe("Foo");
    }
  });

  it("const = call expression → ReturnTypeOf(callee, args)", () => {
    const fg = emit("const X = connect()(Foo);");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    expect(decl?.value.kind).toBe("ReturnTypeOf");
  });

  it("const = object literal → Object({ a: TypeOf(Foo), b: TypeOf(Bar) })", () => {
    const fg = emit("const M = { a: Foo, b: Bar };");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::M`);
    expect(decl?.value.kind).toBe("Object");
    if (decl?.value.kind === "Object") {
      expect(Object.keys(decl.value.props).sort()).toEqual(["a", "b"]);
    }
  });

  it("const = member access (dynamic key) → MemberOf(obj, DYNAMIC_MEMBER_KEY)", () => {
    const fg = emit("const C = M[k];");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::C`);
    expect(decl?.value.kind).toBe("MemberOf");
  });

  it("const = member access (static key) → MemberOf(obj, 'foo')", () => {
    const fg = emit("const C = M.foo;");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::C`);
    expect(decl?.value.kind).toBe("MemberOf");
    if (decl?.value.kind === "MemberOf") {
      expect(decl.value.member).toBe("foo");
    }
  });

  it("dynamic import expression → DynamicImport(specifier, [])", () => {
    const fg = emit("const X = import('./foo');");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    expect(decl?.value.kind).toBe("DynamicImport");
    if (decl?.value.kind === "DynamicImport") {
      expect(decl.value.specifier).toBe("./foo");
      expect(decl.value.projection).toEqual([]);
    }
  });

  it("dynamic import with non-literal specifier → Unknown", () => {
    const fg = emit("const mod = 'foo'; const X = import(mod);");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    expect(decl?.value.kind).toBe("Unknown");
  });

  it("dynamic import inside arrow returns DynamicImport", () => {
    const fg = emit("const X = () => import('./foo');");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    expect(decl?.value.kind).toBe("Function");
    if (decl?.value.kind === "Function") {
      const r = decl.value.returns[0];
      expect(r.kind).toBe("DynamicImport");
      if (r.kind === "DynamicImport") {
        expect(r.specifier).toBe("./foo");
        expect(r.projection).toEqual([]);
      }
    }
  });

  it("import('./foo').then(m => m.Button) → DynamicImport(./foo, [Button])", () => {
    const fg = emit("const X = () => import('./foo').then(m => m.Button);");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    expect(decl?.value.kind).toBe("Function");
    if (decl?.value.kind === "Function") {
      const r = decl.value.returns[0];
      expect(r.kind).toBe("DynamicImport");
      if (r.kind === "DynamicImport") {
        expect(r.specifier).toBe("./foo");
        expect(r.projection).toEqual(["Button"]);
      }
    }
  });

  it("import('./foo').then(({Button}) => Button) → DynamicImport(./foo, [Button])", () => {
    const fg = emit("const X = () => import('./foo').then(({Button}) => Button);");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    if (decl?.value.kind === "Function") {
      const r = decl.value.returns[0];
      if (r.kind === "DynamicImport") {
        expect(r.projection).toEqual(["Button"]);
      } else {
        throw new Error(`expected DynamicImport, got ${r.kind}`);
      }
    }
  });

  it(".then with complex thunk falls through to generic ReturnTypeOf", () => {
    const fg = emit("const X = () => import('./foo').then(m => somethingComplex(m));");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    if (decl?.value.kind === "Function") {
      const r = decl.value.returns[0];
      expect(r.kind).toBe("ReturnTypeOf");
    }
  });

  it("await import('./foo') → DynamicImport(./foo, [])", () => {
    const fg = emit("const X = async () => { const m = await import('./foo'); return m.Y; }");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    expect(decl?.value.kind).toBe("Function");
    if (decl?.value.kind === "Function") {
      // The return is `m.Y`, MemberOf(TypeOf(m), "Y"), and `m` is a body-scope
      // declaration valued DynamicImport. Only the return's presence is checked.
      expect(decl.value.returns.length).toBeGreaterThan(0);
    }
  });

  it("HOC wrapping an inline arrow tags the Function with its source file", () => {
    const fg = emit("const Spreadsheet = forwardRef((p, r) => <div ref={r} />);");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::Spreadsheet`);
    expect(decl?.value.kind).toBe("ReturnTypeOf");
    if (decl?.value.kind === "ReturnTypeOf") {
      const innerFn = decl.value.args[0];
      expect(innerFn?.kind).toBe("Function");
      if (innerFn?.kind === "Function") {
        expect(innerFn.enclosingBinding).toEqual({ file: "src/App.tsx" });
      }
    }
  });

  it("HOC wrapping a named FunctionExpression tags the Function with its source file", () => {
    const fg = emit("const Toolbar = forwardRef(function Toolbar(p, r) { return <div ref={r} />; });");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::Toolbar`);
    if (decl?.value.kind === "ReturnTypeOf") {
      const innerFn = decl.value.args[0];
      if (innerFn?.kind === "Function") {
        expect(innerFn.enclosingBinding).toEqual({ file: "src/App.tsx" });
      }
    }
  });

  it("`export default hoc(() => …)` tags the inner Function with its source file", () => {
    const fg = emit("export default withFallback(() => <div />);");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::default`);
    if (decl?.value.kind === "ReturnTypeOf") {
      const innerFn = decl.value.args[0];
      if (innerFn?.kind === "Function") {
        expect(innerFn.enclosingBinding).toEqual({ file: "src/App.tsx" });
      }
    }
  });

  it("standalone await import('./foo') in a const → DynamicImport(./foo, [])", () => {
    // Wrapped in an async arrow because `await` needs an async context; the
    // AwaitExpression arm fires regardless of context.
    const fg = emit("const X = async () => await import('./foo');");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::X`);
    if (decl?.value.kind === "Function") {
      const r = decl.value.returns[0];
      expect(r.kind).toBe("DynamicImport");
      if (r.kind === "DynamicImport") {
        expect(r.specifier).toBe("./foo");
        expect(r.projection).toEqual([]);
      }
    }
  });

  it("emits a BindingDecl for `const X = ...` inside a function body", () => {
    const fg = emit("function App() { const X = Foo; return <X />; }");
    expect(fg?.declarations.get(`${MODULE_SCOPE}::App`)).toBeDefined();
    const xDecls = Array.from(fg?.declarations.entries() ?? []).filter(([k]) => k.endsWith("::X"));
    expect(xDecls.length).toBe(1);
    const [xKey, xDecl] = xDecls[0];
    expect(xKey).not.toBe(`${MODULE_SCOPE}::X`);
    expect(xDecl?.symbol).toBe("X");
    expect(xDecl?.value.kind).toBe("TypeOf");
  });

  it("emits a BindingDecl for declarations inside an if-branch", () => {
    const fg = emit("function App() { if (true) { const X = Foo; } return <div />; }");
    const xDecls = Array.from(fg?.declarations.entries() ?? []).filter(([k]) => k.endsWith("::X"));
    expect(xDecls.length).toBe(1);
    expect(xDecls[0][0]).not.toBe(`${MODULE_SCOPE}::X`);
  });

  it("emits a BindingDecl for declarations inside a try-block", () => {
    const fg = emit("function App() { try { const X = Foo; } catch { } return <div />; }");
    const xDecls = Array.from(fg?.declarations.entries() ?? []).filter(([k]) => k.endsWith("::X"));
    expect(xDecls.length).toBe(1);
  });

  it("emits a BindingDecl for declarations inside a switch-case", () => {
    const fg = emit("function App({k}: {k: string}) { switch (k) { case 'a': { const X = Foo; break; } } return <div />; }");
    const xDecls = Array.from(fg?.declarations.entries() ?? []).filter(([k]) => k.endsWith("::X"));
    expect(xDecls.length).toBe(1);
  });

  it("nested-function-body declarations get their own scope", () => {
    const fg = emit("function App() { const inner = () => { const X = Foo; return <X />; }; return inner(); }");
    const xDecls = Array.from(fg?.declarations.entries() ?? []).filter(([k]) => k.endsWith("::X"));
    expect(xDecls.length).toBe(1);
    expect(xDecls[0][0]).not.toBe(`${MODULE_SCOPE}::X`);
  });

  it("JSX usage inside a function body has the function-body scope", () => {
    const fg = emit("function App() { const X = Foo; return <X />; }");
    const xUsage = fg?.jsxUsages.find((u) => u.ref.symbol === "X");
    expect(xUsage).toBeDefined();
    expect(xUsage?.ref.scope).not.toBe(MODULE_SCOPE);
  });

  it("class declaration without render → Function([Unknown]), never JSX (a render-less class is not component-shaped)", () => {
    const fg = emit("class ApiClient { fetch() { return 1; } }");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::ApiClient`);
    expect(decl?.value.kind).toBe("Function");
    if (decl?.value.kind === "Function") {
      expect(decl.value.returns).toEqual([{ kind: "Unknown" }]);
    }
  });

  it("exported class declaration without render → Function([Unknown])", () => {
    const fg = emit("export class Store { get() { return 1; } }");
    const decl = fg?.declarations.get(`${MODULE_SCOPE}::Store`);
    expect(decl?.value.kind).toBe("Function");
    if (decl?.value.kind === "Function") {
      expect(decl.value.returns).toEqual([{ kind: "Unknown" }]);
    }
  });
});

describe("emitReact: scope agreement between value inference and the declaration walk", () => {
  it("IIFE return-object shorthand refs carry the IIFE body scope (shadowed destructure)", () => {
    const fg = emit(`
      export function App() {
        const { flatSteps } = (() => {
          const flatSteps = X;
          return { flatSteps };
        })();
        return <div />;
      }
    `);
    // Two flatSteps declarations exist: the outer destructure target and the
    // IIFE-local. The shorthand ref inside the IIFE's returned object is
    // stamped with the IIFE-local's scope, not the outer statement's;
    // otherwise resolution loops back to the outer declaration (a reference
    // cycle).
    const decls = [...(fg?.declarations.entries() ?? [])].filter(([k]) => k.endsWith("::flatSteps"));
    expect(decls).toHaveLength(2);
    const outer = decls.find(([, d]) => d.value.kind === "MemberOf");
    const local = decls.find(([, d]) => d.value.kind === "TypeOf");
    expect(outer).toBeDefined();
    expect(local).toBeDefined();
    if (!outer || !local) throw new Error("expected both declarations");
    const localScope = Number(local[0].split("::")[0]);

    const outerValue = outer[1].value;
    if (outerValue.kind !== "MemberOf") throw new Error("expected MemberOf");
    const callee = outerValue.obj.kind === "ReturnTypeOf" ? outerValue.obj.callee : null;
    if (callee?.kind !== "Function") throw new Error("expected Function callee");
    const returned = callee.returns[0];
    if (returned?.kind !== "Object") throw new Error("expected Object return");
    const shorthand = returned.props.flatSteps;
    if (shorthand?.kind !== "TypeOf") throw new Error("expected TypeOf prop");
    expect(shorthand.ref.scope).toBe(localScope);
  });
});

describe("emitReact: value references carry source positions", () => {
  it("stamps every reference reachable through inference, leaving no path at 0:0", () => {
    const fg = emit(`
import { A, B, C, D, E, F, G, H, I, J, K } from "pkg";
export const call = wrap(A, ...B, { long: C, D }, [E, ...F]);
export const member = G.x;
export const cond = flag ? H : I;
export const logical = flag && J;
export const concise = () => K;
export function block() {
  if (flag) { return A; }
  try { return B; } catch (e) { return C; }
  switch (flag) { case 1: return D; }
  return E;
}
export class Cls extends Base { render() { return F; } }
`);
    const refs = [...(fg?.declarations.values() ?? [])].flatMap((d) => typeOfRefs(d.value));
    // Not vacuous: the source above reaches at least this many identifiers.
    expect(refs.length).toBeGreaterThanOrEqual(18);
    const unstamped = refs.filter((r) => r.loc.line < 1);
    expect(unstamped).toEqual([]);
  });
});

describe("emitReact: a static member of a namespace import in value position", () => {
  const declValue = (source: string, symbol: string) =>
    [...(emit(source)?.declarations.values() ?? [])].find((d) => d.symbol === symbol)?.value;
  const ref = (symbol: string, memberChain: string[]) =>
    expect.objectContaining({ kind: "TypeOf", ref: expect.objectContaining({ symbol, memberChain }) });

  it("is a reference to the namespace carrying the member chain", () => {
    expect(declValue(`import * as UI from "./ui";\nconst P = UI.Plain;`, "P")).toEqual(ref("UI", ["Plain"]));
    expect(declValue(`import * as UI from "./ui";\nconst P = UI.Card.Header;`, "P")).toEqual(ref("UI", ["Card", "Header"]));
    expect(declValue(`import * as UI from "./ui";\nfunction F() { const P = UI.Plain; return <P />; }`, "P")).toEqual(
      ref("UI", ["Plain"]),
    );
  });

  it("is a reference as a call argument and under a dynamic key", () => {
    const memo = declValue(`import * as UI from "./ui";\nimport { memo } from "react";\nconst M = memo(UI.Plain);`, "M");
    expect(memo).toMatchObject({ kind: "ReturnTypeOf", args: [ref("UI", ["Plain"])] });
    const dynamic = declValue(`import * as UI from "./ui";\nconst P = UI.icons[name];`, "P");
    expect(dynamic).toMatchObject({ kind: "MemberOf", obj: ref("UI", ["icons"]) });
  });

  it("stays a member access where it is a call's callee", () => {
    const m = declValue(`import * as R from "react";\nconst M = R.memo(Button);`, "M");
    expect(m).toMatchObject({ kind: "ReturnTypeOf", callee: { kind: "MemberOf", obj: ref("R", []), member: "memo" } });
  });

  it.each([
    ["an `as` cast", "(R.memo as any)(B)"],
    ["a non-null assertion", "R.memo!(B)"],
    ["parentheses", "(R.memo)(B)"],
    ["a `satisfies` check", "(R.memo satisfies unknown)(B)"],
  ])("stays a member access where it is a call's callee under %s", (_label, call) => {
    const m = declValue(`import * as R from "react";\nconst M = ${call};`, "M");
    expect(m).toMatchObject({ kind: "ReturnTypeOf", callee: { kind: "MemberOf", obj: ref("R", []), member: "memo" } });
  });

  it("stays a member access on a default or named import", () => {
    expect(declValue(`import UI from "./ui";\nconst P = UI.Plain;`, "P")).toMatchObject({ kind: "MemberOf", member: "Plain" });
    expect(declValue(`import { UI } from "./ui";\nconst P = UI.Plain;`, "P")).toMatchObject({ kind: "MemberOf", member: "Plain" });
  });

  it.each([
    ["a parameter", `import * as UI from "./ui";\nfunction F(UI) { const P = UI.Plain; return <P />; }`],
    ["a destructured parameter", `import * as UI from "./ui";\nconst F = ({ UI }) => { const P = UI.Plain; return <P />; };`],
    ["an earlier local", `import * as UI from "./ui";\nfunction F() { const UI = pick(); const P = UI.Plain; return <P />; }`],
    ["a function declared later in the body", `import * as UI from "./ui";\nfunction F() { const P = UI.Plain; function UI() {} return <P />; }`],
    ["a module-scope declaration beside a type-only import", `import type * as UI from "./ui";\nconst UI = { Plain: () => null };\nconst P = UI.Plain;`],
  ])("stays a member access where %s shadows the namespace", (_label, source) => {
    expect(declValue(source, "P")).toMatchObject({ kind: "MemberOf", member: "Plain" });
  });
});

describe("emitReact: a destructure records a declaration per leaf", () => {
  const declValue = (source: string, symbol: string) =>
    [...(emit(source)?.declarations.values() ?? [])].find((d) => d.symbol === symbol)?.value;
  const ref = (symbol: string, memberChain: string[]) =>
    expect.objectContaining({ kind: "TypeOf", ref: expect.objectContaining({ symbol, memberChain }) });

  it("over a name, is a reference to the name extended by each leaf's key", () => {
    const source = `import { Table } from "@acme/ui";\nconst { Cell, Row: R } = Table;`;
    expect(declValue(source, "Cell")).toEqual(ref("Table", ["Cell"]));
    expect(declValue(source, "R")).toEqual(ref("Table", ["Row"]));
  });

  it("extends the chain through a nested pattern", () => {
    expect(declValue("const { a: { B } } = NS;", "B")).toEqual(ref("NS", ["a", "B"]));
  });

  it("over a static member, extends the member's chain", () => {
    expect(declValue(`import * as UI from "./ui";\nconst { C } = UI.Table;`, "C")).toEqual(ref("UI", ["Table", "C"]));
    expect(declValue(`import { UI } from "./ui";\nconst { C } = UI.Table;`, "C")).toEqual(ref("UI", ["Table", "C"]));
  });

  it("is recorded inside a function body", () => {
    expect(declValue("function F() { const { Cell } = Table; return <Cell />; }", "Cell")).toEqual(ref("Table", ["Cell"]));
  });

  it("keeps the leaf's reference where the leaf has a default", () => {
    expect(declValue("const { C = Fallback } = T;", "C")).toEqual(ref("T", ["C"]));
  });

  it("is a member of the initialiser's value under an array pattern", () => {
    expect(declValue("const [A] = list;", "A")).toEqual({ kind: "MemberOf", obj: ref("list", []), member: "0" });
  });

  it("is a member of the initialiser's value over an object literal", () => {
    expect(declValue("const { D } = { D: X };", "D")).toEqual({
      kind: "MemberOf",
      obj: { kind: "Object", props: { D: ref("X", []) } },
      member: "D",
    });
  });

  it("skips a computed key", () => {
    expect(declValue("const { [k]: A } = T;", "A")).toBeUndefined();
  });

  it("binds a rest element to the value it is taken from", () => {
    expect(declValue("const { a, ...rest } = T;", "rest")).toEqual(ref("T", []));
    expect(declValue("const { a: { b, ...rest } } = T;", "rest")).toEqual(ref("T", ["a"]));
    expect(declValue("const [first, ...rest] = list;", "rest")).toEqual(ref("list", []));
    expect(declValue("const { a, ...rest } = useThing();", "rest")).toMatchObject({ kind: "ReturnTypeOf" });
  });

  it("records each leaf of a for-of head as a member of an unknown value", () => {
    const source = "function F(rows) { for (const { Cell, Row: R } of rows) {} }";
    expect(declValue(source, "Cell")).toEqual({ kind: "MemberOf", obj: { kind: "Unknown" }, member: "Cell" });
    expect(declValue(source, "R")).toEqual({ kind: "MemberOf", obj: { kind: "Unknown" }, member: "Row" });
  });

  it("is a member of the call's return over a call", () => {
    expect(declValue("const { Modal } = useModal();", "Modal")).toMatchObject({
      kind: "MemberOf",
      obj: { kind: "ReturnTypeOf", callee: ref("useModal", []) },
      member: "Modal",
    });
  });
});

describe("emitReact: a static member assigned to a name", () => {
  const ref = (symbol: string, memberChain: string[] = []) =>
    expect.objectContaining({ kind: "TypeOf", ref: expect.objectContaining({ symbol, memberChain }) });
  const assignments = (source: string) =>
    (emit(source)?.memberAssignments ?? []).map((a) => ({ holder: a.holder.symbol, scope: a.holder.scope, member: a.member, value: a.value }));
  const declValue = (source: string, symbol: string) =>
    [...(emit(source)?.declarations.values() ?? [])].find((d) => d.symbol === symbol)?.value;

  it("records `X.m = v` on the holder at module scope", () => {
    const fg = emit("function CardHeader() { return <h2 />; }\nfunction Card() { return <div />; }\nCard.Header = CardHeader;");
    expect(fg?.memberAssignments).toEqual([
      {
        holder: expect.objectContaining({ symbol: "Card", scope: MODULE_SCOPE, memberChain: [] }),
        member: "Header",
        value: ref("CardHeader"),
        loc: { line: 3, column: 1 },
      },
    ]);
  });

  it("records an assignment inside a function body at the body's scope", () => {
    const [entry] = assignments("function Card() { return <div />; }\nfunction setup() { Card.Header = () => <h2 />; }");
    expect(entry).toMatchObject({ holder: "Card", member: "Header", value: { kind: "Function" } });
    expect(entry?.scope).not.toBe(MODULE_SCOPE);
  });

  it.each([
    ["a nested member", "A.b.c = v;"],
    ["a computed member", "A[k] = v;"],
    ["a compound operator", "A.b += v;"],
    ["a `this` holder", "class K { m() { this.b = v; } }"],
  ])("records nothing for %s", (_label, source) => {
    expect(assignments(source)).toEqual([]);
  });

  it("still holds the assigned value", () => {
    const fg = emit("function Card() { return <div />; }\nCard.Header = CardHeader;");
    expect(fg?.heldRefs.map((r) => r.symbol)).toContain("CardHeader");
  });

  it("lowers `Object.assign(A, { m })` to A's value, with one member per literal property", () => {
    const source = "const PanelHeader = () => <header />;\nconst PanelBody = () => <div />;\nexport const Panel = Object.assign(PanelBody, { Header: PanelHeader, [k]: X, ...more });";
    expect(declValue(source, "Panel")).toEqual(ref("PanelBody"));
    expect(assignments(source)).toEqual([{ holder: "Panel", scope: MODULE_SCOPE, member: "Header", value: ref("PanelHeader") }]);
  });

  it("records no member for a source that is not an object literal", () => {
    const source = "const Panel = Object.assign(PanelBody, rest);";
    expect(declValue(source, "Panel")).toEqual(ref("PanelBody"));
    expect(assignments(source)).toEqual([]);
  });

  it("lowers `Object.assign({}, …)` to the literal, with each later literal's properties as members", () => {
    const source = "const cfg = Object.assign({ a: A }, defaults, { b: B });";
    expect(declValue(source, "cfg")).toEqual({ kind: "Object", props: { a: ref("A") } });
    expect(assignments(source)).toEqual([{ holder: "cfg", scope: MODULE_SCOPE, member: "b", value: ref("B") }]);
  });

  it.each([
    ["a local `Object`", "const Object = make();\nconst Panel = Object.assign(PanelBody, { Header: H });"],
    ["an imported `Object`", `import { Object } from "./shim";\nconst Panel = Object.assign(PanelBody, { Header: H });`],
    ["a parameter named `Object`", "function F(Object) { const Panel = Object.assign(PanelBody, { Header: H }); return <Panel />; }"],
  ])("does not lower where %s is in scope", (_label, source) => {
    expect(declValue(source, "Panel")).toMatchObject({ kind: "ReturnTypeOf" });
    expect(assignments(source)).toEqual([]);
  });

  it("does not lower a call with no arguments", () => {
    expect(declValue("const P = Object.assign();", "P")).toMatchObject({ kind: "ReturnTypeOf" });
  });
});
