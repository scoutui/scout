import { describe, it, expect } from "vitest";
import { buildWorkspaceGraph } from "../../../src/workspace/build-graph.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeFixture(): string {
  return mkdtempSync(join(tmpdir(), "cc-ws-test-"));
}

function write(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("buildWorkspaceGraph: packageManager sniff", () => {
  it("detects yarn from yarn.lock", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root" }));
      write(dir, "yarn.lock", "");
      expect(buildWorkspaceGraph(dir).packageManager).toBe("yarn");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("detects npm from package-lock.json", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root" }));
      write(dir, "package-lock.json", "{}");
      expect(buildWorkspaceGraph(dir).packageManager).toBe("npm");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("detects pnpm from pnpm-lock.yaml", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root" }));
      write(dir, "pnpm-lock.yaml", "");
      expect(buildWorkspaceGraph(dir).packageManager).toBe("pnpm");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("returns \"unknown\" when no lockfile is present", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root" }));
      expect(buildWorkspaceGraph(dir).packageManager).toBe("unknown");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("packageManager is independent of workspace presence (single-package pnpm repo)", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "solo" }));
      write(dir, "pnpm-lock.yaml", "");
      const g = buildWorkspaceGraph(dir);
      expect(g.packageManager).toBe("pnpm");
      expect(g.packages).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("buildWorkspaceGraph: workspace detection", () => {
  it("detects yarn-style array workspaces", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
      write(dir, "yarn.lock", "");
      write(dir, "packages/a/package.json", JSON.stringify({ name: "@fix/a" }));
      write(dir, "packages/b/package.json", JSON.stringify({ name: "@fix/b" }));
      const g = buildWorkspaceGraph(dir);
      expect(g.packages.map((p) => p.name).sort()).toEqual(["@fix/a", "@fix/b"]);
      expect(g.packages.every((p) => p.absolutePath.startsWith(dir))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("detects literal-path workspaces (no glob meta), as a multi-app monorepo lists them", () => {
    const dir = makeFixture();
    try {
      write(
        dir,
        "package.json",
        JSON.stringify({ name: "root", workspaces: ["app-a", "app-b"] }),
      );
      write(dir, "app-a/package.json", JSON.stringify({ name: "app-a" }));
      write(dir, "app-a/src/index.ts", "");
      write(dir, "app-b/package.json", JSON.stringify({ name: "app-b" }));
      const g = buildWorkspaceGraph(dir);
      expect(g.packages.map((p) => p.name).sort()).toEqual(["app-a", "app-b"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("handles object form of workspaces field", () => {
    const dir = makeFixture();
    try {
      write(
        dir,
        "package.json",
        JSON.stringify({ name: "root", workspaces: { packages: ["packages/*"] } }),
      );
      write(dir, "packages/a/package.json", JSON.stringify({ name: "@fix/a" }));
      const g = buildWorkspaceGraph(dir);
      expect(g.packages).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("detects pnpm-workspace.yaml packages", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root" }));
      write(dir, "pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
      write(dir, "packages/a/package.json", JSON.stringify({ name: "@fix/a" }));
      const g = buildWorkspaceGraph(dir);
      expect(g.packages.map((p) => p.name)).toEqual(["@fix/a"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("pnpm-workspace.yaml wins when both configs present", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
      write(dir, "pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
      write(dir, "apps/x/package.json", JSON.stringify({ name: "@fix/x" }));
      write(dir, "packages/y/package.json", JSON.stringify({ name: "@fix/y" }));
      const g = buildWorkspaceGraph(dir);
      expect(g.packages.map((p) => p.name)).toEqual(["@fix/x"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("returns empty packages when no workspace config found", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root" }));
      const g = buildWorkspaceGraph(dir);
      expect(g.packages).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("skips glob matches without package.json", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
      write(dir, "yarn.lock", "");
      write(dir, "packages/a/package.json", JSON.stringify({ name: "@fix/a" }));
      mkdirSync(join(dir, "packages/empty"), { recursive: true });
      const g = buildWorkspaceGraph(dir);
      expect(g.packages.map((p) => p.name)).toEqual(["@fix/a"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("skips package.json without name field", () => {
    const dir = makeFixture();
    try {
      write(dir, "package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
      write(dir, "yarn.lock", "");
      write(dir, "packages/a/package.json", JSON.stringify({ version: "0.0.0" }));
      write(dir, "packages/b/package.json", JSON.stringify({ name: "@fix/b" }));
      const g = buildWorkspaceGraph(dir);
      expect(g.packages.map((p) => p.name)).toEqual(["@fix/b"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
