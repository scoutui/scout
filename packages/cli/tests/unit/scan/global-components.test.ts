import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { loadGlobalComponents, detectAutoImportFramework } from "../../../src/scan/global-components.js";

const root = mkdtempSync(join(tmpdir(), "cc-global-components-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Wraps interface members in the augmentation Nuxt 3 emits inline. */
function inlineAugmentation(members: string): string {
  return `declare module 'vue' {\n  export interface GlobalComponents {\n${members}\n  }\n}\n`;
}

/** The real Nuxt shape: members live in a sibling interface reached via `extends`. */
function extendsAugmentation(members: string, name = "_GlobalComponents"): string {
  return [
    `interface ${name} {`,
    members,
    "}",
    "",
    "declare module 'vue' {",
    `  export interface GlobalComponents extends ${name} { }`,
    "}",
    "",
    "export {}",
    "",
  ].join("\n");
}

type Staged = { declarations?: Record<string, string>; files?: string[]; pkg?: object };

function stage(name: string, { declarations = {}, files = [], pkg }: Staged): string {
  const dir = join(root, name);
  mkdirSync(join(dir, ".nuxt"), { recursive: true });
  for (const f of files) {
    mkdirSync(join(dir, f.slice(0, f.lastIndexOf("/"))), { recursive: true });
    writeFileSync(join(dir, f), "<template><div/></template>");
  }
  for (const [relPath, source] of Object.entries(declarations)) {
    mkdirSync(join(dir, relPath.slice(0, relPath.lastIndexOf("/"))), { recursive: true });
    writeFileSync(join(dir, relPath), source);
  }
  if (pkg !== undefined) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

describe("loadGlobalComponents", () => {
  test("reads members declared inline in the augmentation, in both key forms", () => {
    const dir = stage("inline", {
      declarations: {
        ".nuxt/components.d.ts": inlineAugmentation(
          [
            `    FooCard: typeof import("../app/components/FooCard.vue")['default']`,
            `    'BarCard': typeof import("../app/components/BarCard.vue")['default']`,
          ].join("\n"),
        ),
      },
      files: ["app/components/FooCard.vue", "app/components/BarCard.vue"],
    });
    const m = loadGlobalComponents(dir);
    expect(m?.lookup("foocard")).toEqual({
      specifier: join(dir, "app/components/FooCard.vue"),
      imported: "default",
      name: "FooCard",
    });
    expect(m?.lookup("bar-card")).toEqual({
      specifier: join(dir, "app/components/BarCard.vue"),
      imported: "default",
      name: "BarCard",
    });
    expect(m?.lookup("unknown")).toBeUndefined();
  });

  test("accepts the `@vue/runtime-core` augmentation form", () => {
    const dir = stage("runtime-core", {
      declarations: {
        ".nuxt/components.d.ts": [
          "interface _GlobalComponents {",
          `  FooCard: typeof import("../app/components/FooCard.vue")['default']`,
          "}",
          "declare module '@vue/runtime-core' {",
          "  export interface GlobalComponents extends _GlobalComponents { }",
          "}",
        ].join("\n"),
      },
      files: ["app/components/FooCard.vue"],
    });
    expect(loadGlobalComponents(dir)?.lookup("foo-card")?.name).toBe("FooCard");
  });

  test("a declaration file with no vue augmentation contributes nothing", () => {
    const dir = stage("no-augmentation", {
      declarations: {
        ".nuxt/components.d.ts": [
          "interface _GlobalComponents {",
          `  FooCard: typeof import("../app/components/FooCard.vue")['default']`,
          "}",
          "declare module 'some-other-module' {",
          "  export interface GlobalComponents extends _GlobalComponents { }",
          "}",
        ].join("\n"),
      },
      files: ["app/components/FooCard.vue"],
    });
    expect(loadGlobalComponents(dir)).toBeNull();
  });

  test("a vue augmentation that declares no GlobalComponents falls through to the next candidate", () => {
    const dir = stage("other-augmentation", {
      declarations: {
        ".nuxt/components.d.ts": [
          "declare module 'vue' {",
          "  export interface ComponentCustomProperties { $foo: string }",
          "}",
        ].join("\n"),
        ".nuxt/types/components.d.ts": extendsAugmentation(
          `  FooCard: typeof import("../../app/components/FooCard.vue")['default']`,
        ),
      },
      files: ["app/components/FooCard.vue"],
    });
    expect(loadGlobalComponents(dir)?.lookup("foo-card")?.name).toBe("FooCard");
  });

  test("a GlobalComponents that resolves to no members falls through to the next candidate", () => {
    // The augmentation is present but its parent interface isn't in this
    // file, so nothing resolves. Stopping here would silently lose every
    // auto-import and the missing-declaration diagnostic.
    const dir = stage("empty-resolution", {
      declarations: {
        ".nuxt/components.d.ts": [
          "declare module 'vue' {",
          "  export interface GlobalComponents extends _GlobalComponents { }",
          "}",
        ].join("\n"),
        ".nuxt/types/components.d.ts": extendsAugmentation(
          `  FooCard: typeof import("../../app/components/FooCard.vue")['default']`,
        ),
      },
      files: ["app/components/FooCard.vue"],
    });
    const m = loadGlobalComponents(dir);
    expect(m?.declarationPath).toBe(join(dir, ".nuxt", "types", "components.d.ts"));
    expect(m?.lookup("foo-card")?.name).toBe("FooCard");
  });

  test("a candidate whose entries are all stale still wins: the staleness is the finding", () => {
    const dir = stage("all-stale", {
      declarations: {
        ".nuxt/components.d.ts": extendsAugmentation(
          `  GhostCard: typeof import("../app/components/GhostCard.vue")['default']`,
        ),
        ".nuxt/types/components.d.ts": extendsAugmentation(
          `  FooCard: typeof import("../../app/components/FooCard.vue")['default']`,
        ),
      },
      files: ["app/components/FooCard.vue"],
    });
    const m = loadGlobalComponents(dir);
    expect(m?.declarationPath).toBe(join(dir, ".nuxt", "components.d.ts"));
    expect(m?.stale).toEqual([
      { componentName: "GhostCard", target: join(dir, "app/components/GhostCard.vue") },
    ]);
  });

  test("same-name parent interfaces merge, as TypeScript merges them", () => {
    const dir = stage("merged-parent", {
      declarations: {
        ".nuxt/components.d.ts": [
          "interface _GlobalComponents {",
          `  FooCard: typeof import("../app/components/FooCard.vue")['default']`,
          "}",
          "interface _GlobalComponents {",
          `  BarCard: typeof import("../app/components/BarCard.vue")['default']`,
          "}",
          "declare module 'vue' {",
          "  export interface GlobalComponents extends _GlobalComponents { }",
          "}",
        ].join("\n"),
      },
      files: ["app/components/FooCard.vue", "app/components/BarCard.vue"],
    });
    const m = loadGlobalComponents(dir);
    expect(m?.lookup("foo-card")?.name).toBe("FooCard");
    expect(m?.lookup("bar-card")?.name).toBe("BarCard");
  });

  test("a bare package specifier stays a specifier instead of becoming a false stale entry", () => {
    // The shape a library's own declaration ships (vuetify, element-plus).
    // Resolving it against the declaration's directory would invent an
    // in-repo path that never existed and report it as stale.
    const dir = stage("bare-specifier", {
      declarations: {
        ".nuxt/components.d.ts": extendsAugmentation(
          `  VApp: typeof import('vuetify/components')['VApp']`,
        ),
      },
    });
    const m = loadGlobalComponents(dir);
    expect(m?.lookup("v-app")).toEqual({
      specifier: "vuetify/components",
      imported: "VApp",
      name: "VApp",
    });
    expect(m?.stale).toEqual([]);
  });

  test("a quoted kebab key is read, not dropped", () => {
    const dir = stage("kebab-key", {
      declarations: {
        ".nuxt/components.d.ts": extendsAugmentation(
          `  'my-card': typeof import("../app/components/MyCard.vue")['default']`,
        ),
      },
      files: ["app/components/MyCard.vue"],
    });
    expect(loadGlobalComponents(dir)?.lookup("my-card")).toEqual({
      specifier: join(dir, "app/components/MyCard.vue"),
      imported: "default",
      name: "my-card",
    });
  });

  test("lists each member keyed by a valid custom element name with its line and import", () => {
    const dir = stage("tag-declarations", {
      declarations: {
        ".nuxt/components.d.ts": extendsAugmentation(
          [
            `  'x-card': typeof import("../app/components/XCard.vue")['default']`,
            `  'XPanel': typeof import("../app/components/XPanel.vue")['default']`,
            `  'x-lib': typeof import("../node_modules/@example/lib/dist/x-lib.js")['XLib']`,
            `  'x-gone': typeof import("../app/components/Gone.vue")['default']`,
          ].join("\n"),
        ),
      },
      files: ["app/components/XCard.vue", "app/components/XPanel.vue"],
    });
    expect(loadGlobalComponents(dir)?.tagDeclarations).toEqual([
      { tagName: "x-card", line: 2, specifier: join(dir, "app/components/XCard.vue"), imported: "default" },
      { tagName: "x-lib", line: 4, specifier: "@example/lib/dist/x-lib.js", imported: "XLib" },
      { tagName: "x-gone", line: 5, specifier: null, imported: "default" },
    ]);
  });

  test("parses Lazy/Island wrapper shapes and named exports", () => {
    const dir = stage("wrappers", {
      declarations: {
        ".nuxt/components.d.ts": extendsAugmentation(
          [
            `  LazyFooCard: LazyComponent<typeof import("../app/components/FooCard.vue")['default']>`,
            `  NuxtRouteAnnouncer: IslandComponent<typeof import("../app/components/FooCard.vue")['default']>`,
            `  NuxtImg: typeof import("../node_modules/nuxt/dist/app/components/nuxt-stubs")['NuxtImg']`,
          ].join("\n"),
        ),
      },
      files: ["app/components/FooCard.vue"],
    });
    const m = loadGlobalComponents(dir);
    expect(m?.lookup("lazyfoocard")).toEqual({
      specifier: join(dir, "app/components/FooCard.vue"),
      imported: "default",
      name: "LazyFooCard",
    });
    expect(m?.lookup("nuxt-route-announcer")?.name).toBe("NuxtRouteAnnouncer");
    expect(m?.lookup("nuxtimg")).toEqual({
      specifier: "nuxt/dist/app/components/nuxt-stubs",
      imported: "NuxtImg",
      name: "NuxtImg",
    });
  });

  test("node_modules paths reconstruct a bare specifier after the last node_modules segment (pnpm)", () => {
    const dir = stage("pnpm", {
      declarations: {
        ".nuxt/components.d.ts": extendsAugmentation(
          `  NuxtLink: typeof import("../node_modules/.pnpm/nuxt@4.4.7_hash/node_modules/nuxt/dist/app/components/nuxt-link")['default']`,
        ),
      },
    });
    expect(loadGlobalComponents(dir)?.lookup("nuxt-link")).toEqual({
      specifier: "nuxt/dist/app/components/nuxt-link",
      imported: "default",
      name: "NuxtLink",
    });
  });

  test("the first member for a tag form wins, and own members shadow extended ones", () => {
    const dir = stage("shadowing", {
      declarations: {
        ".nuxt/components.d.ts": [
          "interface _GlobalComponents {",
          `  FooCard: typeof import("../app/components/Extended.vue")['default']`,
          `  BarCard: typeof import("../app/components/First.vue")['default']`,
          `  BarCard: typeof import("../app/components/Second.vue")['default']`,
          "}",
          "declare module 'vue' {",
          "  export interface GlobalComponents extends _GlobalComponents {",
          `    FooCard: typeof import("../app/components/Own.vue")['default']`,
          "  }",
          "}",
        ].join("\n"),
      },
      files: ["app/components/Own.vue", "app/components/Extended.vue", "app/components/First.vue", "app/components/Second.vue"],
    });
    const m = loadGlobalComponents(dir);
    expect(m?.lookup("foo-card")?.specifier).toBe(join(dir, "app/components/Own.vue"));
    expect(m?.lookup("bar-card")?.specifier).toBe(join(dir, "app/components/First.vue"));
  });

  test("an `extends` cycle terminates instead of hanging", () => {
    const dir = stage("cycle", {
      declarations: {
        ".nuxt/components.d.ts": [
          "interface A extends B {",
          `  FooCard: typeof import("../app/components/FooCard.vue")['default']`,
          "}",
          "interface B extends A { }",
          "declare module 'vue' {",
          "  export interface GlobalComponents extends A { }",
          "}",
        ].join("\n"),
      },
      files: ["app/components/FooCard.vue"],
    });
    expect(loadGlobalComponents(dir)?.lookup("foo-card")?.name).toBe("FooCard");
  });

  test("an unreadable candidate is skipped rather than thrown", () => {
    // Candidate path exists but is a directory, so readFileSync throws EISDIR
    // (portable across platforms, unlike EACCES). A miss becomes a diagnostic
    // and never stops the scan.
    const dir = stage("unreadable", {
      declarations: {
        ".nuxt/types/components.d.ts": extendsAugmentation(
          `  FooCard: typeof import("../../app/components/FooCard.vue")['default']`,
        ),
      },
      files: ["app/components/FooCard.vue"],
    });
    mkdirSync(join(dir, ".nuxt", "components.d.ts"), { recursive: true });
    expect(() => loadGlobalComponents(dir)).not.toThrow();
    expect(loadGlobalComponents(dir)?.lookup("foo-card")?.name).toBe("FooCard");
  });
});

describe("detectAutoImportFramework", () => {
  test("detects a nuxt dependency and names the expected declaration path", () => {
    const dir = stage("nuxt-dep", { pkg: { dependencies: { nuxt: "^4.0.0" } } });
    rmSync(join(dir, ".nuxt"), { recursive: true, force: true });
    expect(detectAutoImportFramework(dir)).toEqual({
      expectedPath: join(dir, ".nuxt", "components.d.ts"),
    });
  });

  test("names the absent candidate when a sibling declaration exists", () => {
    // Nuxt 4 leaves a populated `.nuxt/components.d.ts` behind; the missing
    // artefact is the augmentation under `.nuxt/types/`, so that is the path
    // the diagnostic must name.
    const dir = stage("nuxt4-partial", {
      declarations: {
        ".nuxt/components.d.ts": `export const FooCard: typeof import("../app/components/FooCard.vue")['default']\n`,
      },
      pkg: { dependencies: { nuxt: "^4.0.0" } },
    });
    expect(detectAutoImportFramework(dir)).toEqual({
      expectedPath: join(dir, ".nuxt", "types", "components.d.ts"),
    });
  });

  test("returns null without a nuxt dependency or without a package.json", () => {
    const plain = stage("plain-app", { pkg: { dependencies: { vue: "^3.0.0" } } });
    expect(detectAutoImportFramework(plain)).toBeNull();
    const empty = stage("empty-app", {});
    expect(detectAutoImportFramework(empty)).toBeNull();
  });
});
