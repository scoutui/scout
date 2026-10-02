import { describe, it, expect } from "vitest";
import {
  createGraphBuilder,
  MODULE_SCOPE,
  DYNAMIC_MEMBER_KEY,
} from "../src/index.js";
import type { Reference } from "../src/index.js";
import { resolve } from "../src/engine/index.js";

function refOf(symbol: string): Reference {
  return { symbol, scope: MODULE_SCOPE, memberChain: [], loc: { line: 0, column: 0 } };
}

describe("resolve(graph): end-to-end", () => {
  it("emits one occurrence per JSX usage resolving to a JSX-typed binding", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    // Add an import so the engine can derive a package-based componentId.
    fb.addImport({ specifier: "my-lib", imported: "Foo", local: "Foo", loc: { line: 1, column: 0 } });
    fb.addJsxUsage({
      ref: { symbol: "Foo", memberChain: [], loc: { line: 5, column: 5 } },
      loc: { line: 5, column: 5 },
      props: [],
    });
    const graph = gb.build();
    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.filePath).toBe("src/App.tsx");
    expect(occurrences[0]?.line).toBe(5);
    // Engine occurrences carry rawComponentId, not a hashed string.
    expect(occurrences[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Foo",
      source: { type: "external", package: "my-lib" },
    });
    expect(occurrences[0]?.via).toMatchObject({
      kind: "direct-import",
      specifier: "my-lib",
      import: "Foo",
    });
  });

  it("<E /> resolves to Foo through an inline HOC (const E = id()(Foo))", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    fb.addImport({ specifier: "my-lib", imported: "Foo", local: "Foo", loc: { line: 1, column: 0 } });
    const idRef = { symbol: "id", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 } };
    fb.addDeclaration({
      symbol: "id",
      value: {
        kind: "Function",
        returns: [
          { kind: "Function", returns: [{ kind: "ParameterOf", fn: idRef, index: 0 }] },
        ],
      },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    const FooRef = { symbol: "Foo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 } };
    fb.addDeclaration({
      symbol: "E",
      value: {
        kind: "ReturnTypeOf",
        callee: {
          kind: "ReturnTypeOf",
          callee: { kind: "TypeOf", ref: idRef },
          args: [],
        },
        args: [{ kind: "TypeOf", ref: FooRef }],
      },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    fb.addJsxUsage({
      ref: { symbol: "E", memberChain: [], loc: { line: 5, column: 5 } },
      loc: { line: 5, column: 5 },
      props: [],
    });
    const graph = gb.build();
    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toEqual({ kind: "react-component", export: "Foo", source: { type: "external", package: "my-lib" } });
    expect(occurrences[0]?.viaChain).toEqual([
      { kind: "local-component" },
      { kind: "hoc-wrapper", hocCallee: "id", specifier: "my-lib", import: "Foo" },
    ]);
  });

  it("emits multi-element viaChain for an HOC of a local component", () => {
    // Build a graph with: external `connect` import, local `Foo` component,
    // and a JSX usage of `Wrapped = connect()(Foo)`.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("a.tsx");
    fb.addImport({
      specifier: "react-redux",
      imported: "connect",
      local: "connect",
      scope: MODULE_SCOPE,
      loc: { line: 1, column: 1 },
    });
    fb.addDeclaration({
      symbol: "Foo",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "Wrapped",
      value: {
        kind: "ReturnTypeOf",
        callee: {
          kind: "ReturnTypeOf",
          callee: { kind: "TypeOf", ref: refOf("connect") },
          args: [],
        },
        args: [{ kind: "TypeOf", ref: refOf("Foo") }],
      },
      loc: { line: 5, column: 1 },
      isExported: false,
    });
    fb.addJsxUsage({
      ref: refOf("Wrapped"),
      loc: { line: 10, column: 5 },
      props: [],
    });

    const graph = gb.build();
    const { occurrences } = resolve(graph);
    expect(occurrences.length).toBe(1);
    const occ = occurrences[0];
    expect(occ?.viaChain.length).toBeGreaterThanOrEqual(2);
    // Outer via is local-component (Wrapped is a same-file binding).
    expect(occ?.viaChain[0]?.kind).toBe("local-component");
    // Inner via is hoc-wrapper.
    expect(occ?.viaChain[1]?.kind).toBe("hoc-wrapper");
  });

  it("two direct imports: <Foo /> and <Bar /> each resolve to one occurrence", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.tsx");
    // Import Foo and Bar directly.
    fb.addImport({ specifier: "my-lib", imported: "Foo", local: "Foo", loc: { line: 1, column: 0 } });
    fb.addImport({ specifier: "my-lib", imported: "Bar", local: "Bar", loc: { line: 2, column: 0 } });
    const fooRef = { symbol: "Foo", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 } };
    const barRef = { symbol: "Bar", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 1 } };
    const mapRef = { symbol: "M", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 } };
    fb.addDeclaration({
      symbol: "M",
      value: {
        kind: "Object",
        props: { a: { kind: "TypeOf", ref: fooRef }, b: { kind: "TypeOf", ref: barRef } },
      },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "C",
      value: { kind: "MemberOf", obj: { kind: "TypeOf", ref: mapRef }, member: DYNAMIC_MEMBER_KEY },
      loc: { line: 4, column: 1 },
      isExported: false,
    });
    // Use Foo and Bar directly (no dynamic-map indirection through C).
    fb.addJsxUsage({
      ref: { symbol: "Foo", memberChain: [], loc: { line: 5, column: 5 } },
      loc: { line: 5, column: 5 },
      props: [],
    });
    fb.addJsxUsage({
      ref: { symbol: "Bar", memberChain: [], loc: { line: 6, column: 5 } },
      loc: { line: 6, column: 5 },
      props: [],
    });
    const graph = gb.build();
    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(2);
  });
});

