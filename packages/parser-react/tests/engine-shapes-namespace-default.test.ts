/**
 * Engine-arm shapes: namespace-object and default-export family.
 *
 * `styled(NS.Button)` is a known gap, recorded as `it.fails`: its body
 * states the correct answer, so it goes red once the engine handles the
 * shape, and the fix is to remove `.fails`.
 */
import { describe, it, expect } from "vitest";
import { createDiagnosticCollector } from "@scoutui/reference-graph";
import { scan, relResolver, idsOf } from "./shape-helpers.js";

describe("namespace objects", () => {
  it("resolves a cross-file `export const NS = { Root, Leaf }` rendered as `<NS.Root/>`", () => {
    const occs = scan(
      {
        "src/ns.tsx": `
          import { Root, Leaf } from "pkg";
          export const NS = { Root, Leaf };
        `,
        "src/App.tsx": `
          import { NS } from "./ns";
          export function App() { return <NS.Root />; }
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      export: "Root",
      source: { type: "external", package: "pkg" },
    });
    expect(occs[0]?.via).toMatchObject({ kind: "direct-import" });
  });

  it("resolves a same-file `const NS = { Root, Leaf }` rendered as `<NS.Root/>` to Root", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Root, Leaf } from "pkg";
        export const NS = { Root, Leaf };
        export function App() { return <NS.Root />; }
      `,
    });
    expect(occs).toHaveLength(1);
    expect(occs[0]?.rawComponentId).toMatchObject({
      export: "Root",
      source: { type: "external", package: "pkg" },
    });
  });
});

describe("default exports", () => {
  it("resolves `const V = () => <Foo/>; export { V as default }` consumed cross-file", () => {
    const occs = scan(
      {
        "src/App.tsx": `
          import { Foo } from "pkg";
          const V = () => <Foo />;
          export { V as default };
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
      { export: "V", package: undefined, filePath: "src/App.tsx", via: "direct-import" },
    ]);
  });

  // An anonymous default-export arrow is a component in its own right, as
  // the named-binding form above is.
  it("`export default () => <Foo/>` emits the inner Foo and the cross-file usage", () => {
    const occs = scan(
      {
        "src/App.tsx": `
          import { Foo } from "pkg";
          export default () => <Foo />;
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
      { export: "default", package: undefined, filePath: "src/App.tsx", via: "direct-import" },
    ]);
  });
});

describe("import-backed argument through a member expression", () => {
  // Known gap: the body states the correct answer. Today styled(NS.Button)`…`
  // emits nothing, because the tagged-template call over `styled(…)` hides its
  // argument, whether reached through a namespace member or imported by name.
  it.fails("resolves <S/> to the external Button for a tagged-template `styled(NS.Button)`", () => {
    const occs = scan({
      "src/App.tsx": `
        import styled from "styled-components";
        import * as NS from "pkg";
        const S = styled(NS.Button)\`color:red\`;
        export function App() { return <S />; }
      `,
    });
    expect(occs.length).toBeGreaterThan(0);
    expect(occs[0]?.rawComponentId).toMatchObject({
      export: "Button",
      source: { type: "external", package: "pkg" },
    });
  });
});

describe("members with no declaration of their own (compound identity)", () => {
  it("`import { Dialog as DialogPrimitive } from \"pkg/dialog\"; <DialogPrimitive.Popup/>` → `Dialog.Popup` on pkg", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Dialog as DialogPrimitive } from "pkg/dialog";
        export function App() { return <DialogPrimitive.Popup />; }
      `,
    });
    expect(idsOf(occs)).toEqual([{ export: "Dialog.Popup", package: "pkg", filePath: undefined, via: "direct-import" }]);
  });

  it("sibling members of a named import get sibling rows, and the bare holder keeps its own", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Dialog } from "pkg";
        export function App() {
          return <Dialog><Dialog.Popup><Dialog.Close /></Dialog.Popup></Dialog>;
        }
      `,
    });
    expect(idsOf(occs).map((i) => i.export).sort()).toEqual(["Dialog", "Dialog.Close", "Dialog.Popup"]);
  });

  it("a default-import holder → `default.Header` with the module path", () => {
    const occs = scan({
      "src/App.tsx": `
        import Modal from "pkg/Modal";
        export function App() { return <Modal.Header />; }
      `,
    });
    expect(occs[0]?.rawComponentId).toEqual({
      kind: "react-component",
      export: "default.Header",
      source: { type: "external", package: "pkg", publicEntry: "Modal" },
    });
  });

  it("`import * as Dialog; <Dialog.Root.Foo/>` → `Root.Foo` (first segment is the export)", () => {
    const occs = scan({
      "src/App.tsx": `
        import * as Dialog from "pkg";
        export function App() { return <Dialog.Root.Foo />; }
      `,
    });
    expect(idsOf(occs)).toEqual([{ export: "Root.Foo", package: "pkg", filePath: undefined, via: "direct-import" }]);
  });

  it("`export const NS = { Inline: () => <div/> }` rendered as `<NS.Inline/>` → `NS.Inline` on ns.tsx", () => {
    const occs = scan(
      {
        "src/ns.tsx": `
          export const NS = { Inline: () => <div /> };
        `,
        "src/App.tsx": `
          import { NS } from "./ns";
          export function App() { return <NS.Inline />; }
        `,
      },
      relResolver("/repo"),
      "/repo",
    );
    expect(idsOf(occs)).toEqual([{ export: "NS.Inline", package: undefined, filePath: "src/ns.tsx", via: "direct-import" }]);
  });

  it("the same shape declared in the rendering file → `NS.Inline` on that file, via local-component", () => {
    const occs = scan({
      "src/App.tsx": `
        export const NS = { Inline: () => <div /> };
        export function App() { return <NS.Inline />; }
      `,
    });
    expect(idsOf(occs)).toEqual([{ export: "NS.Inline", package: undefined, filePath: "src/App.tsx", via: "local-component" }]);
  });

  it("a member that renders an external component still names the member, and the inner usage is its own row", () => {
    const occs = scan({
      "src/App.tsx": `
        import { Button } from "pkg";
        export const NS = { Inline: () => <Button /> };
        export function App() { return <NS.Inline />; }
      `,
    });
    expect(idsOf(occs).map((i) => `${i.export}@${i.package ?? i.filePath}`).sort()).toEqual(["Button@pkg", "NS.Inline@src/App.tsx"]);
  });

  it("an unbound compound root is an unresolved `unbound-name` occurrence naming the root, with no diagnostic", () => {
    const collector = createDiagnosticCollector();
    const occs = scan(
      {
        "src/App.tsx": `
          export function Sidebar() { return <Disclosure.Button>Toggle</Disclosure.Button>; }
        `,
      },
      () => null,
      undefined,
      { collector },
    );
    expect(occs.map((o) => o.unresolved)).toEqual([{ kind: "unbound-name", name: "Disclosure" }]);
    expect(collector.drain()).toEqual([]);
  });
});
