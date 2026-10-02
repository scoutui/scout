import { describe, it, expect } from "vitest";
import { runVueScan } from "./test-utils.js";

/**
 * The .vue parse path, checked on the engine's resolve output. `runVueScan`
 * (test-utils.ts) does what `cli/src/commands/scan.ts` does for a single
 * .vue file.
 */


describe("parser-vue: .vue pipeline (engine output)", () => {
  it("detects custom element inside SFC template", () => {
    const sfc = `
<template>
  <fake-button variant="primary" :size="dyn" @click="onClick">Hi</fake-button>
</template>
<script setup lang="ts">
const dyn = "lg";
function onClick() {}
</script>`;
    const { occurrences } = runVueScan({ source: sfc });
    expect(occurrences).toHaveLength(1);
    const occ = occurrences[0]!;
    expect(occ.rawComponentId).toEqual({
      kind: "custom-element",
      tagName: "fake-button",
      source: { type: "unknown" },
    });
    expect(occ.via).toEqual({ kind: "html-tag" });
    // `:size="dyn"` is a bare-identifier binding, so a `reference` entry
    // (captured by name, not opaque); `variant="primary"` is a static
    // attribute, so a `written` entry.
    expect(occ.props.size).toEqual({ tier: "reference", ref: "dyn" });
    expect(occ.props.variant).toEqual({ tier: "written", value: "primary" });
  });

  it("returns empty when no tracked tags", () => {
    const sfc = "<template><div /></template>";
    const { occurrences } = runVueScan({ source: sfc });
    expect(occurrences).toHaveLength(0);
  });

  it("emits script imports with local binding name", () => {
    const sfc = `
<template>
  <WebAction>One</WebAction>
  <WebAction>Two</WebAction>
</template>
<script setup lang="ts">
import WebAction from "../components/WebAction.vue";
import { Util as U } from "./util.js";
</script>`;
    const { fileGraph } = runVueScan({
      source: sfc,
      file: "pages/index.vue",
    });
    expect(fileGraph.imports).toHaveLength(2);
    expect(fileGraph.imports[0]).toMatchObject({
      specifier: "../components/WebAction.vue",
      imported: "default",
      local: "WebAction",
    });
    expect(fileGraph.imports[1]).toMatchObject({
      specifier: "./util.js",
      imported: "Util",
      local: "U",
    });
  });

  it("emits imports even when template has no tracked tags", () => {
    const sfc = `
<template><div /></template>
<script setup lang="ts">
import Foo from "./Foo.vue";
</script>`;
    const { occurrences, fileGraph } = runVueScan({ source: sfc, file: "Bar.vue" });
    expect(occurrences).toHaveLength(0);
    expect(fileGraph.imports).toHaveLength(1);
    expect(fileGraph.imports[0]?.local).toBe("Foo");
  });

  it("direct Vue DS import emits vue-component occurrence (PascalCase tag form)", () => {
    const sfc = `<script setup>\nimport { VBtn } from "@x/vue-ds";\n</script>\n<template><VBtn variant="secondary" /></template>`;
    const { occurrences } = runVueScan({ source: sfc, file: "Page.vue" });
    const occ = occurrences.find((o) => o.rawComponentId?.kind === "vue-component");
    expect(occ).toBeDefined();
    expect(occ?.rawComponentId).toEqual({
      kind: "vue-component",
      export: "VBtn",
      source: { type: "external", package: "@x/vue-ds" },
    });
    expect(occ?.via).toEqual({
      kind: "vue-template",
      specifier: "@x/vue-ds",
      import: "VBtn",
    });
  });

  it("direct Vue DS import matches kebab-case tag form", () => {
    const sfc = `<script setup>\nimport { VBtn } from "@x/vue-ds";\n</script>\n<template><v-btn /></template>`;
    const { occurrences } = runVueScan({ source: sfc, file: "Page.vue" });
    const occ = occurrences.find((o) => o.rawComponentId?.kind === "vue-component");
    expect(occ).toBeDefined();
    expect(occ?.rawComponentId).toEqual({
      kind: "vue-component",
      export: "VBtn",
      source: { type: "external", package: "@x/vue-ds" },
    });
    expect(occ?.via).toEqual({
      kind: "vue-template",
      specifier: "@x/vue-ds",
      import: "VBtn",
    });
  });

  it("a component imported under a lowercase camelCase name is credited at its kebab-case tag", () => {
    const sfc = `<script setup>\nimport vSelect from "fake-select";\n</script>\n<template><v-select :options="opts" /></template>`;
    const { occurrences } = runVueScan({ source: sfc, file: "Page.vue" });
    expect(occurrences.map((o) => o.rawComponentId)).toEqual([
      { kind: "vue-component", export: "default", source: { type: "external", package: "fake-select" } },
    ]);
  });

  it("a component imported under a lowercase name in an Options API script is credited at its tag through the import binding", () => {
    const sfc = `<script>\nimport draggable from "fake-draggable";\nexport default { components: { draggable } };\n</script>\n<template><draggable :list="items" /></template>`;
    const { occurrences } = runVueScan({ source: sfc, file: "Page.vue" });
    expect(occurrences.map((o) => o.rawComponentId)).toEqual([
      { kind: "vue-component", export: "default", source: { type: "external", package: "fake-draggable" } },
    ]);
  });
});

describe("parser-vue: SFC without script block", () => {
  it("accepts an SFC that has no script block and still emits tracked tags", () => {
    const src = "<template><fake-button /></template>";
    const { occurrences } = runVueScan({ source: src });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toEqual({
      kind: "custom-element",
      tagName: "fake-button",
      source: { type: "unknown" },
    });
  });
});
