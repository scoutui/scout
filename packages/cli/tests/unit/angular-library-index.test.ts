import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildAngularLibraryIndex, type AngularLibraryIndex } from "../../src/scan/angular-library-index.js";

const fixturesRoot = resolve(import.meta.dirname, "../../../../test/fixtures");

let tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

/** A fresh directory to use as `configDir`, removed after the test. */
async function freshConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cc-angular-library-index-"));
  tmpDirs.push(dir);
  return dir;
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
}

/** Writes a synthetic package (its own `package.json` plus whatever typings `files` gives) into `configDir`'s `node_modules/<name>`. */
async function installPackage(configDir: string, name: string, pkgJson: Record<string, unknown>, files: Record<string, string>): Promise<void> {
  await writeFiles(join(configDir, "node_modules", name), { "package.json": JSON.stringify({ name, version: "0.0.0", ...pkgJson }), ...files });
}

/** Copies the committed `test/fixtures/example-ng-ui` fixture package into `configDir`'s `node_modules`. */
async function installExampleNgUi(configDir: string): Promise<void> {
  await cp(join(fixturesRoot, "example-ng-ui"), join(configDir, "node_modules/@example/ng-ui"), { recursive: true });
}

async function build(configDir: string, specifiers: string[]): Promise<AngularLibraryIndex> {
  return buildAngularLibraryIndex({ configDir, specifiers });
}

