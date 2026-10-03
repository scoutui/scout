/**
 * Semantic gate for the package-reexports fixture: one repository importing
 * through packages that re-export other packages, each shape under
 * `src/<shape>/`, scanned once.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

const fixtureDir = resolve(import.meta.dirname, "../../../../test/fixtures/package-reexports");

let out: ScanArtifact;

beforeAll(async () => {
  ({ artifact: out } = await scanFixture("package-reexports"));
}, 120_000);

const pkg = (packageName: string, exportName: string, publicEntry = "") => ({
  kind: "package-export",
  packageName,
  publicEntry,
  exportName,
});
const local = (shape: string, file: string, exportName: string) => ({
  kind: "repository-declaration",
  repoId: "package-reexports",
  filePath: `src/${shape}/${file}`,
  exportName,
});
const imported = (specifier: string, name: string) => ({ kind: "import", specifier, name });

/** One expected occurrence; `at` is `<file>:<line>:<column>` within its shape. */
function row(at: string, component: unknown, owner: unknown, trace: unknown[]) {
  return { at, component, owner, credit: { kind: "render" }, trace, props: {} };
}

/** Every occurrence under `src/<shape>/`, in source order, with ids replaced by identities. */
function rendersIn(shape: string) {
  const identityOf = new Map(out.components.map((c) => [c.id, c.identity]));
  return out.occurrences
    .filter((o) => o.filePath.startsWith(`src/${shape}/`))
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

const rendersAt = (shape: string, ...ats: string[]) => rendersIn(shape).filter((r) => ats.includes(r.at));

describe("integration: package-reexports fixture", () => {
  // `@example/x-button` and `@example/widget` each declare their custom
  // element in a CEM. The repo renders only their React exports.
  it("reports a row for each component the repo declares or renders, and none for the packages it imports through or the custom elements they wrap", () => {
    const identities = out.components.map((c) => JSON.stringify(c.identity)).sort();
    expect(identities).toEqual(
      [
        local("bundled-entry", "App.tsx", "App"),
        local("leaf-relabel", "App.tsx", "App"),
        local("leaf-relabel", "Direct.tsx", "Direct"),
        local("star-reexports", "Aliased.tsx", "Aliased"),
        local("star-reexports", "App.tsx", "App"),
        local("star-reexports", "Other.tsx", "Other"),
        local("star-reexports", "Page.vue", "Page"),
        local("undeclared-leaf", "App.tsx", "App"),
        pkg("@example/bundled-aggregator", "BundledX"),
        pkg("@example/x-button", "XButton", "dist/react"),
        pkg("@example/button", "Button"),
        pkg("@example/card", "Card"),
        pkg("@example/all", "default"),
        pkg("@example/own", "Button"),
        pkg("@example/icons", "Icons.Star"),
        pkg("@example/widget", "XWidget", "dist/react"),
      ]
        .map((identity) => JSON.stringify(identity))
        .sort(),
    );
  });

  // `@example/aggregator/react/button` does
  // `export * from "@example/x-button/dist/react.js"`.
  describe("leaf-relabel", () => {
    it("keys the aggregator route to a subpath entry by that entry, the same as a direct import of it", () => {
      const S = "leaf-relabel";
      const xButton = pkg("@example/x-button", "XButton", "dist/react");
      expect(rendersIn(S)).toEqual([
        row("App.tsx:4:9", xButton, local(S, "App.tsx", "App"), [imported("@example/aggregator/react/button", "XButton")]),
        row("Direct.tsx:4:9", xButton, local(S, "Direct.tsx", "Direct"), [imported("@example/x-button/dist/react.js", "XButton")]),
      ]);
    });
  });

  // `@example/widget-aggregator/react/widget` does `export * from "@example/widget/dist/react.js"`,
  // and nothing declares `@example/widget`: it is only installed.
  describe("undeclared-leaf", () => {
    it("credits the leaf package behind an aggregator when nothing declares the leaf", async () => {
      const S = "undeclared-leaf";
      const manifest = async (dir: string) => JSON.parse(await readFile(resolve(fixtureDir, dir, "package.json"), "utf8"));
      expect((await manifest(".")).dependencies).not.toHaveProperty("@example/widget");
      expect((await manifest("node_modules/@example/widget-aggregator")).dependencies).toBeUndefined();
      expect(rendersIn(S)).toEqual([
        row("App.tsx:4:9", pkg("@example/widget", "XWidget", "dist/react"), local(S, "App.tsx", "App"), [
          imported("@example/widget-aggregator/react/widget", "XWidget"),
        ]),
      ]);
    });
  });

  // `@example/bundled-aggregator`'s only entry is pre-bundled:
  // `export { BundledX }` with no `from`.
  describe("bundled-entry", () => {
    it("credits an import from a pre-bundled entry to that package", () => {
      const S = "bundled-entry";
      expect(rendersIn(S)).toEqual([
        row("App.tsx:4:9", pkg("@example/bundled-aggregator", "BundledX"), local(S, "App.tsx", "App"), [
          imported("@example/bundled-aggregator", "BundledX"),
        ]),
      ]);
    });
  });

  //   @example/all   export * from "@example/button"; export * from "@example/card";
  //   @example/own   export * from "@example/button"; export const Button = …;
  //   @example/kit   export * as Icons from "@example/icons"; export * from "@example/card";
  // @example/button exports Button and a default, @example/card exports Card,
  // and @example/icons exports Card and Star.
  describe("star-reexports", () => {
    const S = "star-reexports";

    it("credits a name to the first `export *` whose target provides it, in React and Vue", () => {
      const button = pkg("@example/button", "Button");
      const card = pkg("@example/card", "Card");
      const app = local(S, "App.tsx", "App");
      const page = local(S, "Page.vue", "Page");
      expect(rendersAt(S, "App.tsx:6:6", "App.tsx:7:6", "Page.vue:6:3", "Page.vue:7:3")).toEqual([
        row("App.tsx:6:6", button, app, [imported("@example/all", "Button")]),
        row("App.tsx:7:6", card, app, [imported("@example/all", "Card")]),
        row("Page.vue:6:3", button, page, [imported("@example/all", "Button")]),
        row("Page.vue:7:3", card, page, [imported("@example/all", "Card")]),
      ]);
    });

    it("credits an entry's own export ahead of its `export *`", () => {
      expect(rendersAt(S, "Other.tsx:9:6")).toEqual([
        row("Other.tsx:9:6", pkg("@example/own", "Button"), local(S, "Other.tsx", "Other"), [imported("@example/own", "Button")]),
      ]);
    });

    it("reads `export * as` as the one name it exports, naming the module it re-exports", () => {
      const other = local(S, "Other.tsx", "Other");
      expect(rendersAt(S, "Other.tsx:10:6", "Other.tsx:11:6")).toEqual([
        row("Other.tsx:10:6", pkg("@example/card", "Card"), other, [imported("@example/kit", "Card")]),
        row("Other.tsx:11:6", pkg("@example/icons", "Icons.Star"), other, [imported("@example/kit", "Icons")]),
      ]);
    });

    it("credits an alias of a member of a named import, declared in another file, as that member", () => {
      expect(rendersAt(S, "Aliased.tsx:4:9")).toEqual([
        row("Aliased.tsx:4:9", pkg("@example/icons", "Icons.Star"), local(S, "Aliased.tsx", "Aliased"), [
          imported("./aliased-star", "AliasedStar"),
        ]),
      ]);
    });

    it("does not pass a default import through `export *`", () => {
      expect(rendersAt(S, "Other.tsx:8:6")).toEqual([
        row("Other.tsx:8:6", pkg("@example/all", "default"), local(S, "Other.tsx", "Other"), [imported("@example/all", "default")]),
      ]);
    });
  });
});