describe("engine: prop projection from JsxUsage", () => {
  it("tag usage events reach EngineOccurrence.events", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/App.vue", "vue");
    fb.addTagUsage({ tagName: "example-modal", loc: { line: 3, column: 5 }, props: [], events: ["example-modal-close"] });
    const { occurrences } = resolve(gb.build());
    const occ = occurrences.find((o) => o.line === 3);
    expect(occ?.events).toEqual(["example-modal-close"]);
  });
});

describe("resolve(): helper-call fanout (end-to-end)", () => {
  it("fans JSX inside a data-factory helper out per component caller", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/app.tsx");
    // const Leaf = () => <span/>;
    fb.addDeclaration({
      symbol: "Leaf",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    // const getRows = () => [<Leaf />];
    fb.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    // const ViewA = () => <Table rows={getRows()} />  (and ViewB)
    for (const name of ["ViewA", "ViewB"]) {
      fb.addDeclaration({
        symbol: name,
        value: {
          kind: "Function",
          returns: [
            {
              kind: "ReturnTypeOf",
              callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/app.tsx" } },
              args: [],
            },
            { kind: "JSX" },
          ],
        },
        loc: { line: 5, column: 1 },
        isExported: true,
      });
      fb.addExport({ kind: "named", exportedAs: name, local: name });
    }
    // Emit a JSX usage <Leaf/> with ownerSymbolRef = getRows (the lexical enclosure).
    fb.addJsxUsage({
      ref: { symbol: "Leaf", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 12 }, originFile: "src/app.tsx" },
      loc: { line: 3, column: 12 },
      props: [],
    });
    fb.setOwner({ symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 }, originFile: "src/app.tsx" });

    const graph = gb.build();
    const { occurrences } = resolve(graph);

    // Two occurrences (one per component caller), each with helper-call hop in viaChain.
    expect(occurrences).toHaveLength(2);
    const owners = occurrences
      .map((o) => {
        const src = o.rawOwnerComponentId?.source;
        if (src?.type === "local" && o.rawOwnerComponentId?.kind === "react-component") {
          return `${src.filePath}::${o.rawOwnerComponentId.export}`;
        }
        return null;
      })
      .sort();
    expect(owners).toEqual(["src/app.tsx::ViewA", "src/app.tsx::ViewB"]);
    for (const occ of occurrences) {
      const hopVia = occ.viaChain.find((v) => v.kind === "helper-call");
      expect(hopVia).toBeDefined();
      if (hopVia?.kind === "helper-call") {
        expect(hopVia.callee).toBe("getRows");
        expect(hopVia.calleeFile).toBe("src/app.tsx");
      }
    }
  });

  it("assigns distinct occurrence keys to fanned-out occurrences of the same JSX site", () => {
    // Reuse the same fixture shape: <Leaf/> inside getRows() called by ViewA + ViewB.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/app.tsx");
    fb.addDeclaration({
      symbol: "Leaf",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    for (const name of ["ViewA", "ViewB"]) {
      fb.addDeclaration({
        symbol: name,
        value: {
          kind: "Function",
          returns: [
            {
              kind: "ReturnTypeOf",
              callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/app.tsx" } },
              args: [],
            },
            { kind: "JSX" },
          ],
        },
        loc: { line: 5, column: 1 },
        isExported: true,
      });
      fb.addExport({ kind: "named", exportedAs: name, local: name });
    }
    fb.addJsxUsage({
      ref: { symbol: "Leaf", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 12 }, originFile: "src/app.tsx" },
      loc: { line: 3, column: 12 },
      props: [],
    });
    fb.setOwner({ symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 }, originFile: "src/app.tsx" });

    const graph = gb.build();
    const { occurrences } = resolve(graph);

    expect(occurrences).toHaveLength(2);
    const ids = occurrences.map((o) => o.occurrenceKey);
    expect(new Set(ids).size).toBe(2); // distinct ids: no collision
  });

  it("preserves single occurrence + no helper-call hop when viaOverride is set", () => {
    // Same setup, but the parser pre-set viaOverride (simulating a prop-forward).
    // Expect: helper reclassification skipped entirely; single occurrence; viaChain
    // is exactly [viaOverride] (no helper-call hop injected).
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/app.tsx");
    fb.addDeclaration({
      symbol: "Leaf",
      value: { kind: "Function", returns: [{ kind: "JSX" }] },
      loc: { line: 1, column: 1 },
      isExported: false,
    });
    fb.addDeclaration({
      symbol: "getRows",
      value: { kind: "Function", returns: [{ kind: "Array", elements: [{ kind: "JSX" }] }] },
      loc: { line: 3, column: 1 },
      isExported: false,
    });
    for (const name of ["ViewA", "ViewB"]) {
      fb.addDeclaration({
        symbol: name,
        value: {
          kind: "Function",
          returns: [
            {
              kind: "ReturnTypeOf",
              callee: { kind: "TypeOf", ref: { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 1, column: 1 }, originFile: "src/app.tsx" } },
              args: [],
            },
            { kind: "JSX" },
          ],
        },
        loc: { line: 5, column: 1 },
        isExported: true,
      });
      fb.addExport({ kind: "named", exportedAs: name, local: name });
    }
    fb.addJsxUsage({
      ref: { symbol: "Leaf", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 12 }, originFile: "src/app.tsx" },
      loc: { line: 3, column: 12 },
      props: [],
    });
    // Set ownerSymbolRef and a viaOverride: the viaOverride path bypasses
    // helper-call fanout.
    fb.setOwner(
      { symbol: "getRows", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 }, originFile: "src/app.tsx" },
      { kind: "prop-forward", bindingName: "slot", constructionSite: { file: "src/app.tsx", line: 3, column: 12 } },
    );

    const graph = gb.build();
    const { occurrences } = resolve(graph);

    expect(occurrences).toHaveLength(1); // not 2: fanout skipped
    expect(occurrences[0]?.viaChain).toHaveLength(1);
    expect(occurrences[0]?.viaChain[0]?.kind).toBe("prop-forward");
    // No helper-call hop should have been injected.
    expect(occurrences[0]?.viaChain.some((v) => v.kind === "helper-call")).toBe(false);
  });
});


