import { describe, it, expect } from "vitest";
import { createGraphBuilder, MODULE_SCOPE, type InferredType, type Reference } from "../../src/index.js";
import { evalKind } from "../../src/engine/component-shape.js";
import { DYNAMIC_MEMBER_KEY } from "../../src/engine/resolve-type.js";

const ref = (symbol: string, memberChain: string[] = []): Reference => ({ symbol, scope: MODULE_SCOPE, memberChain, loc: { line: 1, column: 1 } });
const JSX: InferredType = { kind: "JSX" };
const fn = (...returns: InferredType[]): InferredType => ({ kind: "Function", returns });
const typeOf = (symbol: string, memberChain: string[] = []): InferredType => ({ kind: "TypeOf", ref: ref(symbol, memberChain) });
const call = (callee: InferredType, ...args: InferredType[]): InferredType => ({ kind: "ReturnTypeOf", callee, args });

function build(setup: (fb: ReturnType<ReturnType<typeof createGraphBuilder>["beginFile"]>) => void) {
  const gb = createGraphBuilder({ moduleResolver: () => null });
  const fb = gb.beginFile("a.tsx");
  setup(fb);
  const graph = gb.build();
  return { graph, fileGraph: graph.files.get("a.tsx")! };
}
const decl = (fb: { addDeclaration: (d: { symbol: string; value: InferredType; loc: { line: number; column: number }; isExported: boolean }) => void }, symbol: string, value: InferredType) =>
  fb.addDeclaration({ symbol, value, loc: { line: 1, column: 1 }, isExported: false });

