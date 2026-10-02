import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "@scoutui/reference-graph";
import { runVueScan } from "./test-utils.js";

/**
 * The kebab-tag fallback on .vue templates: hyphenated tags that match no
 * script binding and no CEM entry, the "Vuetify-style auto-import" shape.
 */

describe("parser-vue: kebab tag fallback (Vue auto-import)", () => {
  it("emits hyphenated tags as custom-element (tagName preserved)", () => {
    const fixture = join(__dirname, "fixtures", "vuetify-style.vue");
    const source = readFileSync(fixture, "utf8");

    // No moduleResolver: every hyphenated tag is a `custom-element` of
    // unknown source.
    const { occurrences } = runVueScan({ source, file: "vuetify-style.vue" });

    const ceOccurrences = occurrences.filter((o) => o.rawComponentId?.kind === "custom-element");
    const tagNames = ceOccurrences
      .map((o) => {
        if (o.rawComponentId?.kind !== "custom-element") throw new Error("expected custom-element");
        return o.rawComponentId.tagName;
      })
      .sort();
    expect(tagNames).toEqual(["v-btn", "v-col", "v-data-table", "v-row"]);

    // All hyphenated tags emit with `source: { type: "unknown" }` and
    // via.kind "html-tag": the engine took the TagUsage branch, not
    // vue-template.
    for (const occ of ceOccurrences) {
      if (occ.rawComponentId?.kind !== "custom-element") throw new Error("expected custom-element");
      expect(occ.rawComponentId.source).toEqual({ type: "unknown" });
      expect(occ.via).toEqual({ kind: "html-tag" });
    }

    // No vue-component occurrences should be emitted for these bare hyphenated tags.
    const vueOccurrences = occurrences.filter((o) => o.rawComponentId?.kind === "vue-component");
    expect(vueOccurrences).toHaveLength(0);
  });
});

describe("parser-vue: a tag is admitted by the custom element name grammar", () => {
  it("admits a valid custom element name, not a reserved one, and not a built-in", () => {
    const collector = createDiagnosticCollector();
    const { occurrences } = runVueScan({
      source: "<template><div><font-face></font-face><x-card></x-card><Transition><p /></Transition></div></template>",
      file: "Page.vue",
      collector,
    });
    expect(occurrences.map((o) => o.rawComponentId)).toEqual([
      { kind: "custom-element", tagName: "x-card", source: { type: "unknown" } },
    ]);
    expect(collector.drain()).toEqual([]);
  });
});
