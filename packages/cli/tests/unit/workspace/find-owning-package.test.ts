import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildWorkspaceGraph } from "../../../src/workspace/build-graph.js";
import { findOwningPackage, findPackageOrRoot, isFirstPartyPath } from "../../../src/workspace/find-owning-package.js";
import type { WorkspaceGraph } from "../../../src/workspace/types.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeGraph(dir: string, packages: { name: string; rel: string }[]): WorkspaceGraph {
  return {
    packageManager: "yarn",
    rootPath: dir,
    rootPackageName: "root",
    packages: packages.map((p) => ({
      name: p.name,
      absolutePath: join(dir, p.rel),
      packageJson: { name: p.name },
    })),
  };
}

describe("findOwningPackage", () => {
  it("returns the package when file is inside its directory", () => {
    const dir = "/x";
    const graph = makeGraph(dir, [{ name: "@a/foo", rel: "packages/foo" }]);
    expect(
      findOwningPackage(graph, "/x/packages/foo/src/Button.tsx")?.name,
    ).toBe("@a/foo");
  });

  it("returns null when file is outside every workspace package", () => {
    const dir = "/x";
    const graph = makeGraph(dir, [{ name: "@a/foo", rel: "packages/foo" }]);
    expect(findOwningPackage(graph, "/x/scripts/util.ts")).toBeNull();
  });

  it("returns the longest-prefix match when packages nest", () => {
    const dir = "/x";
    const graph = makeGraph(dir, [
      { name: "@a/foo", rel: "packages/foo" },
      { name: "@a/foo-sub", rel: "packages/foo/sub" },
    ]);
    expect(
      findOwningPackage(graph, "/x/packages/foo/sub/src/X.tsx")?.name,
    ).toBe("@a/foo-sub");
  });

  it("returns null when graph has no workspace packages", () => {
    const graph: WorkspaceGraph = {
      packageManager: "yarn",
      rootPath: "/x",
      rootPackageName: "root",
      packages: [],
    };
    expect(findOwningPackage(graph, "/x/src/X.tsx")).toBeNull();
  });

  it("resolves symlinks via realpath before matching", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cc-realpath-"));
    try {
      mkdirSync(join(tmp, "packages/foo/src"), { recursive: true });
      writeFileSync(join(tmp, "packages/foo/src/Button.tsx"), "");
      mkdirSync(join(tmp, "node_modules/@a"), { recursive: true });
      symlinkSync(join(tmp, "packages/foo"), join(tmp, "node_modules/@a/foo"), "dir");

      const graph = makeGraph(tmp, [{ name: "@a/foo", rel: "packages/foo" }]);
      // Path through the symlink, as the resolver hands it over.
      const symPath = join(tmp, "node_modules/@a/foo/src/Button.tsx");
      expect(findOwningPackage(graph, symPath)?.name).toBe("@a/foo");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects vendor packages installed under a workspace's node_modules", () => {
    // A real monorepo shape: a workspace package "app-a" with
    // its own node_modules/@vendor/lib/dist/Button.js. The path prefix
    // matches /repo/app-a but the file is vendor code, not workspace source.
    const dir = "/repo";
    const graph = makeGraph(dir, [{ name: "app-a", rel: "app-a" }]);
    expect(
      findOwningPackage(graph, "/repo/app-a/node_modules/@vendor/lib/dist/Button.js"),
    ).toBeNull();
    // But genuine workspace files still match.
    expect(
      findOwningPackage(graph, "/repo/app-a/src/Page.tsx")?.name,
    ).toBe("app-a");
  });
});

describe("isFirstPartyPath", () => {
  const graph = makeGraph("/x", [{ name: "@a/foo", rel: "packages/foo" }]);

  it("is true for a workspace member's file", () => {
    expect(isFirstPartyPath(graph, "/x/packages/foo/src/Button.tsx")).toBe(true);
  });

  it("is true for the root package's own source", () => {
    expect(isFirstPartyPath(graph, "/x/src/x.tsx")).toBe(true);
  });

  it("is false under the root's node_modules", () => {
    expect(isFirstPartyPath(graph, "/x/node_modules/pkg/index.js")).toBe(false);
  });

  it("is false under a member's node_modules", () => {
    expect(isFirstPartyPath(graph, "/x/packages/foo/node_modules/pkg/index.js")).toBe(false);
  });

  it("is false outside the root", () => {
    expect(isFirstPartyPath(graph, "/y/src/x.tsx")).toBe(false);
    expect(isFirstPartyPath(graph, "/xy/src/x.tsx")).toBe(false);
  });

  it("resolves a symlinked source directory via realpath", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cc-first-party-"));
    try {
      mkdirSync(join(tmp, "repo/src/shared"), { recursive: true });
      writeFileSync(join(tmp, "repo/src/shared/Card.tsx"), "");
      mkdirSync(join(tmp, "elsewhere"), { recursive: true });
      symlinkSync(join(tmp, "repo/src/shared"), join(tmp, "repo/src/linked"), "dir");
      symlinkSync(join(tmp, "elsewhere"), join(tmp, "repo/src/outside"), "dir");
      writeFileSync(join(tmp, "elsewhere/Card.tsx"), "");
      const single = makeGraph(join(tmp, "repo"), []);
      expect(isFirstPartyPath(single, join(tmp, "repo/src/linked/Card.tsx"))).toBe(true);
      expect(isFirstPartyPath(single, join(tmp, "repo/src/outside/Card.tsx"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("findPackageOrRoot", () => {
  let base: string;
  let dir: string;
  let graph: WorkspaceGraph;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "cc-package-or-root-"));
    dir = join(base, "repo");
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/ui/package.json": JSON.stringify({ name: "@example/ui" }),
      "packages/ui/src/a.tsx": "",
      "packages/nameless/package.json": JSON.stringify({}),
      "packages/nameless/src/c.tsx": "",
      "scripts/b.tsx": "",
      "node_modules/x/d.js": "",
    };
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    mkdirSync(join(base, "elsewhere"), { recursive: true });
    writeFileSync(join(base, "elsewhere/e.tsx"), "");
    graph = buildWorkspaceGraph(dir, "example-repo");
  });

  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("credits a workspace package's file to that package", () => {
    expect(findPackageOrRoot(graph, join(dir, "packages/ui/src/a.tsx"))).toMatchObject({
      name: "@example/ui",
      absolutePath: join(dir, "packages/ui"),
    });
  });

  it.each(["scripts/b.tsx", "packages/nameless/src/c.tsx"])("credits %s to the root package", (rel) => {
    expect(findPackageOrRoot(graph, join(dir, rel))).toEqual({ name: "example-repo", absolutePath: dir });
  });

  it("is null under node_modules", () => {
    expect(findPackageOrRoot(graph, join(dir, "node_modules/x/d.js"))).toBeNull();
  });

  it("is null outside the root", () => {
    expect(findPackageOrRoot(graph, join(base, "elsewhere/e.tsx"))).toBeNull();
  });
});
