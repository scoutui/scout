/**
 * Engine-arm shapes: wrapper / alias / factory family, on real parser
 * output.
 */
import { describe, it, expect } from "vitest";
import { scan, relResolver, idsOf } from "./shape-helpers.js";

describe("wrapper / alias / factory", () => {
  it("resolves `const el = <Foo/>; return el` to the external import", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Foo } from "pkg";
        export function App() { const el = <Foo />; return el; }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      kind: "react-component",
      export: "Foo",
      source: { type: "external", package: "pkg" },
    });
    expect(occs[0]?.via).toMatchObject({ kind: "direct-import" });
  });

  // A createComponent-style local factory with forwardRef+memo inside.
  it("resolves a local `createComponent(render)` factory to both the inner import and the local product", () => {
    const occs = scan({
      "src/App.tsx": `
        import { forwardRef, memo } from "react";
        import { Foo } from "pkg";
        function createComponent(render) { return memo(forwardRef(render)); }
        const Btn = createComponent((props, ref) => <Foo {...props} ref={ref} />);
        export function App() { return <Btn />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "Btn", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
  });

  it("resolves both branches of a conditional-return component under `memo`", () => {
    const occs = scan({
      "src/App.tsx": `
        import { memo } from "react";
        import { Foo, Bar } from "pkg";
        const C = memo(({ x }) => { if (x) return <Foo />; return <Bar />; });
        export function App() { return <C />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "Bar", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "C", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
  });

  it("resolves `const Item = RadioArea` to the aliased external import", () => {
    const occs = scan({
      "src/App.tsx": `
        import { RadioArea } from "pkg";
        const Item = RadioArea;
        export function App() { return <Item />; }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      export: "RadioArea",
      source: { type: "external", package: "pkg" },
    });
  });

  // Known gap: the body states the correct answer.
  it.fails("names the import a same-file alias reads, as a direct render of that import does", () => {
    const occs = scan({
      "src/App.tsx": `
        import { RadioArea } from "pkg";
        const Item = RadioArea;
        export function App() { return <Item />; }
      `,
    });
    expect(occs[0]?.viaChain).toContainEqual(expect.objectContaining({ specifier: "pkg", import: "RadioArea" }));
  });

  it("resolves `React.memo(View, areEqual)` reached through a cross-file default import", () => {
    const occs = scan(
      {
        "src/App.tsx": `
          import React from "react";
          import { Foo } from "pkg";
          const View = () => <Foo />;
          export default React.memo(View, () => true);
        `,
        "src/Page.tsx": `
          import V from "./App";
          export function Page() { return <V />; }
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "View", package: undefined, filePath: "src/App.tsx", via: "direct-import" },
    ]);
    // The memoised default is reached across files by a default import, so the
    // chain heads with direct-import; `R.memo(View, cmp)` below is reached from
    // a same-file binding and heads with local-component.
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["direct-import", "hoc-wrapper"]);
  });

  it("resolves `import * as R from 'react'; R.forwardRef(fn)`", () => {
    const occs = scan({
      "src/App.tsx": `
        import * as R from "react";
        import { Foo } from "pkg";
        export const B = R.forwardRef((props, ref) => <Foo {...props} />);
        export function App() { return <B />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "B", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["local-component", "hoc-wrapper"]);
  });

  it("resolves the two-argument namespace-import call `R.memo(View, cmp)`", () => {
    const occs = scan({
      "src/App.tsx": `
        import * as R from "react";
        import { Foo } from "pkg";
        const View = () => <Foo />;
        export const M = R.memo(View, () => true);
        export function App() { return <M />; }
      `,
    });
    expect(idsOf(occs)).toEqual([
      { export: "Foo", package: "pkg", filePath: undefined, via: "direct-import" },
      { export: "View", package: undefined, filePath: "src/App.tsx", via: "local-component" },
    ]);
    expect(occs[1]?.viaChain?.map((v) => v.kind)).toEqual(["local-component", "hoc-wrapper"]);
  });
});

describe("a wrapped argument's hoc-wrapper provenance", () => {
  const hocHop = (files: Record<string, string>) =>
    scan(files, relResolver("/repo"), "/repo")
      .find((o) => o.viaChain[0]?.kind === "direct-import" && o.viaChain[0].specifier === "./w")
      ?.viaChain.find((v) => v.kind === "hoc-wrapper");

  it("does not name the rendering file's import of the same name for a declared argument", () => {
    const w = `
      import { memo } from "react";
      const X = () => <b />;
      export default memo(X);
    `;
    const collides = hocHop({
      "src/w.tsx": w,
      "src/App.tsx": `
        import { X } from "@acme/ui";
        import W from "./w";
        export function App() { return <div><W /><X /></div>; }
      `,
    });
    const alone = hocHop({
      "src/w.tsx": w,
      "src/App.tsx": `
        import W from "./w";
        export function App() { return <W />; }
      `,
    });
    expect(alone).toEqual({ kind: "hoc-wrapper", hocCallee: "memo" });
    expect(collides).toEqual(alone);
  });

  it("names the import the argument's own file reads it through", () => {
    const hop = hocHop({
      "src/w.tsx": `
        import { memo } from "react";
        import { X } from "./x";
        export default memo(X);
      `,
      "src/x.tsx": "export const X = () => <b />;",
      "src/App.tsx": `
        import W from "./w";
        export function App() { return <W />; }
      `,
    });
    expect(hop).toEqual({ kind: "hoc-wrapper", hocCallee: "memo", specifier: "./x", import: "X" });
  });

  it("names no import for an argument declared in a file", () => {
    const hop = hocHop({
      "src/w.tsx": `
        import { forwardRef } from "react";
        const Field = (props, ref) => <input ref={ref} />;
        export default forwardRef(Field);
      `,
      "src/App.tsx": `
        import Field from "./w";
        export function App() { return <Field />; }
      `,
    });
    expect(hop).toEqual({ kind: "hoc-wrapper", hocCallee: "forwardRef" });
  });
});