describe("resolve(): JSX inside a factory body fans out to its products", () => {
  it("<Spinner/> inside withLoading attributes to Foo and Bar, never to withLoading", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/app.tsx");
    fb.addImport({ specifier: "ds-icons", imported: "Spinner", local: "Spinner", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    fb.addDeclaration({ symbol: "withLoading", value: { kind: "Function", returns: [{ kind: "Function", returns: [{ kind: "JSX" }] }] }, loc: { line: 2, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "FooView", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 3, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "BarView", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 4, column: 1 }, isExported: false });
    const wl = { symbol: "withLoading", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 1 }, originFile: "src/app.tsx" };
    fb.addDeclaration({ symbol: "Foo", value: { kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: wl }, args: [{ kind: "TypeOf", ref: { ...wl, symbol: "FooView" } }] }, loc: { line: 5, column: 1 }, isExported: true });
    fb.addDeclaration({ symbol: "Bar", value: { kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: wl }, args: [{ kind: "TypeOf", ref: { ...wl, symbol: "BarView" } }] }, loc: { line: 6, column: 1 }, isExported: true });
    // <Spinner/> lexically inside withLoading's body.
    fb.addJsxUsage({ ref: { symbol: "Spinner", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 30 } }, loc: { line: 2, column: 30 }, props: [] });
    fb.setOwner(wl);
    const graph = gb.build();
    const { occurrences } = resolve(graph);
    const spinner = occurrences.filter((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "Spinner");
    expect(spinner.map((o) => (o.rawOwnerComponentId?.kind === "react-component" ? o.rawOwnerComponentId.export : null)).sort()).toEqual(["Bar", "Foo"]);
    for (const o of spinner) expect(o.viaChain[0]).toMatchObject({ kind: "helper-call", callee: "withLoading" });
  });
});