describe("evalKind: the value-kind table", () => {
  it("Function returning JSX directly → component", () => {
    const { graph, fileGraph } = build(() => {});
    expect(evalKind(fn(JSX), graph, fileGraph)).toBe("component");
  });

  it("Function returning a Function returning JSX → other (a factory is not a component; non-recursion is load-bearing)", () => {
    const { graph, fileGraph } = build(() => {});
    expect(evalKind(fn(fn(JSX)), graph, fileGraph)).toBe("other");
  });

  it("bare JSX value (`const br = <br/>`) → jsx, not component", () => {
    const { graph, fileGraph } = build(() => {});
    expect(evalKind(JSX, graph, fileGraph)).toBe("jsx");
  });

  it("Function returning Union<JSX, Unknown> → component", () => {
    const { graph, fileGraph } = build(() => {});
    expect(evalKind(fn({ kind: "Union", types: [JSX, { kind: "Unknown" }] }), graph, fileGraph)).toBe("component");
  });

  it("Function returning Object containing JSX → other (data factory)", () => {
    const { graph, fileGraph } = build(() => {});
    expect(evalKind(fn({ kind: "Object", props: { cta: JSX } }), graph, fileGraph)).toBe("other");
  });

  it("calling a resolvable factory (withHoc(useHook, View)) → component (a factory product)", () => {
    const { graph, fileGraph } = build((fb) => {
      // withHoc = (hook, C) => (props) => <C/>, whose inner arrow renders opaque JSX
      decl(fb, "withHoc", fn(fn(JSX)));
      decl(fb, "useHook", fn({ kind: "Object", props: {} }));
      decl(fb, "View", fn(JSX));
    });
    expect(evalKind(call(typeOf("withHoc"), typeOf("useHook"), typeOf("View")), graph, fileGraph)).toBe("component");
  });

  it("the factory itself (TypeOf withHoc) → other", () => {
    const { graph, fileGraph } = build((fb) => decl(fb, "withHoc", fn(fn(JSX))));
    expect(evalKind(typeOf("withHoc"), graph, fileGraph)).toBe("other");
  });

  it("unresolvable callee with a non-component argument (makeStore({})) → unresolved", () => {
    const { graph, fileGraph } = build((fb) => {
      fb.addImport({ specifier: "state-kit", imported: "makeStore", local: "makeStore", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    });
    expect(evalKind(call(typeOf("makeStore"), { kind: "Object", props: {} }), graph, fileGraph)).toBe("unresolved");
  });

  it("a non-component product holding a component-shaped argument (createContext(Foo)) → other", () => {
    const { graph, fileGraph } = build((fb) => {
      fb.addImport({ specifier: "react", imported: "createContext", local: "createContext", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
      decl(fb, "Foo", fn(JSX));
    });
    expect(evalKind(call(typeOf("createContext"), typeOf("Foo")), graph, fileGraph)).toBe("other");
  });

  it("unresolvable callee with a component-shaped argument (connect(ms)(Foo)) → component", () => {
    const { graph, fileGraph } = build((fb) => {
      fb.addImport({ specifier: "react-redux", imported: "connect", local: "connect", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
      decl(fb, "Foo", fn(JSX));
    });
    expect(evalKind(call(call(typeOf("connect"), { kind: "Object", props: {} }), typeOf("Foo")), graph, fileGraph)).toBe("component");
  });

  it("unresolvable callee with an import-backed leaf argument (styled(Button)) → component", () => {
    const { graph, fileGraph } = build((fb) => {
      fb.addImport({ specifier: "styled-components", imported: "default", local: "styled", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
      fb.addImport({ specifier: "ds-lib", imported: "Button", local: "Button", scope: MODULE_SCOPE, loc: { line: 2, column: 1 } });
    });
    expect(evalKind(call(typeOf("styled"), typeOf("Button")), graph, fileGraph)).toBe("component");
  });

  it("React memo(Foo) through the library stub → component", () => {
    const { graph, fileGraph } = build((fb) => {
      fb.addImport({ specifier: "react", imported: "memo", local: "memo", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
      decl(fb, "Foo", fn(JSX));
    });
    expect(evalKind(call(typeOf("memo"), typeOf("Foo")), graph, fileGraph)).toBe("component");
  });

  it("lazy(() => import('./x')) shape → component (the lazy-import rule owns identity)", () => {
    const { graph, fileGraph } = build((fb) => {
      fb.addImport({ specifier: "react", imported: "lazy", local: "lazy", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    });
    const thunk: InferredType = fn({ kind: "DynamicImport", specifier: "./x", projection: [], originFile: "a.tsx" });
    expect(evalKind(call(typeOf("lazy"), thunk), graph, fileGraph)).toBe("component");
  });

  it("a component that returns another component's call (() => Bar()) → component", () => {
    const { graph, fileGraph } = build((fb) => decl(fb, "Bar", fn(JSX)));
    expect(evalKind(fn(call(typeOf("Bar"))), graph, fileGraph)).toBe("component");
  });

  it("a function that returns a factory's product (() => makeThing()) → other", () => {
    const { graph, fileGraph } = build((fb) => decl(fb, "makeThing", fn(fn(JSX))));
    expect(evalKind(fn(call(typeOf("makeThing"))), graph, fileGraph)).toBe("other");
  });

  it("Function([Unknown]) (a render-less class) → other", () => {
    const { graph, fileGraph } = build(() => {});
    expect(evalKind(fn({ kind: "Unknown" }), graph, fileGraph)).toBe("other");
  });

  it("an unbound ParameterOf → other (a parameter is never a component on its own)", () => {
    const { graph, fileGraph } = build(() => {});
    expect(evalKind({ kind: "ParameterOf", fn: ref("f"), index: 0 }, graph, fileGraph)).toBe("other");
  });

  it("a self-referencing value terminates (cycle guard)", () => {
    const { graph, fileGraph } = build((fb) => decl(fb, "Loop", fn(call(typeOf("Loop")))));
    expect(evalKind(typeOf("Loop"), graph, fileGraph)).toBe("other");
  });
});

describe("evalKind: .map(render) / element arrays / dynamic members", () => {
  it("items.map(item => <li/>) → jsx, not component (a render callback, not a wrapper prop)", () => {
    const { graph, fileGraph } = build((fb) => decl(fb, "items", { kind: "Unknown" }));
    const mapCall: InferredType = { kind: "ReturnTypeOf", callee: { kind: "MemberOf", obj: typeOf("items"), member: "map" }, args: [fn(JSX)] };
    expect(evalKind(mapCall, graph, fileGraph)).toBe("jsx");
  });

  it("a Function whose body is `() => items.map(i => <li/>)` is itself component-shaped (the render callback bubbles to jsx, so the enclosing Function is a component)", () => {
    const { graph, fileGraph } = build((fb) => decl(fb, "items", { kind: "Unknown" }));
    const mapCall: InferredType = { kind: "ReturnTypeOf", callee: { kind: "MemberOf", obj: typeOf("items"), member: "map" }, args: [fn(JSX)] };
    expect(evalKind(fn(mapCall), graph, fileGraph)).toBe("component");
  });

  it("an import-backed namespace member call (Sentry.withProfiler(Foo)) is still an opaque wrapper → component, not jsx", () => {
    const { graph, fileGraph } = build((fb) => {
      fb.addImport({ specifier: "@sentry/react", imported: "*", local: "Sentry", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
      decl(fb, "Foo", fn(JSX));
    });
    const wrapCall: InferredType = { kind: "ReturnTypeOf", callee: { kind: "MemberOf", obj: typeOf("Sentry"), member: "withProfiler" }, args: [typeOf("Foo")] };
    expect(evalKind(wrapCall, graph, fileGraph)).toBe("component");
  });

  it("a dynamic member access on an object of components merges every prop's shape (const Banner = MAP[type]) → component", () => {
    const { graph, fileGraph } = build((fb) => {
      decl(fb, "MAP", { kind: "Object", props: { success: fn(JSX), error: fn(JSX) } });
    });
    const dynamicAccess: InferredType = { kind: "MemberOf", obj: typeOf("MAP"), member: DYNAMIC_MEMBER_KEY };
    expect(evalKind(dynamicAccess, graph, fileGraph)).toBe("component");
  });

  it("a dynamic member access where no branch is component-shaped → other", () => {
    const { graph, fileGraph } = build((fb) => {
      decl(fb, "LABELS", { kind: "Object", props: { success: { kind: "Str", value: "ok" }, error: { kind: "Str", value: "bad" } } });
    });
    const dynamicAccess: InferredType = { kind: "MemberOf", obj: typeOf("LABELS"), member: DYNAMIC_MEMBER_KEY };
    expect(evalKind(dynamicAccess, graph, fileGraph)).toBe("other");
  });
});
