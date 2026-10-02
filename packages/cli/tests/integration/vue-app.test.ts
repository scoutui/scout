/**
 * Semantic gate for the vue-app fixture: one repository holding Vue SFC
 * shapes, each under `src/<shape>/`, scanned once.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { isDeepStrictEqual } from "node:util";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

let out: ScanArtifact;

beforeAll(async () => {
  ({ artifact: out } = await scanFixture("vue-app"));
}, 120_000);

const inShape = (shape: string, filePath: string) => filePath.startsWith(`src/${shape}/`);

const local = (shape: string, file: string, exportName: string) => ({
  kind: "repository-declaration",
  repoId: "vue-app",
  filePath: `src/${shape}/${file}`,
  exportName,
});
const tag = (tagName: string) => ({ kind: "tag", tagName });
const imported = (specifier: string, name: string) => ({ kind: "import", specifier, name });

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

describe("integration: vue-app fixture", () => {
  it("pins the literal id of a tag, which its name alone keys", () => {
    expect(componentOf(tag("web-button"))?.id).toBe("fa902f4e2fbcb80c");
  });

  // A page renders a local SFC twice; the SFC wraps `<web-button>`, a custom
  // element whose package ships a CEM, with a written and a bound attribute.
  describe("sfc-wraps-tag", () => {
    it("credits each render of the SFC to it, and the tag inside it to the tag, owned by the SFC", () => {
      const S = "sfc-wraps-tag";
      const webAction = local(S, "components/WebAction.vue", "WebAction");
      const page = local(S, "pages/index.vue", "Index");
      const trace = [imported("../components/WebAction.vue", "default")];
      expect(rendersIn(S)).toEqual([
        row("components/WebAction.vue:2:3", tag("web-button"), webAction, [], {
          variant: { tier: "written", value: "primary" },
          size: { tier: "reference", ref: "size" },
        }),
        row("pages/index.vue:2:3", webAction, page, trace),
        row("pages/index.vue:3:3", webAction, page, trace),
      ]);
      expect(componentOf(webAction)?.framework).toBe("vue");
    });
  });

  // One page renders a package export, a local SFC and a literal tag.
  describe("mixed-page", () => {
    it("credits a package export, a local SFC and a literal tag on one page, each owned by the page", () => {
      const S = "mixed-page";
      const webAction = local(S, "components/WebAction.vue", "WebAction");
      const page = local(S, "pages/index.vue", "Index");
      const vBtn = { kind: "package-export", packageName: "@example/vue-ds", publicEntry: "", exportName: "VBtn" };
      const primary = { variant: { tier: "written", value: "primary" } };
      expect(rendersIn(S)).toEqual([
        row("components/WebAction.vue:2:3", tag("web-button"), webAction, [], primary),
        row("pages/index.vue:3:5", webAction, page, [imported("../components/WebAction.vue", "default")]),
        row("pages/index.vue:4:5", vBtn, page, [imported("@example/vue-ds", "VBtn")], {
          variant: { tier: "written", value: "secondary" },
        }),
        row("pages/index.vue:5:5", tag("web-button"), page, [], primary),
      ]);
      expect(componentOf(vBtn)?.framework).toBe("vue");
    });
  });

  // `pages/index.vue` imports `{ Card }` from `../components`, a `.ts` barrel
  // that re-exports the default export of `./Card.vue`.
  describe("ts-barrel", () => {
    it("credits <Card> to Card.vue, not to the barrel it was imported through", () => {
      const S = "ts-barrel";
      expect(rendersIn(S)).toEqual([
        row("pages/index.vue:2:3", local(S, "components/Card.vue", "Card"), local(S, "pages/index.vue", "Index"), [
          imported("../components", "Card"),
        ], { title: { tier: "written", value: "hello" } }),
      ]);
    });
  });

  // `page-header.vue` declares `defineOptions({ name: 'SiteHeader' })`, a name
  // its file name doesn't give.
  describe("define-options-name", () => {
    it("attributes <web-button> to its package by the installed CEM, owned by the SFC defineOptions names", () => {
      const S = "define-options-name";
      expect(componentOf(tag("web-button"))?.attribution).toMatchObject({
        status: "resolved",
        target: { kind: "package", packageName: "@example/web-button" },
        confidence: "declared",
        evidence: [{ source: "cem", locator: { packageName: "@example/web-button" }, disposition: "supports" }],
      });
      expect(rendersIn(S)).toEqual([
        row("components/page-header.vue:3:5", tag("web-button"), local(S, "components/page-header.vue", "SiteHeader"), []),
      ]);
    });
  });

  // `<x-button>` is written with no script import; only its package's CEM
  // names it.
  describe("unimported-tag", () => {
    it("resolves an unimported tag through the CEM tag index to the package that declares it", () => {
      const S = "unimported-tag";
      expect(componentOf(tag("x-button"))?.attribution).toMatchObject({
        status: "resolved",
        target: { kind: "package", packageName: "@example/x-button" },
        evidence: [{ source: "cem", locator: { packageName: "@example/x-button" } }],
      });
      expect(rendersIn(S)).toEqual([
        row("pages/index.vue:2:3", tag("x-button"), local(S, "pages/index.vue", "Index"), []),
      ]);
    });
  });

  // `<Toggle checked>` writes a boolean prop with no value.
  describe("boolean-shorthand", () => {
    it("reads an attribute written with no value as written true", () => {
      const S = "boolean-shorthand";
      expect(rendersIn(S)).toEqual([
        row("pages/index.vue:2:3", local(S, "components/Toggle.vue", "Toggle"), local(S, "pages/index.vue", "Index"), [
          imported("../components/Toggle.vue", "default"),
        ], { checked: { tier: "written", value: true } }),
      ]);
    });
  });

  // `<Field>` sits in `<Panel>`'s default slot, inside a `<template #default>`.
  describe("slot-content", () => {
    it("credits a component rendered in slot content, owned by the SFC whose template holds it", () => {
      const S = "slot-content";
      const page = local(S, "pages/index.vue", "Index");
      expect(rendersIn(S)).toEqual([
        row("pages/index.vue:2:3", local(S, "components/Panel.vue", "Panel"), page, [imported("../components/Panel.vue", "default")]),
        row("pages/index.vue:4:7", local(S, "components/Field.vue", "Field"), page, [imported("../components/Field.vue", "default")], {
          label: { tier: "written", value: "Name" },
        }),
      ]);
    });
  });

  // `script-only/composable.vue` has a `<script>` and no `<template>`: it
  // renders nothing and nothing renders it.
  describe("script-only", () => {
    it("gives a row to every SFC that renders or is rendered, and none to an SFC that does neither", () => {
      const declared = out.components.flatMap((c) =>
        c.identity.kind === "repository-declaration" ? [c.identity.filePath] : [],
      );
      expect(declared.sort()).toEqual([
        "src/boolean-shorthand/components/Toggle.vue",
        "src/boolean-shorthand/pages/index.vue",
        "src/define-options-name/components/page-header.vue",
        "src/mixed-page/components/WebAction.vue",
        "src/mixed-page/pages/index.vue",
        "src/sfc-wraps-tag/components/WebAction.vue",
        "src/sfc-wraps-tag/pages/index.vue",
        "src/slot-content/components/Field.vue",
        "src/slot-content/components/Panel.vue",
        "src/slot-content/pages/index.vue",
        "src/ts-barrel/components/Card.vue",
        "src/ts-barrel/pages/index.vue",
        "src/unimported-tag/pages/index.vue",
      ]);
      expect(rendersIn("script-only")).toEqual([]);
    });
  });
});