describe("resolve(): render crediting and the out-of-graph non-code-file rule", () => {
  it("a JSX value bound to a variable and interpolated never becomes a component", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/a.tsx");
    fb.addDeclaration({ symbol: "br", value: { kind: "JSX" }, loc: { line: 1, column: 1 }, isExported: false });
    fb.addDeclaration({ symbol: "App", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: { line: 2, column: 1 }, isExported: true });
    fb.addJsxUsage({ ref: { symbol: "br", scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 } }, loc: { line: 3, column: 1 }, props: [] });
    const graph = gb.build();
    const { occurrences, registry } = resolve(graph);
    expect(registry.hasLocal("src/a.tsx", "br")).toBe(false);
    expect(occurrences.filter((o) => o.rawComponentId?.kind === "react-component" && o.rawComponentId.export === "br")).toHaveLength(0);
  });

  it("a rendered local component is admitted and a factory is never an identity", () => {
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/a.tsx");
    const at = (line: number) => ({ line, column: 1 });
    fb.addDeclaration({ symbol: "makeControl", value: { kind: "Function", returns: [{ kind: "Function", returns: [{ kind: "JSX" }] }] }, loc: at(1), isExported: false });
    fb.addImport({ specifier: "@example/design-system", imported: "Dropdown", local: "DropdownBase", scope: MODULE_SCOPE, loc: at(2) });
    fb.addDeclaration({
      symbol: "Dropdown",
      value: { kind: "ReturnTypeOf", callee: { kind: "TypeOf", ref: { symbol: "makeControl", scope: MODULE_SCOPE, memberChain: [], loc: at(3) } }, args: [{ kind: "TypeOf", ref: { symbol: "DropdownBase", scope: MODULE_SCOPE, memberChain: [], loc: at(3) } }] },
      loc: at(3),
      isExported: true,
    });
    fb.addJsxUsage({ ref: { symbol: "Dropdown", scope: MODULE_SCOPE, memberChain: [], loc: at(4) }, loc: at(4), props: [] });
    const graph = gb.build();
    const { occurrences } = resolve(graph);
    const ids = occurrences.map((o) => (o.rawComponentId?.kind === "react-component" ? o.rawComponentId.export : o.rawComponentId?.kind));
    expect(ids).toEqual(["Dropdown", "Dropdown"]);
    const render = occurrences.find((o) => o.via.kind === "local-component");
    expect(render?.rawComponentId?.source).toEqual({ type: "local", filePath: "src/a.tsx" });
    // The argument site credits the design-system component, owned by the product.
    const arg = occurrences.find((o) => o.via.kind === "passed-as-argument");
    expect(arg?.rawComponentId?.source).toMatchObject({ type: "external", package: "@example/design-system" });
    expect(arg?.rawOwnerComponentId).toMatchObject({ export: "Dropdown", source: { type: "local", filePath: "src/a.tsx" } });
    expect(arg?.via).toMatchObject({ kind: "passed-as-argument", callee: "makeControl", index: 0, specifier: "@example/design-system", import: "Dropdown" });
  });

  it("a Union of two unconsumed, unexported components resolving from one usage credits both", () => {
    // `const Comp = cond ? Alpha : Beta; <Comp/>`: a dynamic component
    // selection. Neither Alpha nor Beta is exported or directly JSX-used;
    // the single `<Comp/>` usage is what resolves through the Union to both,
    // and the tag credits each function it lands on.
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/a.tsx");
    const at = (line: number) => ({ line, column: 1 });
    fb.addDeclaration({ symbol: "Alpha", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: at(1), isExported: false });
    fb.addDeclaration({ symbol: "Beta", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: at(2), isExported: false });
    fb.addDeclaration({
      symbol: "Comp",
      value: {
        kind: "Union",
        types: [
          { kind: "TypeOf", ref: { symbol: "Alpha", scope: MODULE_SCOPE, memberChain: [], loc: at(1) } },
          { kind: "TypeOf", ref: { symbol: "Beta", scope: MODULE_SCOPE, memberChain: [], loc: at(2) } },
        ],
      },
      loc: at(3),
      isExported: false,
    });
    fb.addJsxUsage({ ref: { symbol: "Comp", scope: MODULE_SCOPE, memberChain: [], loc: at(4) }, loc: at(4), props: [] });
    const graph = gb.build();
    const { occurrences } = resolve(graph);
    const exports = occurrences
      .map((o) => (o.rawComponentId?.kind === "react-component" ? o.rawComponentId.export : null))
      .sort();
    expect(exports).toEqual(["Alpha", "Beta"]);
  });

  // The admission rule (a path outside the graph) is reached only
  // for a local identity pinned to a first-party path the bounded
  // resolver never walked into the graph (pinned through
  // `graph.resolveLocalDefinition`, gated on `graph.firstParty`); an
  // unresolvable relative import names nothing. `lazy(() => import(...))`
  // is the real-repo shape that reaches it: the DynamicImport
  // survives resolution as an identity-bearing leaf and `deriveIdentity`
  // names it `local`, pinned to its definition, once `firstParty` says yes.
  function buildLazyImportGraph(specifier: string, absTarget: string, symbol: string) {
    const gb = createGraphBuilder({ moduleResolver: (_from, spec) => (spec === specifier ? absTarget : null), repoRoot: "/repo" });
    const fb = gb.beginFile("src/a.tsx");
    fb.addImport({ specifier: "react", imported: "lazy", local: "lazy", scope: MODULE_SCOPE, loc: { line: 1, column: 1 } });
    fb.addDeclaration({
      symbol,
      value: {
        kind: "ReturnTypeOf",
        callee: { kind: "TypeOf", ref: { symbol: "lazy", scope: MODULE_SCOPE, memberChain: [], loc: { line: 2, column: 1 } } },
        args: [
          { kind: "Function", returns: [{ kind: "DynamicImport", specifier, projection: [], originFile: "src/a.tsx" }] },
        ],
      },
      loc: { line: 2, column: 1 },
      isExported: false,
    });
    fb.addJsxUsage({ ref: { symbol, scope: MODULE_SCOPE, memberChain: [], loc: { line: 3, column: 1 } }, loc: { line: 3, column: 1 }, props: [] });
    return gb.build({ firstParty: (abs) => abs === absTarget });
  }

  it("a local identity pinned to a non-code file (a lazy PNG import, workspace-member-pinned but never walked) is not admitted", () => {
    const graph = buildLazyImportGraph("./hero.png", "/repo/src/hero.png", "Hero");
    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(0);
  });

  it("an extensionless out-of-graph path (a lazy `./PhoneInput` the bounded resolver pinned but never walked) is admitted", () => {
    const graph = buildLazyImportGraph("./PhoneInput", "/repo/src/PhoneInput", "PhoneInput");
    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "default",
      source: { type: "local", filePath: "/repo/src/PhoneInput" },
    });
  });

  it("an uppercase non-code extension (`.SVG`) is still rejected: the code-extension check is case-insensitive on both sides", () => {
    const graph = buildLazyImportGraph("./hero.SVG", "/repo/src/hero.SVG", "Hero");
    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(0);
  });

  it("a component namespace (`const NS = { Root }`) rendered as `<NS.Root/>` resolves to the member", () => {
    // `export const Sidebar = { Root, Branch, Leaf }` consumed as
    // `<Sidebar.Root/>` from another file: the walker's static-member arm
    // walks into the referenced prop and derives identity from Root's own
    // declaration, not from the namespace holder `Sidebar`. When the member
    // is a reference to a component, the holder only carries the render site
    // to it. An inline-function member (`{ Inline: () => <div/> }`) still
    // mints a row under the namespace name.
    const repoRoot = "/repo";
    const resolver = (from: string, spec: string) => (spec === "./nav" && from === "/repo/src/consumer.tsx" ? "/repo/src/nav.tsx" : null);
    const gb = createGraphBuilder({ moduleResolver: resolver, repoRoot });
    const at = (line: number) => ({ line, column: 1 });

    const nav = gb.beginFile("src/nav.tsx");
    nav.addDeclaration({ symbol: "Root", value: { kind: "Function", returns: [{ kind: "JSX" }] }, loc: at(1), isExported: false });
    nav.addDeclaration({
      symbol: "Sidebar",
      value: { kind: "Object", props: { Root: { kind: "TypeOf", ref: { symbol: "Root", scope: MODULE_SCOPE, memberChain: [], loc: at(1), originFile: "src/nav.tsx" } } } },
      loc: at(2),
      isExported: true,
    });
    nav.addExport({ kind: "named", exportedAs: "Sidebar", local: "Sidebar" });

    const consumer = gb.beginFile("src/consumer.tsx");
    consumer.addImport({ specifier: "./nav", imported: "Sidebar", local: "Sidebar", scope: MODULE_SCOPE, loc: at(1) });
    consumer.addJsxUsage({ ref: { symbol: "Sidebar", scope: MODULE_SCOPE, memberChain: ["Root"], loc: at(2) }, loc: at(2), props: [] });

    const graph = gb.build();
    const { occurrences } = resolve(graph);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Root",
      source: { type: "local", filePath: "src/nav.tsx" },
    });
  });
});
