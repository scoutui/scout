/**
 * A holder whose call folds entirely to other identities is not a
 * registry member. Every row of the behaviour table, through the real
 * pipeline (oxc → emitReact → resolve).
 */
import { describe, it, expect } from "vitest";
import { scanGraph, relResolver } from "./shape-helpers.js";

/** `file::symbol` plus `!` when isDefault, sorted: the roster in one string each. */
function roster(g: ReturnType<typeof scanGraph>) {
  return g.registry.localEntries().map((e) => `${e.filePath}::${e.symbol}${e.isDefault ? "!" : ""}`).sort();
}
function renders(g: ReturnType<typeof scanGraph>) {
  return g.occurrences.map((o) => {
    const id = o.rawComponentId;
    if (id === undefined) throw new Error(`unresolved occurrence at ${o.filePath}:${o.line}`);
    const name = id.kind === "custom-element" ? id.tagName : id.export;
    const where = id.source.type === "local" ? id.source.filePath : id.source.type === "external" ? id.source.package : "?";
    return `${o.filePath}:${o.line} ${name}@${where}`;
  }).sort();
}

const APP_DEFAULT = `
  import Composer from "./Composer";
  export function App() { return <Composer />; }
`;

describe("folded holders: default-export wrappers", () => {
  it("`export default forwardRef(Composer)`: Composer is the only member and inherits isDefault; the render lands on Composer", () => {
    const g = scanGraph(
      {
        "src/Composer.tsx": `
          import { forwardRef } from "react";
          const Composer = (props, ref) => <div ref={ref} />;
          export default forwardRef(Composer);
        `,
        "src/App.tsx": APP_DEFAULT,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(roster(g)).toEqual(["src/App.tsx::App", "src/Composer.tsx::Composer!"]);
    expect(renders(g)).toEqual(["src/App.tsx:3 Composer@src/Composer.tsx"]);
  });

  it("`export default memo(Page)` in a framework-root file: Page inherits isDefault (root eligibility)", () => {
    const g = scanGraph(
      {
        "src/app/page.tsx": `
          import { memo } from "react";
          const Page = () => <main />;
          export default memo(Page);
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(roster(g)).toEqual(["src/app/page.tsx::Page!"]);
  });

  it("plain `export default Composer;` is unchanged: one member, isDefault", () => {
    const g = scanGraph(
      {
        "src/Composer.tsx": `
          const Composer = () => <div />;
          export default Composer;
        `,
        "src/App.tsx": APP_DEFAULT,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(roster(g)).toEqual(["src/App.tsx::App", "src/Composer.tsx::Composer!"]);
  });

  it("`export default styled(Button)` with an external Button is never admitted, so the folded-holder exclusion never sees it (reachability pin)", () => {
    // The base registry does not admit a holder whose callee and arguments are
    // unresolvable imports, so this row pins reachability, not exclusion.
    const g = scanGraph({
      "src/a.tsx": `
        import styled from "styled-components";
        import { Button } from "pkg";
        export default styled(Button)\`color: red;\`;
      `,
    });
    expect(roster(g)).toEqual([]);
  });

  it("`export default memo(Other)` with Other imported from another file: the holder goes, Other does not inherit isDefault", () => {
    const g = scanGraph(
      {
        "src/other.tsx": "export const Other = () => <div />;",
        "src/a.tsx": `
          import { memo } from "react";
          import { Other } from "./other";
          export default memo(Other);
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(roster(g)).toEqual(["src/other.tsx::Other"]);
  });
});

describe("folded holders: named holders and the holders that stay", () => {
  it("`export const Enhanced = connect()(Foo)`: Enhanced goes, Foo stays, the render lands on Foo", () => {
    const g = scanGraph(
      {
        "src/Foo.tsx": `
          import { connect } from "react-redux";
          const Foo = () => <div />;
          export const Enhanced = connect()(Foo);
        `,
        "src/App.tsx": `
          import { Enhanced } from "./Foo";
          export function App() { return <Enhanced />; }
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(roster(g)).toEqual(["src/App.tsx::App", "src/Foo.tsx::Foo"]);
    expect(renders(g)).toEqual(["src/App.tsx:3 Foo@src/Foo.tsx"]);
  });

  it("`export const Input = memo(makeControl(InputBase))`: Input stays, since its fold has no identity of its own", () => {
    const g = scanGraph(
      {
        "src/factory.tsx": "export function makeControl(Base) { return (props) => <Base {...props} />; }",
        "src/fields.tsx": `
          import { memo } from "react";
          import { makeControl } from "./factory";
          const InputBase = (p) => <input />;
          export const Input = memo(makeControl(InputBase));
        `,
        "src/App.tsx": `
          import { Input } from "./fields";
          export function App() { return <Input />; }
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(roster(g)).toEqual(["src/App.tsx::App", "src/fields.tsx::Input", "src/fields.tsx::InputBase"]);
    expect(renders(g)).toEqual(["src/App.tsx:3 Input@src/fields.tsx", "src/fields.tsx:5 InputBase@src/fields.tsx"]);
  });

  it("`export default forwardRef((p, r) => <b/>, Other)`: the holder is the component and stays", () => {
    const g = scanGraph({
      "src/a.tsx": `
        import { forwardRef } from "react";
        import { Other } from "pkg";
        export default forwardRef((p, r) => <b />, Other);
      `,
    });
    expect(roster(g)).toEqual(["src/a.tsx::default!"]);
  });

  it("`memo(cond ? A : B)`: fans out to two identities, holder goes, no isDefault transfer", () => {
    const g = scanGraph({
      "src/a.tsx": `
        import { memo } from "react";
        const A = () => <div />;
        const B = () => <span />;
        declare const cond: boolean;
        export default memo(cond ? A : B);
      `,
    });
    // Both branches are held by the call, so both are members; the
    // holder folds away and neither inherits its isDefault.
    expect(roster(g)).toEqual(["src/a.tsx::A", "src/a.tsx::B"]);
  });

  it("`memo(cond ? A : () => <div/>)`: one identity-less branch keeps the holder", () => {
    const g = scanGraph({
      "src/a.tsx": `
        import { memo } from "react";
        const A = () => <div />;
        declare const cond: boolean;
        export default memo(cond ? A : () => <div />);
      `,
    });
    expect(roster(g)).toEqual(["src/a.tsx::A", "src/a.tsx::default!"]);
  });

  it("a Union-valued holder (`cond ? memo(A) : B`) is not visited and stays (outside the folded-holder exclusion)", () => {
    const g = scanGraph({
      "src/a.tsx": `
        import { memo } from "react";
        const A = () => <div />;
        const B = () => <span />;
        declare const cond: boolean;
        export const Pick = cond ? memo(A) : B;
      `,
    });
    expect(roster(g)).toContain("src/a.tsx::Pick");
  });
});
