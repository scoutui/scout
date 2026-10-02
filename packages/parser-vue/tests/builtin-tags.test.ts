import { describe, expect, test } from "vitest";
import { runVueScan } from "./test-utils.js";

/**
 * Vue's built-in components are language constructs, not components a repo
 * consumes. They resolve through none of emit-template's lanes, so without
 * the built-in tag table every `<Transition>` would be observed as an
 * unresolved component.
 */
describe("Vue built-in tags", () => {
  const BUILTINS = [
    "Teleport",
    "Transition",
    "TransitionGroup",
    "KeepAlive",
    "Suspense",
    "BaseTransition",
    "Component",
  ];

  test.each(BUILTINS)("<%s> emits no occurrence", (tag) => {
    const { occurrences } = runVueScan({
      source: `<template><${tag}><div>child</div></${tag}></template>`,
      file: "app/pages/index.vue",
    });
    expect(occurrences).toEqual([]);
  });

  test.each(["transition-group", "keep-alive", "base-transition"])(
    "kebab-cased <%s> is not emitted as a custom-element tag",
    (tag) => {
      const { occurrences } = runVueScan({
        source: `<template><${tag}><div>child</div></${tag}></template>`,
        file: "app/pages/index.vue",
      });
      expect(occurrences).toEqual([]);
    },
  );

  // `resolveComponentType` (@vue/compiler-core) returns on
  // `isCoreComponent(tag) || context.isBuiltInComponent(tag)` before it
  // consults `resolveSetupReference`, so the import is shadowed at runtime.
  // Attributing the call site to it would report usage of a component the
  // page never mounts.
  test("a script-imported component named Transition is shadowed by the built-in", () => {
    const { occurrences } = runVueScan({
      source: [
        "<template><Transition /></template>",
        `<script setup>import { Transition } from "@example/ds";</script>`,
      ].join("\n"),
      file: "app/pages/index.vue",
    });
    expect(occurrences).toEqual([]);
  });

  test("an auto-imported component named Transition is shadowed by the built-in", () => {
    const { occurrences } = runVueScan({
      source: "<template><Transition /></template>",
      file: "app/pages/index.vue",
      resolveAutoImport: (form) =>
        form === "transition"
          ? { specifier: "/repo/app/components/Transition.vue", imported: "default", name: "Transition" }
          : undefined,
    });
    expect(occurrences).toEqual([]);
  });

  test("a same-named component the repo imports under a different tag is untouched", () => {
    const { occurrences } = runVueScan({
      source: [
        "<template><DsTransition /></template>",
        `<script setup>import { Transition as DsTransition } from "@example/ds";</script>`,
      ].join("\n"),
      file: "app/pages/index.vue",
    });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId).toMatchObject({
      export: "Transition",
      source: { type: "external", package: "@example/ds" },
    });
  });

  test("a non-built-in uppercase tag is still observed", () => {
    const { occurrences } = runVueScan({
      source: "<template><VDropdown /></template>",
      file: "app/pages/index.vue",
    });
    expect(occurrences.map((o) => o.unresolved)).toEqual([{ kind: "unbound-name", name: "VDropdown" }]);
  });
});
