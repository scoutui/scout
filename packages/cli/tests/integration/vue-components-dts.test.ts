import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

/**
 * A Vue app whose components are imported automatically, as
 * `unplugin-vue-components` does: templates use them with no script import,
 * and the plugin's `components.d.ts` names where each comes from. The plugin
 * writes it at the project root by default; `src/components.d.ts` is the
 * common alternative.
 */
const LAYOUTS = [
  { name: "components.d.ts at the project root", app: "project-root" },
  { name: "components.d.ts in src/", app: "src-folder" },
] as const;

describe.each(LAYOUTS)("integration: vue-components-dts, $name", ({ app }) => {
  let out: ScanArtifact;

  beforeAll(async () => {
    ({ artifact: out } = await scanFixture("vue-components-dts", { args: ["--quiet"], cwd: app }));
  }, 120_000);

  it("credits each template tag to what the declaration names, and leaves undeclared tags as they were", () => {
    const identityOf = new Map(out.components.map((c) => [c.id, c.identity]));
    const rendered = out.occurrences
      .filter((o) => o.filePath === `${app}/src/App.vue`)
      .sort((a, b) => a.line - b.line)
      .map((o) => [o.line, o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution]);

    const kitButton = { kind: "package-export", packageName: "@example/vue-kit", publicEntry: "es", exportName: "KitButton" };
    expect(rendered).toEqual([
      [2, kitButton],
      [3, kitButton],
      [
        4,
        {
          kind: "repository-declaration",
          repoId: "vue-components-dts",
          filePath: `${app}/src/components/TheCounter.vue`,
          exportName: "TheCounter",
        },
      ],
      [5, { kind: "tag", tagName: "x-widget" }],
      [6, { status: "unresolved", reason: { kind: "unbound-name", name: "MysteryWidget" } }],
    ]);
  });
});
