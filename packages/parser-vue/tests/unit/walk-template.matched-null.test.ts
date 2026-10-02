import { describe, it, expect } from "vitest";
import { runVueScan } from "../test-utils.js";

/**
 * When an SFC's script imports the same package through two subpaths (e.g.
 * `pkg/dist/button/index.js` and `pkg/dist/card/index.js`), each occurrence's
 * identity carries its subpath as `source.publicEntry`, so the scan file
 * treats them as separate components. The engine takes `publicEntry` from the
 * import specifier in `externalSource()`, so no resolver hit is needed.
 */

describe("walk-template: subpath publicEntry disambiguation", () => {
  it("emits vue-component occurrence with publicEntry for a subpath import", () => {
    const sfc = `
<script setup>
import { SlButton } from "@example/shoelace/dist/react/button/index.js";
</script>
<template><SlButton variant="primary" /></template>
    `;
    const { occurrences } = runVueScan({ source: sfc, file: "src/Page.vue" });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.rawComponentId).toEqual({
      kind: "vue-component",
      export: "SlButton",
      source: {
        type: "external",
        package: "@example/shoelace",
        // publicEntry strips the trailing module extension; the subpath is retained.
        publicEntry: "dist/react/button/index",
      },
    });
  });

  it("disambiguates two subpath imports of the same package via distinct modulePaths", () => {
    const sfc = `
<script setup>
import { SlButton } from "@example/shoelace/dist/react/button/index.js";
import { SlCard } from "@example/shoelace/dist/react/card/index.js";
</script>
<template>
  <SlButton />
  <SlCard />
</template>
    `;
    const { occurrences } = runVueScan({ source: sfc, file: "src/Page.vue" });
    const fakeShoelaceOccs = occurrences.filter(
      (o) =>
        o.rawComponentId?.kind === "vue-component" &&
        o.rawComponentId.source.type === "external" &&
        o.rawComponentId.source.package === "@example/shoelace",
    );
    expect(fakeShoelaceOccs).toHaveLength(2);

    const modulePaths = fakeShoelaceOccs
      .map((o) => {
        if (
          o.rawComponentId?.kind === "vue-component" &&
          o.rawComponentId.source.type === "external"
        ) {
          return o.rawComponentId.source.publicEntry;
        }
        return undefined;
      })
      .sort();

    // Extension stripped on both; the button/card subpaths stay distinct.
    expect(modulePaths).toEqual([
      "dist/react/button/index",
      "dist/react/card/index",
    ]);
  });
});