describe("buildAngularLibraryIndex", () => {
  describe("against the example-ng-ui fixture", () => {
    it("resolves a component the root entry only `import`s (no `from` on its own `export`) into the chunk that declares it", async () => {
      const configDir = await freshConfigDir();
      await installExampleNgUi(configDir);

      const index = await build(configDir, ["@example/ng-ui"]);

      expect(index.components).toEqual([
        {
          specifier: "@example/ng-ui",
          exportName: "ExButton",
          selector: "button[ex-button], a[ex-button]",
          declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "ExButton" },
          // color/disabled come from ExButtonBase, which ExButton `extends` (see angular-library-index.test.ts's "extends" describe block for dedicated coverage).
          inputs: ["color", "disabled"],
          outputs: [],
        },
      ]);
      expect(index.modules).toEqual([]);
      expect(index.unreadable).toEqual([]);
    });

    it("resolves a component declared in a chunk file and re-exported by a subpath entry, with an aliased input and an output", async () => {
      const configDir = await freshConfigDir();
      await installExampleNgUi(configDir);

      const index = await build(configDir, ["@example/ng-ui/card"]);

      const card = index.components.find((c) => c.exportName === "ExCard");
      expect(card).toEqual({
        specifier: "@example/ng-ui/card",
        exportName: "ExCard",
        selector: "ex-card",
        declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "ExCard" },
        inputs: ["elevation", "title"],
        outputs: ["closed"],
      });
    });

    it("resolves the chunk-declared module's exports to the same subpath specifier", async () => {
      const configDir = await freshConfigDir();
      await installExampleNgUi(configDir);

      const index = await build(configDir, ["@example/ng-ui/card"]);

      expect(index.modules).toEqual([
        { specifier: "@example/ng-ui/card", exportName: "ExCardModule", exports: [{ specifier: "@example/ng-ui/card", exportName: "ExCard" }] },
      ]);
    });

    it("indexes every requested specifier of the same package independently", async () => {
      const configDir = await freshConfigDir();
      await installExampleNgUi(configDir);

      const index = await build(configDir, ["@example/ng-ui", "@example/ng-ui/card"]);

      expect(index.components.map((c) => c.exportName).sort()).toEqual(["ExButton", "ExCard"]);
    });
  });

  describe("the three silent cases (nothing to read, never an unreadable row)", () => {
    it("substitutes every `*` in a pattern export's types target, as Node does", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/patterned",
        { exports: { "./*": { types: "./types/*/*.d.ts", default: "./fesm/*.mjs" } } },
        {
          "types/chip/chip.d.ts": [
            "import * as i0 from '@angular/core';",
            "export declare class ExChip {",
            '    static ɵcmp: i0.ɵɵComponentDeclaration<ExChip, "ex-chip", never, {}, {}, never, never, true, never>;',
            "}",
            "",
          ].join("\n"),
        },
      );

      const index = await build(configDir, ["@example/patterned/chip"]);

      expect(index.components).toEqual([{ specifier: "@example/patterned/chip", exportName: "ExChip", selector: "ex-chip", declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "ExChip" }, inputs: [], outputs: [] }]);
      expect(index.unreadable).toEqual([]);
    });

    it("silently contributes nothing for a package that isn't installed (the caller already warns dependency-not-installed)", async () => {
      const configDir = await freshConfigDir();

      const index = await build(configDir, ["@example/does-not-exist"]);

      expect(index.components).toEqual([]);
      expect(index.modules).toEqual([]);
      expect(index.unreadable).toEqual([]);
    });

    it("silently contributes nothing for an installed package with no typings at all (a plain JS library)", async () => {
      const configDir = await freshConfigDir();
      await installPackage(configDir, "@example/plain-js", {}, { "index.mjs": "export class Widget {}\n" });

      const index = await build(configDir, ["@example/plain-js"]);

      expect(index.components).toEqual([]);
      expect(index.modules).toEqual([]);
      expect(index.unreadable).toEqual([]);
    });

    it("silently contributes nothing for a subpath with no `types` export condition, even though other subpaths of the same package have one", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/no-types",
        { exports: { "./widget": { default: "./widget.mjs" } } },
        { "widget.mjs": "export class Widget {}\n" },
      );

      const index = await build(configDir, ["@example/no-types/widget"]);

      expect(index.components).toEqual([]);
      expect(index.modules).toEqual([]);
      expect(index.unreadable).toEqual([]);
    });

    it("silently contributes nothing for typings with no ɵcmp/ɵmod (a library with no Angular declarations, e.g. rxjs)", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/no-angular-declarations",
        { exports: { ".": { types: "./index.d.ts" } } },
        { "index.d.ts": "export declare class Observable<T> {\n    subscribe(fn: (value: T) => void): void;\n}\n" },
      );

      const index = await build(configDir, ["@example/no-angular-declarations"]);

      expect(index.components).toEqual([]);
      expect(index.modules).toEqual([]);
      expect(index.unreadable).toEqual([]);
    });
  });

  describe("typings next to the JavaScript (an `exports` target with no `types` condition, as TypeScript resolves it)", () => {
    const ionStyleTypings = {
      "dist/standalone/index.d.ts": "export * from './directives/ion-item';\n",
      "dist/standalone/index.js": "export {};\n",
      "dist/standalone/directives/ion-item.d.ts": [
        "import * as i0 from '@angular/core';",
        "export declare class IonItem {",
        '    static ɵcmp: i0.ɵɵComponentDeclaration<IonItem, "ion-item", never, { "button": { "alias": "button"; "required": false; }; }, {}, never, ["*"], true, never>;',
        "}",
        "",
      ].join("\n"),
      "dist/standalone/directives/ion-item.js": "export class IonItem {}\n",
    };
    // `@ionic/angular`'s shape: plain string targets, typings only via the root `typings` field and sibling `.d.ts` files.
    const ionStylePackage = {
      typings: "./dist/standalone/index.d.ts",
      exports: { ".": "./dist/standalone/index.js", "./ion-item": "./dist/standalone/directives/ion-item.js" },
    };

    it("reads the root entry's `.d.ts` next to a plain string `exports` target", async () => {
      const configDir = await freshConfigDir();
      await installPackage(configDir, "@example/ion-style", ionStylePackage, ionStyleTypings);

      const index = await build(configDir, ["@example/ion-style"]);

      expect(index.components).toEqual([{ specifier: "@example/ion-style", exportName: "IonItem", selector: "ion-item", declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "IonItem" }, inputs: ["button"], outputs: [] }]);
      expect(index.unreadable).toEqual([]);
    });

    it("reads a subpath entry's `.d.ts` next to its string target", async () => {
      const configDir = await freshConfigDir();
      await installPackage(configDir, "@example/ion-style", ionStylePackage, ionStyleTypings);

      const index = await build(configDir, ["@example/ion-style/ion-item"]);

      expect(index.components).toEqual([{ specifier: "@example/ion-style/ion-item", exportName: "IonItem", selector: "ion-item", declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "IonItem" }, inputs: ["button"], outputs: [] }]);
      expect(index.unreadable).toEqual([]);
    });

    it("reads a `.d.mts` next to an `.mjs` condition target", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/mjs-style",
        { exports: { ".": { import: "./index.mjs" } } },
        {
          "index.mjs": "export class ExChip {}\n",
          "index.d.mts": [
            "import * as i0 from '@angular/core';",
            "export declare class ExChip {",
            '    static ɵcmp: i0.ɵɵComponentDeclaration<ExChip, "ex-chip", never, {}, {}, never, never, true, never>;',
            "}",
            "",
          ].join("\n"),
        },
      );

      const index = await build(configDir, ["@example/mjs-style"]);

      expect(index.components).toEqual([{ specifier: "@example/mjs-style", exportName: "ExChip", selector: "ex-chip", declaredAs: { file: expect.stringMatching(/\.d\.mts$/), className: "ExChip" }, inputs: [], outputs: [] }]);
      expect(index.unreadable).toEqual([]);
    });
  });

  describe("real problems (reported as unreadable, so the caller can warn about them)", () => {
    it("reports a declared but missing types file as unreadable", async () => {
      const configDir = await freshConfigDir();
      await installPackage(configDir, "@example/missing-file", { exports: { ".": { types: "./types/index.d.ts" } } }, {});

      const index = await build(configDir, ["@example/missing-file"]);

      expect(index.unreadable).toEqual([{ specifier: "@example/missing-file", reason: expect.stringContaining("doesn't exist") }]);
    });

    it("reports an unparsable package.json as unreadable", async () => {
      const configDir = await freshConfigDir();
      await installPackage(configDir, "@example/bad-package-json", {}, {});
      // installPackage always writes a valid package.json; overwrite it with broken JSON.
      await writeFiles(configDir, { "node_modules/@example/bad-package-json/package.json": "{ not valid json" });

      const index = await build(configDir, ["@example/bad-package-json"]);

      expect(index.unreadable).toEqual([{ specifier: "@example/bad-package-json", reason: expect.stringContaining("isn't valid JSON") }]);
    });

    it("never reports the same specifier's unreadable row twice", async () => {
      const configDir = await freshConfigDir();
      await installPackage(configDir, "@example/missing-file", { exports: { ".": { types: "./types/index.d.ts" } } }, {});

      const index = await build(configDir, ["@example/missing-file", "@example/missing-file"]);

      expect(index.unreadable).toHaveLength(1);
    });

    it("skips a directive (ɵdir), never reporting it as a component or a module", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/directive-only",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExHighlight {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExHighlight, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExHighlight, "[exHighlight]", never, {}, {}, never, never, true, never>;
}
export { ExHighlight };
`,
        },
      );

      const index = await build(configDir, ["@example/directive-only"]);

      expect(index.components).toEqual([]);
      expect(index.modules).toEqual([]);
      expect(index.unreadable).toEqual([]);
    });

    it("collects a directive's element selector into `directives`, never into `components`", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/element-directive",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExLabel {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExLabel, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExLabel, "ex-label, [exLabel]", never, {}, {}, never, never, true, never>;
}
export { ExLabel };
`,
        },
      );

      const index = await build(configDir, ["@example/element-directive"]);

      expect(index.directives).toEqual([{ specifier: "@example/element-directive", exportName: "ExLabel", selector: "ex-label, [exLabel]" }]);
      expect(index.components).toEqual([]);
      expect(index.modules).toEqual([]);
    });

    it("follows a plain `export { X as Y }` of an import binding (no `from` clause) into the file the import came from", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/import-then-export",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          // Mirrors @angular/material/button-toggle.d.ts: the entry only
          // `import`s the name, then re-exports it with a plain `export`
          // statement that has no `from` clause of its own.
          "types/index.d.ts": `
import { ExInternalToggle } from './_chunk.js';
export { ExInternalToggle as ExToggle };
`,
          "types/_chunk.d.ts": `
import * as i0 from '@angular/core';
declare class ExInternalToggle {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExInternalToggle, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExInternalToggle, "ex-toggle", never, {}, {}, never, never, true, never>;
}
export { ExInternalToggle };
`,
        },
      );

      const index = await build(configDir, ["@example/import-then-export"]);

      expect(index.components).toEqual([
        { specifier: "@example/import-then-export", exportName: "ExToggle", selector: "ex-toggle", declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "ExInternalToggle" }, inputs: [], outputs: [] },
      ]);
    });

    it("follows a wildcard `export * from` re-export to find a component declared in a chunk file", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/star-reexport",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `export * from './_chunk.js';\n`,
          "types/_chunk.d.ts": `
import * as i0 from '@angular/core';
declare class ExWidget {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExWidget, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExWidget, "ex-widget", never, {}, {}, never, never, true, never>;
}
export { ExWidget };
`,
        },
      );

      const index = await build(configDir, ["@example/star-reexport"]);

      expect(index.components).toEqual([
        { specifier: "@example/star-reexport", exportName: "ExWidget", selector: "ex-widget", declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "ExWidget" }, inputs: [], outputs: [] },
      ]);
    });

    it("reports an aliased re-export (`export { X as Y } from ...`) under the alias, not the chunk's declared name", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/aliased-export",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `export { ExInternalWidget as ExWidget } from './_chunk.js';\n`,
          "types/_chunk.d.ts": `
import * as i0 from '@angular/core';
declare class ExInternalWidget {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExInternalWidget, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExInternalWidget, "ex-widget", never, {}, {}, never, never, true, never>;
}
export { ExInternalWidget };
`,
        },
      );

      const index = await build(configDir, ["@example/aliased-export"]);

      expect(index.components).toEqual([
        { specifier: "@example/aliased-export", exportName: "ExWidget", selector: "ex-widget", declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "ExInternalWidget" }, inputs: [], outputs: [] },
      ]);
    });

    it("reports one class exported under two names as two entries sharing one declaration", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/dual-export",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExGlyph {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExGlyph, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExGlyph, "ex-glyph", never, {}, {}, never, never, true, never>;
}
export { ExGlyph, ExGlyph as ExGlyphComponent };
`,
        },
      );

      const index = await build(configDir, ["@example/dual-export"]);

      const declaredAs = { file: expect.stringMatching(/\.d\.ts$/), className: "ExGlyph" };
      expect(index.components).toEqual([
        { specifier: "@example/dual-export", exportName: "ExGlyph", selector: "ex-glyph", declaredAs, inputs: [], outputs: [] },
        { specifier: "@example/dual-export", exportName: "ExGlyphComponent", selector: "ex-glyph", declaredAs, inputs: [], outputs: [] },
      ]);
    });

    it("resolves a module's `typeof ns.X` export to another installed package, and indexes that package's own entry too", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/ng-icons",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExIcon {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExIcon, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExIcon, "ex-icon", never, {}, {}, never, never, true, never>;
}
export { ExIcon };
`,
        },
      );
      await installPackage(
        configDir,
        "@example/ng-toolbar",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
import * as icons from '@example/ng-icons';
declare class ExToolbarModule {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExToolbarModule, never>;
    static ɵmod: i0.ɵɵNgModuleDeclaration<ExToolbarModule, never, [typeof icons.ExIcon], [typeof icons.ExIcon]>;
}
export { ExToolbarModule };
`,
        },
      );

      const index = await build(configDir, ["@example/ng-toolbar"]);

      expect(index.modules).toEqual([
        { specifier: "@example/ng-toolbar", exportName: "ExToolbarModule", exports: [{ specifier: "@example/ng-icons", exportName: "ExIcon" }] },
      ]);
      // The referenced package is indexed transitively, so its own component surfaces too.
      expect(index.components).toContainEqual({ specifier: "@example/ng-icons", exportName: "ExIcon", selector: "ex-icon", declaredAs: { file: expect.stringMatching(/\.d\.ts$/), className: "ExIcon" }, inputs: [], outputs: [] });
    });

    it("is cycle-safe when two chunk files re-export each other with `export *`", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/cyclic",
        { exports: { ".": { types: "./types/a.d.ts" } } },
        {
          "types/a.d.ts": `
import * as i0 from '@angular/core';
export * from './b.js';
declare class ExFromA {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExFromA, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExFromA, "ex-from-a", never, {}, {}, never, never, true, never>;
}
export { ExFromA };
`,
          "types/b.d.ts": `
import * as i0 from '@angular/core';
export * from './a.js';
declare class ExFromB {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExFromB, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExFromB, "ex-from-b", never, {}, {}, never, never, true, never>;
}
export { ExFromB };
`,
        },
      );

      const index = await build(configDir, ["@example/cyclic"]);

      expect(index.components.map((c) => c.exportName).sort()).toEqual(["ExFromA", "ExFromB"]);
    });
  });

  describe("extends (a base class's declared inputs/outputs merge into the extending component's)", () => {
    it("merges a base directive's inputs, aliases included, declared in the same chunk as the extending component", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/extends-same-file",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExBaseDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExBaseDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExBaseDirective, never, never, { "color": { "alias": "color"; "required": false; }; "disabled": { "alias": "disabled"; "required": false; }; "ariaDisabled": { "alias": "aria-disabled"; "required": false; }; }, {}, never, never, true, never>;
}
declare class ExButton extends ExBaseDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExButton, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExButton, "button[ex-button]", never, { "appearance": { "alias": "exButton"; "required": false; }; }, {}, never, never, true, never>;
}
export { ExButton };
`,
        },
      );

      const index = await build(configDir, ["@example/extends-same-file"]);

      const button = index.components.find((c) => c.exportName === "ExButton");
      expect(button?.inputs.sort()).toEqual(["aria-disabled", "color", "disabled", "exButton"]);
    });

    it("resolves a base class imported from a different chunk file than the extending component", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/extends-other-chunk",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
import { ExBaseDirective } from './_base-chunk.js';
declare class ExButton extends ExBaseDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExButton, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExButton, "ex-button", never, {}, {}, never, never, true, never>;
}
export { ExButton };
`,
          "types/_base-chunk.d.ts": `
