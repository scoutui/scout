/**
 * Engine-arm shapes: iteration / indirection family.
 *
 * A map-bodied component resolves directly, through `memo`, through `MAP[k]`
 * and through a ternary alias. The three control tests run the same
 * indirections with plain-bodied and import-valued components.
 */
import { describe, it, expect } from "vitest";
import { scan, idsOf, relResolver } from "./shape-helpers.js";

/** Shorthand: the single external `Foo` identity every shape here bottoms out in. */
const FOO_EXTERNAL = {
  kind: "react-component",
  export: "Foo",
  source: { type: "external", package: "pkg" },
};

describe("iteration / indirection", () => {
  it("resolves a hook-return leaf: `const { modals } = useX(); return modals;`", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        function useX() { return { modals: <Foo /> }; }
        export function App() { const { modals } = useX(); return modals; }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject(FOO_EXTERNAL);
    expect(occs[0]?.viaChain?.map((v) => v.kind)).toEqual(["helper-call", "direct-import"]);
  });

  // A map-bodied component rendered directly. The `List` row is what the
  // indirection tests below also expect.
  it("keeps a `.map()`-bodied component's own row when rendered directly", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        const List = ({ items }) => items.map((i) => <Foo key={i} />);
        export function App() { return <List items={[]} />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "List", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
  });

  it("keeps a `.map()`-bodied component's own row through `memo`", () => {
    const occs = scan({
      "src/App.tsx": `
        import { memo } from "react";
        import { Foo } from "pkg";
        const List = memo(({ items }) => items.map((i) => <Foo key={i} />));
        export function App() { return <List items={[]} />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "List", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["local-component", "hoc-wrapper"]);
  });

  // ---------------------------------------------------------------------
  // Map-bodied components through an indirection, and their controls:
  // neither the indirection alone nor a .map() body alone loses anything.
  // ---------------------------------------------------------------------

  // The shape the react-shapes fixture uses in `src/dynamic-map`.
  it("control: an import-valued `MAP[k]` emits every entry with dynamic-map provenance", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Button, Card } from "pkg";
        const MAP = { button: Button, card: Card };
        export function App({ t }) { const C = MAP[t]; return <C />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Button", package: "pkg", filePath: undefined, via: "local-component" },
      { export: "Card", package: "pkg", filePath: undefined, via: "local-component" },
    ]);
    for (const occ of occs) {
      expect(occ.viaChain?.map((v) => v.kind)).toEqual(["local-component", "dynamic-map"]);
    }
  });

  it("control: a plain-bodied local component keeps its row through `MAP[k]`", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        const Leafy = () => <Foo />;
        const MAP = { leafy: Leafy };
        export function App({ k }) { const C = MAP[k]; return <C />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "Leafy", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["local-component", "dynamic-map"]);
  });

  it("control: both plain-bodied locals keep their rows through `cond ? A : B`", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        const A = () => <Foo />;
        const B = () => <Foo />;
        export function App({ c }) { const C = c ? A : B; return <C />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "A", package: undefined, filePath: "src/App.tsx", via: "local-component" },
      { export: "B", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
  });

  // A map-bodied component through `MAP[k]` keeps the row it gets when
  // rendered directly.
  it("keeps a map-bodied component's row and dynamic-map provenance through `MAP[k]`", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        const List = ({ items }) => items.map((i) => <Foo key={i} />);
        const MAP = { list: List };
        export function App({ k }) { const C = MAP[k]; return <C />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "List", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["local-component", "dynamic-map"]);
  });

  // Through the TypeOf arm: a returned JSX-value alias is not a component,
  // so `priceElement` never becomes a row and `Price` (the engine's own
  // fallback, the rendered declaration) wins.
  it("does not turn a returned JSX-value alias into a component row", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        export function Price() { const priceElement = <Foo />; return priceElement; }
        export function App() { return <Price />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "Price", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
  });

  // The other exclusion: an alias of a parameter binding mints no row either.
  // `X` names an argument, not a component; the `ParameterOf` clause in the
  // TypeOf arm's identity stamp keeps the shared `argMap` from minting a
  // phantom `X` row alongside the real `Foo`.
  it("does not turn an alias of a component-valued parameter into a component row", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        function Wrap({ C }) { const X = C; return <X />; }
        export function App() { return <Wrap C={Foo} />; }
      `,
    });
    expect(idsOf(occs).filter((o) => o.export === "X")).toEqual([]);
  });

  // An alias of a wrapper product keeps the wrapper hop: the TypeOf arm
  // re-enters walkReturnTypeOf instead of letting the algebra flatten it.
  it("keeps the hoc-wrapper hop through a plain alias of a memo product", () => {
    const occs = scan({
      "src/App.tsx": `
        import { memo } from "react";
        import { Foo } from "pkg";
        const MemoFoo = memo(Foo);
        const Alias = MemoFoo;
        export function App() { return <Alias />; }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject(FOO_EXTERNAL);
    expect(occs[0]?.viaChain?.map((v) => v.kind)).toEqual(["local-component", "hoc-wrapper"]);
  });

  // Across files: the map entry is an imported map-bodied component.
  it("resolves a cross-file map-bodied component through `MAP[k]`", () => {
    const occs = scan(
      {
        "src/List.tsx": `
          import { Foo } from "pkg";
          export const List = ({ items }) => items.map((i) => <Foo key={i} />);
        `,
        "src/App.tsx": `
          import { List } from "./List";
          const MAP = { list: List };
          export function App({ k }) { const C = MAP[k]; return <C />; }
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "List", package: undefined, filePath: "src/List.tsx", via: "local-component" },
    ]);
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["local-component", "dynamic-map"]);
  });

  // The map-bodied branch `A` and the plain-bodied `B` of the same
  // expression both resolve.
  it("keeps a map-bodied branch of `cond ? A : B` like the plain branch", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        const A = ({ items }) => items.map((i) => <Foo key={i} />);
        const B = () => <Foo />;
        export function App({ c }) { const C = c ? A : B; return <C />; }
      `,
    });
    const locals = idsOf(occs).filter((o) => o.filePath === "src/App.tsx");
    expect(locals.map((o) => o.export).sort()).toEqual(["A", "B"]);
  });

  it("resolves a `Children.map(children, cb)`-bodied wrapper, and credits the wrapper at its own tag", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Children } from "react";
        import { Foo } from "pkg";
        const W = ({ children }) => Children.map(children, (c) => <Foo>{c}</Foo>);
        export function App() { return <W />; }
      `,
    });
    expect(occs).toHaveLength(2);
    expect(occs[0]?.rawComponentId).toMatchObject(FOO_EXTERNAL);
    expect(occs[0]?.rawOwnerComponentId).toMatchObject({ export: "W" });
    expect(occs[0]?.viaChain?.map((v) => v.kind)).toEqual(["direct-import"]);
    expect(occs[1]?.rawComponentId).toMatchObject({ export: "W", source: { type: "local", filePath: "src/App.tsx" } });
    expect(occs[1]?.rawOwnerComponentId).toMatchObject({ export: "App" });
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["local-component"]);
  });

  it("resolves `.map` over an array imported from an external package, and credits the wrapper at its own tag", () => {
    const occs = scan({
      "src/App.tsx": `
        import { items, Foo } from "pkg";
        const W = () => items.map((i) => <Foo key={i} />);
        export function App() { return <W />; }
      `,
    });
    expect(occs).toHaveLength(2);
    expect(occs[0]?.rawComponentId).toMatchObject(FOO_EXTERNAL);
    expect(occs[0]?.rawOwnerComponentId).toMatchObject({ export: "W" });
    expect(occs[0]?.viaChain?.map((v) => v.kind)).toEqual(["direct-import"]);
    expect(occs[1]?.rawComponentId).toMatchObject({ export: "W", source: { type: "local", filePath: "src/App.tsx" } });
    expect(occs[1]?.rawOwnerComponentId).toMatchObject({ export: "App" });
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["local-component"]);
  });
});
