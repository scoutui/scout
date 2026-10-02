import { describe, it, expect } from "vitest";
import { buildWorkspaceExportEntries } from "../../../src/walker/workspace-exports.js";
import type { WorkspaceGraph, WorkspacePackage } from "../../../src/workspace/types.js";

function mkPkg(
  name: string,
  absolutePath: string,
  packageJsonExtra: Record<string, unknown> = {},
): WorkspacePackage {
  return {
    name,
    absolutePath,
    packageJson: { name, ...packageJsonExtra },
  };
}

function mkGraph(packages: WorkspacePackage[]): WorkspaceGraph {
  return {
    packageManager: "yarn",
    rootPath: "/repo",
    rootPackageName: "root",
    packages,
  };
}

/** The always-emitted per-member tail: [bare-name entry, wildcard entry]. */
function tail(entries: ReturnType<typeof buildWorkspaceExportEntries>, name: string) {
  const bare = entries.find((e) => e.pattern.test(name) && !e.pattern.test(`${name}/x`));
  const wild = entries.find((e) => !e.pattern.test(name) && e.pattern.test(`${name}/x`) && e.targets.includes("./*"));
  return { bare, wild };
}

describe("buildWorkspaceExportEntries: subpath exports", () => {
  it("emits one constant entry for a string-target subpath, before the member tail", () => {
    const graph = mkGraph([
      mkPkg("@example/icons", "/repo/packages/icons", { exports: { "./types": "./types.ts" } }),
    ]);
    const entries = buildWorkspaceExportEntries(graph);
    expect(entries).toHaveLength(3); // subpath + bare + wildcard
    expect(entries[0].pattern.test("@example/icons/types")).toBe(true);
    expect(entries[0].pattern.test("@example/icons/other")).toBe(false);
    expect(entries[0].targets).toEqual(["./types.ts"]);
    expect(entries[0].base).toBe("/repo/packages/icons");
  });

  it("emits a single-wildcard pattern entry for a declared subpath", () => {
    const graph = mkGraph([
      mkPkg("@example/icons", "/repo/packages/icons", { exports: { "./icons/*": "./icons/*.tsx" } }),
    ]);
    const entries = buildWorkspaceExportEntries(graph);
    expect(entries).toHaveLength(3);
    const match = entries[0].pattern.exec("@example/icons/icons/IcDemo");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("IcDemo");
    expect(entries[0].targets).toEqual(["./icons/*.tsx"]);
  });

  it("sorts more-specific subpath entries before patterns within a package", () => {
    const graph = mkGraph([
      mkPkg("@example/icons", "/repo/packages/icons", {
        exports: { "./icons/*": "./icons/*.tsx", "./icons/special": "./special.tsx" },
      }),
    ]);
    const entries = buildWorkspaceExportEntries(graph);
    expect(entries).toHaveLength(4);
    expect(entries[0].targets).toEqual(["./special.tsx"]);
    expect(entries[1].targets).toEqual(["./icons/*.tsx"]);
  });

  it("skips conditional-object subpath targets (member tail still emitted)", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", {
        exports: { "./a": { import: "./a.mjs", require: "./a.cjs" } },
      }),
    ]);
    const entries = buildWorkspaceExportEntries(graph);
    expect(entries).toHaveLength(2); // no subpath entry, just bare + wildcard
    expect(entries[0].targets).toEqual([".", "./src"]);
  });

  it("skips null targets (Node deny form)", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", { exports: { "./private/*": null } }),
    ]);
    expect(buildWorkspaceExportEntries(graph)).toHaveLength(2);
  });

  it("skips multi-wildcard targets", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", { exports: { "./foo/*/*": "./src/*/*.ts" } }),
    ]);
    expect(buildWorkspaceExportEntries(graph)).toHaveLength(2);
  });
});

describe("buildWorkspaceExportEntries: bare-name entry", () => {
  it("always emits a bare-name entry whose pattern matches the exact name only", () => {
    const graph = mkGraph([mkPkg("@example/x", "/repo/packages/x")]);
    const entries = buildWorkspaceExportEntries(graph);
    expect(entries).toHaveLength(2);
    const { bare } = tail(entries, "@example/x");
    expect(bare).toBeDefined();
    expect(bare!.pattern.test("@example/x")).toBe(true);
    expect(bare!.pattern.test("@example/x/sub")).toBe(false);
    expect(bare!.targets).toEqual([".", "./src"]);
    expect(bare!.base).toBe("/repo/packages/x");
  });

  it("uses a string `exports[\".\"]` as the first bare-name target", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", { exports: { ".": "./index.js" } }),
    ]);
    const { bare } = tail(buildWorkspaceExportEntries(graph), "@example/x");
    expect(bare!.targets).toEqual(["./index.js", ".", "./src"]);
  });

  it("uses the bare-string exports sugar as the first bare-name target", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", { exports: "./src/index.ts" }),
    ]);
    const { bare } = tail(buildWorkspaceExportEntries(graph), "@example/x");
    expect(bare!.targets).toEqual(["./src/index.ts", ".", "./src"]);
  });

  it("picks the first string among import/module/default from a conditional `exports[\".\"]`", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", {
        exports: { ".": { require: "./dist/index.cjs", module: "./src/index.ts", default: "./dist/index.js" } },
      }),
    ]);
    const { bare } = tail(buildWorkspaceExportEntries(graph), "@example/x");
    // `require` is not consulted; `import` absent; `module` wins over `default`.
    expect(bare!.targets[0]).toBe("./src/index.ts");
  });

  it("falls back through module then main fields, then the directory probes", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", { module: "./esm/index.js", main: "./lib/index.js" }),
    ]);
    const { bare } = tail(buildWorkspaceExportEntries(graph), "@example/x");
    expect(bare!.targets).toEqual(["./esm/index.js", "./lib/index.js", ".", "./src"]);
  });

  it("treats the `{\".\": null}` deny form as absent (directory probes only)", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", { exports: { ".": null } }),
    ]);
    const { bare } = tail(buildWorkspaceExportEntries(graph), "@example/x");
    expect(bare!.targets).toEqual([".", "./src"]);
  });

  it("stacks dot-export before module/main", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", {
        exports: { ".": "./src/public.ts" },
        module: "./esm/index.js",
        main: "./lib/index.js",
      }),
    ]);
    const { bare } = tail(buildWorkspaceExportEntries(graph), "@example/x");
    expect(bare!.targets).toEqual(["./src/public.ts", "./esm/index.js", "./lib/index.js", ".", "./src"]);
  });
});

describe("buildWorkspaceExportEntries: wildcard source-probe entry", () => {
  it("always emits `<pkg>/*` → `./*` after all other member entries", () => {
    const graph = mkGraph([
      mkPkg("@example/x", "/repo/packages/x", { exports: { "./a": "./a.ts" } }),
    ]);
    const entries = buildWorkspaceExportEntries(graph);
    const last = entries[entries.length - 1];
    const m = last.pattern.exec("@example/x/src/button");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("src/button");
    expect(last.targets).toEqual(["./*"]);
    expect(last.base).toBe("/repo/packages/x");
    // Declared subpath entry comes first in the flat array, so it wins for `@example/x/a`.
    expect(entries.findIndex((e) => e.targets[0] === "./a.ts")).toBeLessThan(entries.indexOf(last));
  });

  it("rejects `..` path segments in the wildcard (no traversal out of the member dir)", () => {
    const graph = mkGraph([mkPkg("@example/x", "/repo/packages/x")]);
    const entries = buildWorkspaceExportEntries(graph);
    const wild = entries[entries.length - 1];
    expect(wild.pattern.test("@example/x/../secret")).toBe(false);
    expect(wild.pattern.test("@example/x/a/../b")).toBe(false);
    expect(wild.pattern.test("@example/x/a/..")).toBe(false);
    // `..` inside a real segment name is still a legitimate path.
    expect(wild.pattern.test("@example/x/a..b")).toBe(true);
    expect(wild.pattern.test("@example/x/src/button")).toBe(true);
  });
});

describe("buildWorkspaceExportEntries: multiple members", () => {
  it("emits per-member groups scoped to each package name", () => {
    const graph = mkGraph([
      mkPkg("@example/a", "/repo/packages/a", { exports: { "./x": "./x.ts" } }),
      mkPkg("@example/b", "/repo/packages/b", { exports: { "./y": "./y.ts" } }),
    ]);
    const entries = buildWorkspaceExportEntries(graph);
    expect(entries).toHaveLength(6); // (subpath + bare + wildcard) × 2
    const aEntries = entries.filter((e) => e.base === "/repo/packages/a");
    expect(aEntries.some((e) => e.pattern.test("@example/b/y"))).toBe(false);
    expect(aEntries.some((e) => e.pattern.test("@example/b"))).toBe(false);
  });
});
