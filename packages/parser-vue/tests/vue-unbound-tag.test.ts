import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "@scoutui/reference-graph";
import { runVueScan } from "./test-utils.js";

describe("parser-vue: an uppercase tag nothing binds", () => {
  it("is observed as an unresolved unbound-name occurrence, not diagnosed", () => {
    const collector = createDiagnosticCollector();
    const { occurrences } = runVueScan({
      source: `<template><div><MissingThing size="lg" /></div></template>`,
      file: "src/Page.vue",
      sfcSymbol: "Page",
      collector,
    });
    expect(occurrences.map((o) => o.unresolved)).toEqual([{ kind: "unbound-name", name: "MissingThing" }]);
    expect(occurrences[0]).toMatchObject({ line: 1, props: { size: expect.anything() } });
    expect(occurrences[0]?.rawOwnerComponentId).toMatchObject({ export: "Page", source: { filePath: "src/Page.vue" } });
    expect(collector.drain()).toEqual([]);
  });

  it("names the whole authored tag, underscores included", () => {
    const { occurrences } = runVueScan({ source: "<template><My_Comp /></template>" });
    expect(occurrences.map((o) => o.unresolved)).toEqual([{ kind: "unbound-name", name: "My_Comp" }]);
  });
});

describe("parser-vue: a dotted tag whose head the script imports", () => {
  it("credits the member of a named import", () => {
    const { occurrences } = runVueScan({
      source: `<template><Form.Item label="Name" /></template>
<script setup lang="ts">
import { Form } from "@example/ui";
</script>`,
    });
    expect(occurrences.map((o) => o.rawComponentId)).toEqual([
      { kind: "vue-component", export: "Form.Item", source: { type: "external", package: "@example/ui" } },
    ]);
  });

  it("credits the export a namespace import's member names", () => {
    const { occurrences } = runVueScan({
      source: `<template><UI.Button /></template>
<script setup lang="ts">
import * as UI from "@example/ui";
</script>`,
    });
    expect(occurrences.map((o) => o.rawComponentId)).toEqual([
      { kind: "vue-component", export: "Button", source: { type: "external", package: "@example/ui" } },
    ]);
  });

  const MENU = { file: "src/Menu.vue", source: "<template><ul><slot /></ul></template>", sfcSymbol: "Menu" };
  const toMenu = (_from: string, spec: string) => (spec === "./Menu.vue" ? "/repo/src/Menu.vue" : null);

  it.each([
    ["a member the imported SFC does not have", `import Menu from "./Menu.vue";`, "Menu.Item", "default"],
    ["a member the namespace-imported module does not export", `import * as Nav from "./Menu.vue";`, "Nav.Item", "*"],
  ])("observes %s as unbound-name, naming the dotted tag", (_label, importLine, tag, imported) => {
    const collector = createDiagnosticCollector();
    const { occurrences } = runVueScan({
      source: `<template><${tag} label="Home" /></template>\n<script setup lang="ts">\n${importLine}\n</script>`,
      file: "src/App.vue",
      sfcSymbol: "App",
      repoRoot: "/repo",
      moduleResolver: toMenu,
      extraFiles: [MENU],
      collector,
    });
    expect(occurrences.map((o) => [o.unresolved, o.viaChain])).toEqual([
      [{ kind: "unbound-name", name: tag }, [{ kind: "direct-import", specifier: "./Menu.vue", import: imported }]],
    ]);
    expect(occurrences[0]).toMatchObject({ props: { label: expect.anything() } });
    expect(occurrences[0]?.rawOwnerComponentId).toMatchObject({ export: "App", source: { filePath: "src/App.vue" } });
    expect(collector.drain()).toEqual([]);
  });

  it.each([
    ["default-exports its options", `<script>\nimport Item from "./MenuItem.vue";\nexport default { name: "Menu", Item };\n</script>`],
    ["passes its options to defineOptions", `<script setup lang="ts">\nimport Item from "./MenuItem.vue";\ndefineOptions({ Item });\n</script>`],
  ])("claims nothing for a member of an imported SFC whose script %s", (_label, script) => {
    const collector = createDiagnosticCollector();
    const { occurrences } = runVueScan({
      source: `<template><Menu.Item label="Home" /></template>\n<script setup lang="ts">\nimport Menu from "./Menu.vue";\n</script>`,
      file: "src/App.vue",
      sfcSymbol: "App",
      repoRoot: "/repo",
      moduleResolver: toMenu,
      extraFiles: [{ ...MENU, source: `<template><ul><slot /></ul></template>\n${script}` }],
      collector,
    });
    expect(occurrences).toEqual([]);
    expect(collector.drain()).toEqual([]);
  });

  it("claims nothing for a name an SFC's script exports beside its default", () => {
    const { occurrences } = runVueScan({
      source: `<template><Named.Item /></template>\n<script setup lang="ts">\nimport { Named } from "./Menu.vue";\n</script>`,
      file: "src/App.vue",
      sfcSymbol: "App",
      repoRoot: "/repo",
      moduleResolver: toMenu,
      extraFiles: [{ ...MENU, source: "<template><ul><slot /></ul></template>\n<script>\nexport const Named = {};\n</script>" }],
    });
    expect(occurrences).toEqual([]);
  });
});

describe("parser-vue: an uppercase tag the SFC binds outside its imports", () => {
  it("claims nothing for a component declared in <script setup>", () => {
    const { occurrences } = runVueScan({
      source: `<template><Lazy /><Alias /></template>
<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import Real from "./Real.vue";
const Lazy = defineAsyncComponent(() => import("./Heavy.vue"));
const Alias = Real;
</script>`,
    });
    expect(occurrences).toEqual([]);
  });

  it("claims nothing for a component registered under components:", () => {
    const { occurrences } = runVueScan({
      source: `<template><Foo /></template>
<script lang="ts">
import FooImpl from "./FooImpl.vue";
export default { components: { Foo: FooImpl } };
</script>`,
    });
    expect(occurrences).toEqual([]);
  });

  it("claims nothing for a component imported in the plain <script> beside <script setup>", () => {
    const { occurrences } = runVueScan({
      source: `<template><Panel /></template>
<script lang="ts">
import Panel from "./Panel.vue";
export default { inheritAttrs: false };
</script>
<script setup lang="ts">
const title = "x";
</script>`,
    });
    expect(occurrences).toEqual([]);
  });
});
