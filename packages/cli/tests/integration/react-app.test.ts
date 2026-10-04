/**
 * Semantic gate for the react-app fixture: one repository holding React app
 * shapes, each under `src/<shape>/`, scanned once.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { isDeepStrictEqual } from "node:util";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact;

beforeAll(async () => {
  ({ artifact: out } = await scanFixture("react-app"));
}, 120_000);

const inShape = (shape: string, filePath: string) => filePath.startsWith(`src/${shape}/`);

const pkgOf = (packageName: string, exportName: string, publicEntry = "") => ({
  kind: "package-export",
  packageName,
  publicEntry,
  exportName,
});
const local = (shape: string, file: string, exportName: string) => ({
  kind: "repository-declaration",
  repoId: "react-app",
  filePath: `src/${shape}/${file}`,
  exportName,
});
const imported = (specifier: string, name: string) => ({ kind: "import", specifier, name });
const webButton = pkgOf("@example/web-button", "WebButton", "dist/react");

/** One expected occurrence; `at` is `<file>:<line>:<column>` within its shape. */
function row(
  at: string,
  component: unknown,
  owner: unknown,
  trace: unknown[],
  props: Record<string, unknown> = {},
) {
  return { at, component, owner, credit: { kind: "render" }, trace, props };
}

/** Every occurrence under `src/<shape>/`, in source order, with ids replaced by identities. */
function rendersIn(shape: string) {
  const identityOf = new Map(out.components.map((c) => [c.id, c.identity]));
  return out.occurrences
    .filter((o) => inShape(shape, o.filePath))
    .sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : a.line - b.line || a.column - b.column))
    .map((o) => ({
      at: `${o.filePath.slice(`src/${shape}/`.length)}:${o.line}:${o.column}`,
      component: o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution,
      owner: o.ownerComponentId === undefined ? undefined : identityOf.get(o.ownerComponentId),
      credit: o.credit,
      trace: o.trace,
      props: o.props,
    }));
}

const componentOf = (identity: object) => out.components.find((c) => isDeepStrictEqual(c.identity, identity));

describe("integration: react-app fixture", () => {
  it("pins the literal id of a package export and of a repository declaration", () => {
    // Every saved dashboard and stored scan keys on these ids, so a change to
    // how they are derived must show up here, not only in a baseline.
    expect(componentOf(webButton)?.id).toBe("2be238a45c4d2e55");
    expect(componentOf(local("nextjs-app", "app/page.tsx", "Page"))?.id).toBe("37af0274b89319d4");
  });

  // nextjs-app imports a React-wrapped web-button via
  // `@example/web-button/dist/react.js`. The React wrapper is a package export
  // of its own. The custom element it wraps is never observed in this repo, so
  // no row is fabricated for it.
  describe("nextjs-app", () => {
    const S = "nextjs-app";

    it("credits the React wrapper as a package export where the app renders it", () => {
      const button = local(S, "components/submit-button.tsx", "SubmitButton");
      const page = local(S, "app/page.tsx", "Page");
      const trace = [imported("../components/submit-button.js", "SubmitButton")];
      expect(rendersIn(S)).toEqual([
        row("app/page.tsx:6:7", button, page, trace, { variant: { tier: "written", value: "secondary" } }),
        row("app/page.tsx:7:7", button, page, trace, {}),
        row("components/submit-button.tsx:5:10", webButton, button, [imported("@example/web-button/dist/react.js", "WebButton")], {
          variant: { tier: "dynamic" },
        }),
      ]);
      expect(componentOf(webButton)?.framework).toBe("react");
      expect(componentOf(page)?.usage).toBe("root");
    });

    it("fabricates no tag row for the element the wrapper wraps", () => {
      expect(out.components.filter((c) => c.identity.kind === "tag")).toEqual([]);
    });
  });

  // App.tsx renders `<Button label="ok" onClick={() => ...} />`. The `on*`
  // attribute reaches `props` as a dynamic prop, and the rollup
  // (packages/cli/src/rollup.ts) counts it among Button's events.
  describe("nextjs-folder-basename", () => {
    const S = "nextjs-folder-basename";

    it("resolves each component folder to its same-named file, and rolls onClick into Button's events", () => {
      const app = local(S, "App.tsx", "App");
      const button = local(S, "components/button/button.tsx", "Button");
      expect(rendersIn(S)).toEqual([
        row("App.tsx:7:7", local(S, "components/avatar/avatar.tsx", "Avatar"), app, [imported("./components/avatar", "Avatar")], {
          src: { tier: "written", value: "/me.png" },
        }),
        row("App.tsx:8:7", button, app, [imported("./components/button", "Button")], {
          label: { tier: "written", value: "ok" },
          onClick: { tier: "dynamic" },
        }),
      ]);
      expect(componentOf(button)?.props.onClick).toMatchObject({ dynamic: 1 });
      expect(componentOf(button)?.events?.onClick).toEqual({ boundCount: 1 });
    });
  });

  describe("local-emission-app", () => {
    it("credits an in-repo default export where the app renders it", () => {
      const S = "local-emission-app";
      expect(rendersIn(S)).toEqual([
        row("App.tsx:4:10", local(S, "components/Button.tsx", "Button"), local(S, "App.tsx", "App"), [
          imported("./components/Button", "default"),
        ], { label: { tier: "written", value: "Hi" } }),
      ]);
    });
  });

  // Local variable assignments inside JSX-emitting function bodies
  // (`const id = item.id || item;`) must never surface as
  // components.
  describe("body-locals-app", () => {
    const S = "body-locals-app";

    it("does not surface function-body locals as components", () => {
      const declared = out.components.flatMap((c) =>
        c.identity.kind === "repository-declaration" && inShape(S, c.identity.filePath) ? [c.identity.exportName] : [],
      );
      expect(declared.sort()).toEqual(["ItemIcon", "ItemPanel"]);
      expect(out.components.map((c) => (c.identity as { exportName?: string }).exportName)).not.toContain("id");
    });

    it("still credits the renders inside the body that declares the local", () => {
      const owner = local(S, "item-panel.jsx", "ItemPanel");
      expect(rendersIn(S)).toEqual([
        row("item-panel.jsx:8:13", local(S, "item-icon.jsx", "ItemIcon"), owner, [imported("./item-icon", "ItemIcon")], {
          id: { tier: "reference", ref: "id" },
        }),
        // `pkg` is neither declared nor installed.
        row("item-panel.jsx:9:13", { status: "unresolved", reason: { kind: "module-not-found" } }, owner, [imported("pkg", "Foo")], {
          value: { tier: "reference", ref: "id" },
        }),
      ]);
    });
  });
});
