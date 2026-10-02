/**
 * Static member access through the walker.
 *
 * `const Comp = MAP.memo`, where `MAP.memo` is a `memo(Button)` product,
 * attributes to Button with the `hoc-wrapper(memo)` hop: the same chain a
 * direct `<MemoButton/>` gets.
 */
import { describe, it, expect } from "vitest";
import { scan } from "./shape-helpers.js";

const FOO_EXTERNAL = {
  kind: "react-component",
  export: "Foo",
  source: { type: "external", package: "pkg" },
};

describe("static member access", () => {
  it("keeps the hoc-wrapper hop for a memo product reached through `MAP.memo`", () => {
    const occs = scan({
      "src/App.tsx": `
        import { memo } from "react";
        import { Foo } from "pkg";
        const MemoFoo = memo(Foo);
        const MAP = { memo: MemoFoo };
        export function App() { const Comp = MAP.memo; return <Comp />; }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject(FOO_EXTERNAL);
    expect(occs[0]?.viaChain?.map((v) => v.kind)).toEqual(["local-component", "hoc-wrapper"]);
    expect(occs[0]?.viaChain?.[1]).toMatchObject({ kind: "hoc-wrapper", hocCallee: "memo" });
  });

  it("emits nothing for a static member that does not exist on the object", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        const MAP = { a: Foo };
        export function App() { const Comp = MAP.missing; return <Comp />; }
      `,
    });
    expect(occs).toHaveLength(0);
  });
});

describe("cyclic member graphs terminate", () => {
  // A mutually-recursive component map is legal, loadable JavaScript (the
  // member reads are lazy, inside the arrow bodies). The walker's member arms
  // re-enter themselves through it, so without a cycle guard the scan aborts
  // the whole run with a RangeError.
  it("terminates on a mutually-recursive object map reached through a static member", () => {
    const occs = scan({
      "src/App.tsx": `
        const A = { Item: () => B.Item };
        const B = { Item: () => A.Item };
        const C = A.Item;
        export function App() { return <C />; }
      `,
    });
    expect(occs.map((o) => [(o.rawComponentId as { export?: string }).export, o.viaChain.map((v) => v.kind).join(">")])).toEqual([
      ["C", "local-component"],
    ]);
  });

  it("terminates on the same cycle reached through a dynamic member", () => {
    const occs = scan({
      "src/App.tsx": `
        const A = { Item: () => B.Item };
        const B = { Item: () => A.Item };
        export function App({ k }) { const C = A[k]; return <C />; }
      `,
    });
    expect(occs.map((o) => [(o.rawComponentId as { export?: string }).export, o.viaChain.map((v) => v.kind).join(">")])).toEqual([
      ["C", "local-component>dynamic-map"],
    ]);
  });

  it("terminates on the eager (TDZ) form of the same cycle", () => {
    const occs = scan({
      "src/App.tsx": `
        const A = { Item: B.Item };
        const B = { Item: A.Item };
        const C = A.Item;
        export function App() { return <C />; }
      `,
    });
    expect(occs).toHaveLength(0);
  });
});
