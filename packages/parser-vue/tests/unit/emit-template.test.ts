import { describe, it, expect } from "vitest";
import { parse as parseVueSfc } from "@vue/compiler-sfc";
import { parseSync as oxcParse } from "oxc-parser";
import { createGraphBuilder } from "@scoutui/reference-graph";
import { emitVueTemplate } from "../../src/emit-template.js";
import type { VueParseWrapper } from "../../src/parse-sfc.js";

function parseVueForTest(source: string): VueParseWrapper {
  const { descriptor } = parseVueSfc(source);
  const scriptContent = descriptor.scriptSetup?.content ?? descriptor.script?.content;
  if (scriptContent && scriptContent.length > 0) {
    const scriptProgram = oxcParse("script.ts", scriptContent).program;
    return { descriptor, scriptProgram };
  }
  return { descriptor };
}

describe("emitVueTemplate: skeleton", () => {
  it("emits nothing for an SFC with an empty template", () => {
    const sfc = "<template></template>";
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Empty.vue", "vue");
    emitVueTemplate({
      file: "src/Empty.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Empty.vue");
    expect(fg?.jsxUsages).toHaveLength(0);
    expect(fg?.tagUsages).toHaveLength(0);
  });

  it("emits nothing for an SFC with no template block", () => {
    const sfc = `<script setup lang="ts">const x = 1;</script>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/NoTemplate.vue", "vue");
    emitVueTemplate({
      file: "src/NoTemplate.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/NoTemplate.vue");
    expect(fg?.jsxUsages).toHaveLength(0);
    expect(fg?.tagUsages).toHaveLength(0);
  });
});

describe("emitVueTemplate: script imports", () => {
  it("emits a named ImportRecord for `import { Foo } from 'pkg'`", () => {
    const sfc = `
<script setup lang="ts">
import { Card } from "./components";
</script>
<template></template>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Page.vue");
    expect(fg?.imports).toHaveLength(1);
    expect(fg?.imports[0]).toMatchObject({
      specifier: "./components",
      imported: "Card",
      local: "Card",
    });
  });

  it("emits the SFC's default export as a JSX-returning BindingDecl + default ExportRecord", () => {
    const sfc = `
<script setup lang="ts">
const x = 1;
</script>
<template></template>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Page.vue")!;
    // BindingDecl keyed on the filename stem; isExported true.
    const decl = fg.declarations.get("0::Page");
    expect(decl).toBeDefined();
    expect(decl?.symbol).toBe("Page");
    expect(decl?.isExported).toBe(true);
    expect(decl?.value).toEqual({ kind: "Function", returns: [{ kind: "JSX" }] });
    // Paired default ExportRecord.
    expect(fg.exports).toHaveLength(1);
    expect(fg.exports[0]).toEqual({ kind: "default", local: "Page" });
  });

  it("emits default and named imports correctly", () => {
    const sfc = `
<script setup lang="ts">
import VBtn from "vue-btn-lib";
import { Card, Avatar as A } from "./components";
</script>
<template></template>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const imports = gb.build().files.get("src/Page.vue")?.imports ?? [];
    expect(imports).toHaveLength(3);
    expect(imports[0]).toMatchObject({ specifier: "vue-btn-lib", imported: "default", local: "VBtn" });
    expect(imports[1]).toMatchObject({ specifier: "./components", imported: "Card", local: "Card" });
    expect(imports[2]).toMatchObject({ specifier: "./components", imported: "Avatar", local: "A" });
  });
});

describe("emitVueTemplate: script-bound PascalCase tags", () => {
  it("kebab-fallback: emits a JsxUsage for `<v-btn/>` when VBtn is imported", () => {
    const sfc = `
<script setup lang="ts">
import VBtn from "vue-btn-lib";
</script>
<template>
  <v-btn />
</template>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Page.vue")!;
    expect(fg.jsxUsages).toHaveLength(1);
    expect(fg.jsxUsages[0]?.ref.symbol).toBe("VBtn");
    expect(fg.tagUsages).toHaveLength(0);
  });

  it("emits a JsxUsage for `<Card/>` when Card is imported in script", () => {
    const sfc = `
<script setup lang="ts">
import { Card } from "./components";
</script>
<template>
  <Card />
</template>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Page.vue")!;
    expect(fg.jsxUsages).toHaveLength(1);
    expect(fg.jsxUsages[0]?.ref.symbol).toBe("Card");
    expect(fg.jsxUsages[0]?.ref.memberChain).toEqual([]);
    expect(fg.tagUsages).toHaveLength(0);
  });
});

describe("emitVueTemplate: tag-only (no script binding)", () => {
  it("emits a TagUsage for `<web-button/>` with no script binding", () => {
    const sfc = `
<template>
  <web-button />
</template>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Page.vue")!;
    expect(fg.tagUsages).toHaveLength(1);
    expect(fg.tagUsages[0]?.tagName).toBe("web-button");
    expect(fg.jsxUsages).toHaveLength(0);
  });

  it("emits a PascalCase tag with no script binding as a usage of its name, with no import", () => {
    const sfc = `
<template>
  <Card />
</template>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Page.vue")!;
    expect(fg.jsxUsages.map((u) => u.ref.symbol)).toEqual(["Card"]);
    expect(fg.importsByLocal.size).toBe(0);
    expect(fg.tagUsages).toHaveLength(0);
  });

  it("ignores plain HTML", () => {
    const sfc = `
<template>
  <div><span>hi</span></div>
</template>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Page.vue")!;
    expect(fg.jsxUsages).toHaveLength(0);
    expect(fg.tagUsages).toHaveLength(0);
  });
});

describe("emitVueTemplate: event extraction", () => {
  it("extracts @/v-on event names onto the usage", () => {
    const sfc = `<template><example-modal @example-modal-close="onClose" v-on:click="x"/></template><script setup></script>`;
    const gb = createGraphBuilder({ moduleResolver: () => null });
    const fb = gb.beginFile("src/Page.vue", "vue");
    emitVueTemplate({
      file: "src/Page.vue",
      wrapper: parseVueForTest(sfc),
      fileBuilder: fb,
    });
    const fg = gb.build().files.get("src/Page.vue")!;
    const usage = fg.tagUsages[0]!;
    expect(usage.events).toEqual(["example-modal-close", "click"]);
  });
});
