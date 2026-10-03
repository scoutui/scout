import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkspaceGraph } from "../../../src/workspace/build-graph.js";
import { buildPackageAliasLayers } from "../../../src/walker/package-alias-layers.js";
import { createImportResolver } from "../../../src/walker/resolve-import.js";

describe("per-package tsconfig alias layers", () => {
  let stage: string;

  beforeAll(() => {
    stage = realpathSync(mkdtempSync(join(tmpdir(), "cc-pkg-alias-")));
    writeFileSync(
      join(stage, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["apps/*"] }),
    );
    for (const app of ["one", "two"]) {
      const dir = join(stage, "apps", app);
      mkdirSync(join(dir, "src", "components"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@f/${app}` }));
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
      );
    }
    writeFileSync(join(stage, "apps", "one", "src", "components", "card.tsx"), "export const Card = 1;");
    writeFileSync(join(stage, "apps", "two", "src", "components", "panel.tsx"), "export const Panel = 1;");
  });

  afterAll(() => rmSync(stage, { recursive: true, force: true }));

  it("resolves the same alias to per-app targets keyed by the importing file's package", () => {
    const graph = buildWorkspaceGraph(stage);
    const layers = buildPackageAliasLayers(graph).layers;
    expect(layers).toHaveLength(2);
    const resolve = createImportResolver({ repoRoot: stage, workspaceGraph: graph, packageAliasLayers: layers });
    expect(resolve(join(stage, "apps", "one", "src", "App.tsx"), "@/components/card"))
      .toBe(join(stage, "apps", "one", "src", "components", "card.tsx"));
    expect(resolve(join(stage, "apps", "two", "src", "App.tsx"), "@/components/panel"))
      .toBe(join(stage, "apps", "two", "src", "components", "panel.tsx"));
    // App one's alias doesn't see app two's tree.
    expect(resolve(join(stage, "apps", "one", "src", "App.tsx"), "@/components/panel")).toBeNull();
  });
});
