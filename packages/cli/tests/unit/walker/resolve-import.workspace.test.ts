import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImportResolver } from "../../../src/walker/resolve-import.js";
import type { WorkspaceGraph, WorkspacePackage } from "../../../src/workspace/types.js";

let root: string;
beforeEach(() => {
  // realpath: macOS tmpdir symlinks (/var → /private/var) trip up identity comparisons
  // against `require.resolve` output, which always returns the realpath.
  root = realpathSync(mkdtempSync(join(tmpdir(), "cc-resolve-ws-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function member(name: string, relPath: string, packageJson: Record<string, unknown>): WorkspacePackage {
  const absolutePath = join(root, relPath);
  mkdirSync(absolutePath, { recursive: true });
  writeFileSync(join(absolutePath, "package.json"), JSON.stringify({ name, ...packageJson }));
  return { name, absolutePath, packageJson: { name, ...packageJson } };
}

function graphOf(...packages: WorkspacePackage[]): WorkspaceGraph {
  return { packageManager: "yarn", rootPath: root, rootPackageName: "root", packages };
}

describe("createImportResolver: workspace member name→source", () => {
  it("resolves a bare member name via its main field with no node_modules present", () => {
    const ui = member("@ws/ui", "packages/ui", { main: "src/index.ts" });
    mkdirSync(join(ui.absolutePath, "src"), { recursive: true });
    writeFileSync(join(ui.absolutePath, "src/index.ts"), "");
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@ws/ui")).toBe(
      join(ui.absolutePath, "src/index.ts"),
    );
  });

  it("resolves a bare member name via the package-dir index probe when no entry fields exist", () => {
    const ui = member("@ws/ui", "packages/ui", {});
    writeFileSync(join(ui.absolutePath, "index.ts"), "");
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@ws/ui")).toBe(
      join(ui.absolutePath, "index.ts"),
    );
  });

  it("falls through an unbuilt dist-pointing main to the src/ index probe", () => {
    const ui = member("@ws/ui", "packages/ui", { main: "dist/index.js" });
    mkdirSync(join(ui.absolutePath, "src"), { recursive: true });
    writeFileSync(join(ui.absolutePath, "src/index.tsx"), "");
    // dist/ does not exist: a fresh clone, never built
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@ws/ui")).toBe(
      join(ui.absolutePath, "src/index.tsx"),
    );
  });

  it("member source wins over a version-pinned published copy in node_modules", () => {
    const ui = member("@ws/ui", "packages/ui", { main: "src/index.ts" });
    mkdirSync(join(ui.absolutePath, "src"), { recursive: true });
    writeFileSync(join(ui.absolutePath, "src/index.ts"), "");
    // A real (non-symlink) published copy, as yarn materialises for a
    // version pin that the workspace member's version doesn't satisfy.
    const published = join(root, "node_modules/@ws/ui");
    mkdirSync(published, { recursive: true });
    writeFileSync(
      join(published, "package.json"),
      JSON.stringify({ name: "@ws/ui", version: "1.0.0", main: "index.js" }),
    );
    writeFileSync(join(published, "index.js"), "");
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@ws/ui")).toBe(
      join(ui.absolutePath, "src/index.ts"),
    );
  });

  it("resolves member subpaths through the wildcard source probe without declared exports", () => {
    const ui = member("@ws/ui", "packages/ui", {});
    mkdirSync(join(ui.absolutePath, "src"), { recursive: true });
    writeFileSync(join(ui.absolutePath, "src/button.tsx"), "");
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@ws/ui/src/button")).toBe(
      join(ui.absolutePath, "src/button.tsx"),
    );
  });

  it("declared subpath export beats the wildcard source probe for the same spec", () => {
    const ui = member("@ws/ui", "packages/ui", { exports: { "./button": "./src/button.tsx" } });
    mkdirSync(join(ui.absolutePath, "src"), { recursive: true });
    writeFileSync(join(ui.absolutePath, "src/button.tsx"), "");
    writeFileSync(join(ui.absolutePath, "button.tsx"), ""); // wildcard probe's candidate
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@ws/ui/button")).toBe(
      join(ui.absolutePath, "src/button.tsx"),
    );
  });

  it("non-member bare specifiers still fall through to Node resolution", () => {
    const ui = member("@ws/ui", "packages/ui", {});
    const dep = join(root, "node_modules/@other/dep");
    mkdirSync(dep, { recursive: true });
    writeFileSync(join(dep, "package.json"), JSON.stringify({ name: "@other/dep", main: "index.js" }));
    writeFileSync(join(dep, "index.js"), "");
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@other/dep")).toBe(join(dep, "index.js"));
  });

  it("wildcard probe does not traverse out of the member dir via `..` segments", () => {
    const ui = member("@ws/ui", "packages/ui", {});
    // A real file outside the member dir that a naive `./*` expansion would reach.
    writeFileSync(join(root, "packages/secret.ts"), "");
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@ws/ui/../secret")).toBeNull();
  });

  it("a member import whose target file exists nowhere returns null (accepted residue)", () => {
    const ui = member("@ws/ui", "packages/ui", {});
    const resolve = createImportResolver({ repoRoot: root, workspaceGraph: graphOf(ui) });
    expect(resolve(join(root, "apps/web/src/App.tsx"), "@ws/ui/does-not-exist")).toBeNull();
  });
});
