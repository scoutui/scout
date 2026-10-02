/**
 * On real parser output: a bare lowercase-initial declaration is neither
 * a registry member nor an owner. The argument-site interaction only fires
 * on real parser shapes.
 */
import { describe, it, expect } from "vitest";
import { scanGraph, relResolver } from "./shape-helpers.js";

type Resolved = ReturnType<typeof scanGraph>;
const members = (r: Resolved) => r.registry.localEntries().map((e) => `${e.filePath}::${e.symbol}`).sort();
const exportOf = (id: Resolved["occurrences"][number]["rawComponentId"]) =>
  id?.kind === "react-component" ? id.export : "";

describe("host-element-named declarations are not registry members", () => {
  it("`const dirname = path.dirname(fileURLToPath(import.meta.url))` is not a component", () => {
    const files = {
      "src/generate.ts": `
        import path from "node:path";
        import { fileURLToPath } from "node:url";
        const dirname = path.dirname(fileURLToPath(import.meta.url));
        export const ICONS = path.join(dirname, "icons");
      `,
    };
    const r = scanGraph(files, relResolver("/repo"), "/repo");
    // `ICONS` stays: it is the same opaque-wrapper shape, but its name could
    // be rendered, so this rule does not apply (diagnostics cover it).
    expect(members(r)).toEqual(["src/generate.ts::ICONS"]);
  });

  it("a lowercase JSX-returning declaration is out; its PascalCase twin is in", () => {
    const files = {
      "src/deal.tsx": `
        export function getDealDuration() { return <span>30 days</span>; }
        export function DealDuration() { return <span>30 days</span>; }
      `,
    };
    const r = scanGraph(files, relResolver("/repo"), "/repo");
    expect(members(r)).toEqual(["src/deal.tsx::DealDuration"]);
  });

  it("an anonymous default-export arrow survives (its symbol is `default`)", () => {
    const files = { "src/Anon.tsx": "export default () => <div />;" };
    const r = scanGraph(files, relResolver("/repo"), "/repo");
    expect(members(r)).toEqual(["src/Anon.tsx::default"]);
  });

  it("a lowercase local that is the default export survives", () => {
    const files = { "src/view.tsx": "const view = () => <div />;\nexport default view;" };
    const r = scanGraph(files, relResolver("/repo"), "/repo");
    expect(members(r)).toEqual(["src/view.tsx::view"]);
  });

  it("a lowercase local exported under a component name survives", () => {
    const files = { "src/b.tsx": "const helper = () => <div />;\nexport { helper as Button };" };
    const r = scanGraph(files, relResolver("/repo"), "/repo");
    expect(members(r)).toEqual(["src/b.tsx::helper"]);
  });
});

describe("host-element-named holders still credit their arguments", () => {
  // The factory shape: a visible factory whose product is its own
  // identity, so the wrapped component is credited at the argument site
  // rather than by a fold. The product here is lowercase-named.
  const FILES = {
    "src/Button.tsx": "export const Button = () => <button />;",
    "src/make-control.tsx": `
      export const makeControl = (Component) => (props) => <Component {...props} />;
    `,
    "src/harness.tsx": `
      import { makeControl } from "./make-control";
      import { Button } from "./Button";
      export const buttonHarness = makeControl(Button);
    `,
  };

  it("the holder has no roster row, but its argument is still credited at the argument site", () => {
    const r = scanGraph(FILES, relResolver("/repo"), "/repo");
    expect(r.registry.hasLocal("src/harness.tsx", "buttonHarness")).toBe(false);

    const seeded = r.occurrences.filter((o) => o.via.kind === "passed-as-argument");
    expect(seeded.map((o) => exportOf(o.rawComponentId))).toEqual(["Button"]);
    expect(seeded[0]?.rawOwnerComponentId).toBeUndefined();
  });
});

describe("host-element-named declarations are helpers, not owners", () => {
  const FILES = {
    "src/ActionItem.tsx": "export const ActionItem = () => <li />;",
    "src/renderActionItem.tsx": `
      import { ActionItem } from "./ActionItem";
      export const renderActionItem = () => <ActionItem />;
    `,
    "src/Panel.tsx": `
      import { renderActionItem } from "./renderActionItem";
      export const Panel = () => <div>{renderActionItem()}</div>;
    `,
  };

  it("a render helper does not own the components it renders; the calling component does", () => {
    const r = scanGraph(FILES, relResolver("/repo"), "/repo");
    expect(members(r)).toEqual(["src/ActionItem.tsx::ActionItem", "src/Panel.tsx::Panel"]);

    const actionItem = r.occurrences.filter((o) => exportOf(o.rawComponentId) === "ActionItem");
    expect(actionItem).toHaveLength(1);
    expect(actionItem[0]?.rawOwnerComponentId).toMatchObject({
      export: "Panel",
      source: { type: "local", filePath: "src/Panel.tsx" },
    });
    expect(actionItem[0]?.viaChain.some((v) => v.kind === "helper-call")).toBe(true);
  });
});
