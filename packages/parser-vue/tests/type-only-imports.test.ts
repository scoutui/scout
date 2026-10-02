import { describe, expect, test } from "vitest";
import { extractScriptImports } from "../src/script-imports.js";
import { parseSync } from "oxc-parser";
import { runVueScan } from "./test-utils.js";

function specsFor(script: string) {
  const program = parseSync("script.ts", script).program;
  return extractScriptImports({ file: "app/pages/index.vue", program }).importSpecs;
}

/**
 * A type-only import has no runtime value, so it never claims a template tag
 * of the same name: the tag stays free for the auto-import lane.
 */
describe("type-only script imports", () => {
  test("`import type { A }` produces no binding", () => {
    expect(specsFor(`import type { A } from "a";`)).toEqual([]);
  });

  test("`import type A` (default) produces no binding", () => {
    expect(specsFor(`import type A from "a";`)).toEqual([]);
  });

  test("inline `type` specifiers are dropped, value siblings survive", () => {
    expect(specsFor(`import { type B, C } from "b";`)).toEqual([
      { local: "C", imported: "C", source: "b" },
    ]);
  });

  test("ordinary value imports are untouched", () => {
    expect(specsFor(`import D, { E as F } from "d";`)).toEqual([
      { local: "D", imported: "default", source: "d" },
      { local: "F", imported: "E", source: "d" },
    ]);
  });

  test("a tag matching a type-only import is not attributed to it", () => {
    const { occurrences } = runVueScan({
      source: [
        "<template><Paginator /></template>",
        `<script setup lang="ts">import type { Paginator } from "#components";</script>`,
      ].join("\n"),
      file: "app/pages/index.vue",
    });
    expect(occurrences.map((o) => [o.unresolved, o.viaChain])).toEqual([
      [{ kind: "unbound-name", name: "Paginator" }, [{ kind: "local-component" }]],
    ]);
  });

  test("the auto-import lane still resolves a tag shadowed by a type-only import", () => {
    const { occurrences } = runVueScan({
      source: [
        "<template><Paginator /></template>",
        `<script setup lang="ts">import type { Paginator } from "#components";</script>`,
      ].join("\n"),
      file: "app/pages/index.vue",
      repoRoot: "/repo",
      resolveAutoImport: (form) =>
        form === "paginator"
          ? { specifier: "/repo/app/components/Paginator.vue", imported: "default", name: "Paginator" }
          : undefined,
      moduleResolver: (_f, s) =>
        s === "/repo/app/components/Paginator.vue" ? "/repo/app/components/Paginator.vue" : null,
      extraFiles: [
        { file: "app/components/Paginator.vue", source: "<template><div/></template>", sfcSymbol: "Paginator" },
      ],
    });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.rawComponentId?.source).toEqual({
      type: "local",
      filePath: "app/components/Paginator.vue",
    });
  });
});