import * as i0 from '@angular/core';
declare class ExBaseDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExBaseDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExBaseDirective, never, never, { "color": { "alias": "color"; "required": false; }; }, {}, never, never, true, never>;
}
export { ExBaseDirective };
`,
        },
      );

      const index = await build(configDir, ["@example/extends-other-chunk"]);

      const button = index.components.find((c) => c.exportName === "ExButton");
      expect(button?.inputs).toEqual(["color"]);
    });

    it("walks a two-level `extends` chain, merging every ancestor's own inputs", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/extends-two-levels",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExGrandBase {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExGrandBase, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExGrandBase, never, never, { "color": { "alias": "color"; "required": false; }; }, {}, never, never, true, never>;
}
declare class ExMidBase extends ExGrandBase {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExMidBase, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExMidBase, never, never, { "disabled": { "alias": "disabled"; "required": false; }; }, {}, never, never, true, never>;
}
declare class ExButton extends ExMidBase {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExButton, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExButton, "ex-button", never, { "variant": { "alias": "variant"; "required": false; }; }, {}, never, never, true, never>;
}
export { ExButton };
`,
        },
      );

      const index = await build(configDir, ["@example/extends-two-levels"]);

      const button = index.components.find((c) => c.exportName === "ExButton");
      expect(button?.inputs.sort()).toEqual(["color", "disabled", "variant"]);
    });

    it("lets the component's own input win over an ancestor's on a name clash", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/extends-name-clash",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExBaseDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExBaseDirective, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExBaseDirective, never, never, { "color": { "alias": "color"; "required": false; }; }, {}, never, never, true, never>;
}
declare class ExButton extends ExBaseDirective {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExButton, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExButton, "ex-button", never, { "color": { "alias": "primaryColor"; "required": false; }; }, {}, never, never, true, never>;
}
export { ExButton };
`,
        },
      );

      const index = await build(configDir, ["@example/extends-name-clash"]);

      const button = index.components.find((c) => c.exportName === "ExButton");
      // ExButton redeclares the "color" property itself, aliased "primaryColor" instead of the
      // base's "color"; its own entry wins, so the base's alias for the same property never
      // appears alongside it.
      expect(button?.inputs).toEqual(["primaryColor"]);
    });

    it("terminates an `extends` cycle (A extends B extends A), still reporting each class's own inputs once", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/extends-cycle",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExA extends ExB {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExA, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExA, "ex-a", never, { "a": { "alias": "a"; "required": false; }; }, {}, never, never, true, never>;
}
declare class ExB extends ExA {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExB, never>;
    static ɵdir: i0.ɵɵDirectiveDeclaration<ExB, never, never, { "b": { "alias": "b"; "required": false; }; }, {}, never, never, true, never>;
}
export { ExA, ExB };
`,
        },
      );

      const index = await build(configDir, ["@example/extends-cycle"]);

      const a = index.components.find((c) => c.exportName === "ExA");
      expect(a?.inputs.sort()).toEqual(["a", "b"]);
    });

    it("keeps only a class's own inputs when it has no `extends` clause (negative, paired with the positive cases above)", async () => {
      const configDir = await freshConfigDir();
      await installPackage(
        configDir,
        "@example/no-extends",
        { exports: { ".": { types: "./types/index.d.ts" } } },
        {
          "types/index.d.ts": `
import * as i0 from '@angular/core';
declare class ExPlainButton {
    static ɵfac: i0.ɵɵFactoryDeclaration<ExPlainButton, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<ExPlainButton, "ex-plain-button", never, { "variant": { "alias": "variant"; "required": false; }; }, {}, never, never, true, never>;
}
export { ExPlainButton };
`,
        },
      );

      const index = await build(configDir, ["@example/no-extends"]);

      const button = index.components.find((c) => c.exportName === "ExPlainButton");
      expect(button?.inputs).toEqual(["variant"]);
    });
  });
});
