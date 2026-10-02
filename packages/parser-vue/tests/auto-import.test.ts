import { describe, expect, test } from "vitest";
import { runVueScan } from "./test-utils.js";
import { vueTagForms } from "../src/emit-template.js";

const CARD_SFC = "<template><div>card</div></template>";

/** Map stub mirroring the manifest reader's output for one component. */
function mapFor(entries: Record<string, { specifier: string; imported: string; name: string }>) {
  return (tagForm: string) => entries[tagForm];
}

describe("auto-import resolution", () => {
  const AUTO = mapFor(
    Object.fromEntries(
      vueTagForms("FooCard").map((f) => [
        f,
        { specifier: "/repo/app/components/FooCard.vue", imported: "default", name: "FooCard" },
      ]),
    ),
  );
  const moduleResolver = (_from: string, spec: string) =>
    spec === "/repo/app/components/FooCard.vue" || spec === "../components/FooCard.vue"
      ? "/repo/app/components/FooCard.vue"
      : null;
  const extraFiles = [
    { file: "app/components/FooCard.vue", source: CARD_SFC, sfcSymbol: "FooCard" },
  ];

  test("auto-imported PascalCase tag resolves to a local identity pinned to the definition file", () => {
    const { occurrences } = runVueScan({
      source: `<template><FooCard title="x" /></template>`,
      file: "app/pages/index.vue",
      repoRoot: "/repo",
      resolveAutoImport: AUTO,
      moduleResolver,
      extraFiles,
    });
    const occ = occurrences.find((o) => o.rawComponentId?.source.type === "local");
    expect(occ?.rawComponentId).toMatchObject({
      kind: "vue-component",
      export: "FooCard",
      source: { type: "local", filePath: "app/components/FooCard.vue" },
    });
  });

  test("auto-imported identity equals the explicit-import identity (equality invariant)", () => {
    const auto = runVueScan({
      source: "<template><FooCard /></template>",
      file: "app/pages/a.vue",
      repoRoot: "/repo",
      resolveAutoImport: AUTO,
      moduleResolver,
      extraFiles,
    }).occurrences.find((o) => o.rawComponentId?.source.type === "local");
    const explicit = runVueScan({
      source: `<template><FooCard /></template>\n<script setup>import FooCard from "../components/FooCard.vue";</script>`,
      file: "app/pages/b.vue",
      repoRoot: "/repo",
      moduleResolver,
      extraFiles,
    }).occurrences.find((o) => o.rawComponentId?.source.type === "local");
    expect(auto?.rawComponentId).toBeDefined();
    expect(auto?.rawComponentId).toEqual(explicit?.rawComponentId);
  });

  test("kebab-addressed auto-import resolves through the map, not the custom-element lane", () => {
    const { occurrences } = runVueScan({
      source: "<template><foo-card /></template>",
      file: "app/pages/index.vue",
      repoRoot: "/repo",
      resolveAutoImport: AUTO,
      moduleResolver,
      extraFiles,
    });
    const occ = occurrences.find((o) => o.rawComponentId?.source.type === "local");
    expect(occ?.rawComponentId?.source).toEqual({ type: "local", filePath: "app/components/FooCard.vue" });
  });

  test("script binding wins over a poisoned auto-import decoy", () => {
    const decoy = mapFor(
      Object.fromEntries(
        vueTagForms("FooCard").map((f) => [
          f,
          { specifier: "/DECOY/wrong.vue", imported: "default", name: "FooCard" },
        ]),
      ),
    );
    const { occurrences } = runVueScan({
      source: `<template><FooCard /></template>\n<script setup>import FooCard from "../components/FooCard.vue";</script>`,
      file: "app/pages/index.vue",
      repoRoot: "/repo",
      resolveAutoImport: decoy,
      moduleResolver,
      extraFiles,
    });
    const occ = occurrences.find((o) => o.rawComponentId?.source.type === "local");
    expect(occ?.rawComponentId?.source).toEqual({ type: "local", filePath: "app/components/FooCard.vue" });
  });

  test("synthetic import is deduped per SFC across repeated usages", () => {
    const { occurrences, fileGraph } = runVueScan({
      source: "<template><div><FooCard /><FooCard /></div></template>",
      file: "app/pages/index.vue",
      repoRoot: "/repo",
      resolveAutoImport: AUTO,
      moduleResolver,
      extraFiles,
    });
    expect(occurrences.filter((o) => o.rawComponentId?.source.type === "local")).toHaveLength(2);
    expect(fileGraph.imports).toHaveLength(1);
  });

  test("Lazy variant converges on the same identity as the base name", () => {
    const withLazy = mapFor({
      ...Object.fromEntries(
        vueTagForms("FooCard").map((f) => [
          f,
          { specifier: "/repo/app/components/FooCard.vue", imported: "default", name: "FooCard" },
        ]),
      ),
      ...Object.fromEntries(
        vueTagForms("LazyFooCard").map((f) => [
          f,
          { specifier: "/repo/app/components/FooCard.vue", imported: "default", name: "LazyFooCard" },
        ]),
      ),
    });
    const base = runVueScan({
      source: "<template><FooCard /></template>",
      file: "app/pages/a.vue",
      repoRoot: "/repo",
      resolveAutoImport: withLazy,
      moduleResolver,
      extraFiles,
    }).occurrences.find((o) => o.rawComponentId?.source.type === "local");
    const lazy = runVueScan({
      source: "<template><LazyFooCard /></template>",
      file: "app/pages/b.vue",
      repoRoot: "/repo",
      resolveAutoImport: withLazy,
      moduleResolver,
      extraFiles,
    }).occurrences.find((o) => o.rawComponentId?.source.type === "local");
    expect(base?.rawComponentId).toBeDefined();
    expect(base?.rawComponentId).toEqual(lazy?.rawComponentId);
  });

  test("lowercase unknown tags are not observed", () => {
    const { occurrences } = runVueScan({
      source: "<template><div><madeuptag /></div></template>",
      file: "app/pages/index.vue",
    });
    expect(occurrences).toEqual([]);
  });
});
