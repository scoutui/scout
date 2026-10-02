import { describe, expect, it } from "vitest";
import { runVueScan } from "./test-utils.js";

/**
 * The "opportunistic" Vue paths: script-bound PascalCase imports from external
 * packages, hyphenated auto-import and runtime tag fallbacks, and relative
 * imports that resolve to a workspace-local SFC, checked on the engine's
 * resolve output.
 */

describe("parser-vue: opportunistic external + local resolution pipeline", () => {
  it("emits a vue-component identity for a template usage of an unmapped node_modules import", () => {
    // Script-bound PascalCase tag → JSX usage path. moduleResolver returns
    // null (the external package isn't in the graph), so the engine takes
    // the "target not in graph" external branch and emits a vue-component
    // with `source.type: "external"` derived from the import specifier.
    const source = `<template>
  <Button variant="primary" />
</template>
<script setup lang="ts">
import { Button } from "@example/unmapped-vue";
</script>`;
    const { occurrences } = runVueScan({ source, file: "App.vue" });
    expect(occurrences).toHaveLength(1);
    const occ = occurrences[0]!;
    expect(occ.rawComponentId).toEqual({
      kind: "vue-component",
      export: "Button",
      source: { type: "external", package: "@example/unmapped-vue" },
    });
    expect(occ.via).toEqual({
      kind: "vue-template",
      specifier: "@example/unmapped-vue",
      import: "Button",
    });
  });

  it("emits unknown-source custom-element (tagName preserved) for a hyphenated tag with no script binding", () => {
    // Hyphenated tag with no script binding → engine emits
    // `custom-element` with `source: { type: "unknown" }`. via.kind is
    // `html-tag` (TagUsage path), not `vue-template`.
    const source = `<template>
  <foo-bar-element variant="primary" />
</template>
<script setup lang="ts">
</script>`;
    const { occurrences } = runVueScan({ source, file: "App.vue" });
    expect(occurrences).toHaveLength(1);
    const occ = occurrences[0]!;
    expect(occ.rawComponentId).toEqual({
      kind: "custom-element",
      tagName: "foo-bar-element",
      source: { type: "unknown" },
    });
    expect(occ.via).toEqual({ kind: "html-tag" });
  });

  it("never invents a package for an alias-style specifier the resolver does not resolve", () => {
    // `@/` has an empty scope, so it names no npm package: the engine has no
    // alias awareness of its own, and an alias the moduleResolver does not
    // resolve is a module it cannot find.
    const source = `<template>
  <Button />
</template>
<script setup lang="ts">
import { Button } from "@/aliased-button";
</script>`;
    const { occurrences } = runVueScan({ source, file: "AliasApp.vue" });
    expect(occurrences).toHaveLength(1);
    const occ = occurrences[0]!;
    expect(occ.rawComponentId).toBeUndefined();
    expect(occ.unresolved).toEqual({ kind: "module-not-found" });
    expect(occ.via).toEqual({
      kind: "vue-template",
      specifier: "@/aliased-button",
      import: "Button",
    });
  });

  it("emits a vue-component identity with source: local when the relative import resolves to a workspace SFC", () => {
    // The consumer SFC imports a sibling .vue file by relative specifier. The
    // engine canonicalises it with moduleResolver, finds a JSX terminal in the
    // graph there and emits a vue-component with
    // `source: { type: "local", filePath: <canonical> }`. runVueScan's
    // `extraFiles` puts the sibling SFC in the graph.
    const consumer = `<template>
  <InternalButton />
</template>
<script setup lang="ts">
import InternalButton from "./components/InternalButton.vue";
</script>`;
    const internal = "<template><button /></template>";
    const localFilePath = "src/components/InternalButton.vue";
    const consumerFile = "src/App.vue";
    const { occurrences } = runVueScan({
      source: consumer,
      file: consumerFile,
      moduleResolver: (from, spec) => {
        // Graph keys are repo-relative POSIX paths, so resolve the specifier
        // against the importer's directory.
        if (spec === "./components/InternalButton.vue" && from === consumerFile) {
          return localFilePath;
        }
        return null;
      },
      extraFiles: [{ file: localFilePath, source: internal, sfcSymbol: "InternalButton" }],
    });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.rawComponentId).toEqual({
      kind: "vue-component",
      export: "InternalButton",
      source: { type: "local", filePath: localFilePath },
    });
  });

  it("observes a local template usage as module-not-found when the relative import doesn't resolve", () => {
    // Same shape as above, but moduleResolver returns null (the target
    // isn't in the graph and the resolver can't locate it).
    const consumer = `<template>
  <InternalButton />
</template>
<script setup lang="ts">
import InternalButton from "./components/InternalButton.vue";
</script>`;
    const { occurrences } = runVueScan({
      source: consumer,
      file: "src/App.vue",
      moduleResolver: () => null,
    });
    expect(occurrences.map((o) => o.unresolved)).toEqual([{ kind: "module-not-found" }]);
  });
});
