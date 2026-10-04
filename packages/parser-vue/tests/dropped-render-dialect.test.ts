import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "@scoutui/reference-graph";
import { runVueScan } from "./test-utils.js";

describe("parser-vue: a tag bound to an import the scan can't load", () => {
  it("an authored <select> bound to an import outside the graph is observed and reports no unresolved-reference", () => {
    const collector = createDiagnosticCollector();
    const { occurrences, fileGraph } = runVueScan({
      source: `<script setup lang="ts">\nimport { Select } from "./enums";\n</script>\n<template><select /></template>`,
      file: "src/Page.vue",
      moduleResolver: () => "/repo/src/enums.ts",
      repoRoot: "/repo",
      collector,
    });
    expect(fileGraph.jsxUsages.map((u) => u.ref.symbol)).toContain("Select");
    expect(occurrences.map((o) => o.unresolved)).toEqual([{ kind: "module-not-found" }]);
    expect(collector.drain().filter((d) => d.code === "unresolved-reference")).toEqual([]);
  });

  it("a component imported under a lowercase name whose import fails is observed as module-not-found", () => {
    const collector = createDiagnosticCollector();
    const { occurrences } = runVueScan({
      source: `<script setup lang="ts">\nimport card from "./Card.vue";\n</script>\n<template><card /></template>`,
      file: "src/Page.vue",
      repoRoot: "/repo",
      collector,
    });
    expect(occurrences).toMatchObject([
      { filePath: "src/Page.vue", unresolved: { kind: "module-not-found" }, via: { specifier: "./Card.vue" } },
    ]);
    expect(collector.drain()).toEqual([]);
  });
});
