/**
 * TypeScript resolves a non-relative specifier against `compilerOptions.baseUrl`
 * before `node_modules`: under `"baseUrl": "."`, `app/Banner` names
 * `<baseUrl>/app/Banner.tsx`, not a package called `app`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildWorkspaceGraph } from "../../../src/workspace/build-graph.js";
import { buildPackageAliasLayers } from "../../../src/walker/package-alias-layers.js";
import { createImportResolver } from "../../../src/walker/resolve-import.js";

const fx = resolve(import.meta.dirname, "../../../../../test/fixtures/baseurl-imports");
const page = join(fx, "src/Page.tsx");

let stage: string | undefined;
afterEach(() => {
  if (stage) rmSync(stage, { recursive: true, force: true });
  stage = undefined;
});

function write(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("createImportResolver: tsconfig baseUrl", () => {
  it("resolves a bare specifier under baseUrl only when a file exists there", () => {
    const withBaseUrl = createImportResolver({ repoRoot: fx, tsconfigPath: join(fx, "tsconfig.json") });
    const withoutBaseUrl = createImportResolver({ repoRoot: fx });

    expect(withBaseUrl(page, "app/Banner")).toBe(join(fx, "app/Banner.tsx"));

    // No `<baseUrl>/react`: Node resolution answers exactly as it does without the layer.
    expect(withBaseUrl(page, "react")).not.toBeNull();
    expect(withBaseUrl(page, "react")).toBe(withoutBaseUrl(page, "react"));
    expect(withBaseUrl(page, "app/Missing")).toBe(withoutBaseUrl(page, "app/Missing"));
  });

  it("probes the owning workspace member's baseUrl before the root tsconfig's", () => {
    stage = realpathSync(mkdtempSync(join(tmpdir(), "cc-baseurl-")));
    write(join(stage, "package.json"), JSON.stringify({ name: "root", workspaces: ["apps/*"] }));
    write(join(stage, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "." } }));
    write(join(stage, "app/Banner.tsx"), "export const Banner = 1;");
    write(join(stage, "apps/web/package.json"), JSON.stringify({ name: "@f/web" }));
    write(join(stage, "apps/web/tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "." } }));
    write(join(stage, "apps/web/app/Banner.tsx"), "export const Banner = 2;");

    const graph = buildWorkspaceGraph(stage);
    const resolveImport = createImportResolver({
      repoRoot: stage,
      tsconfigPath: join(stage, "tsconfig.json"),
      workspaceGraph: graph,
      packageAliasLayers: buildPackageAliasLayers(graph).layers,
    });

    expect(resolveImport(join(stage, "apps/web/src/Page.tsx"), "app/Banner")).toBe(
      join(stage, "apps/web/app/Banner.tsx"),
    );
    expect(resolveImport(join(stage, "src/Page.tsx"), "app/Banner")).toBe(join(stage, "app/Banner.tsx"));
  });
});
