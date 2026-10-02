import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findWorkspaceRoot } from "../../../src/workspace/find-workspace-root.js";

describe("findWorkspaceRoot", () => {
  let stage: string;

  beforeAll(() => {
    stage = realpathSync(mkdtempSync(join(tmpdir(), "cc-ws-root-")));
    writeFileSync(
      join(stage, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["apps/*", "packages/*"] }),
    );
    for (const dir of ["apps/web", "packages/ui", "tools/scripts"]) {
      mkdirSync(join(stage, dir), { recursive: true });
      writeFileSync(
        join(stage, dir, "package.json"),
        JSON.stringify({ name: `@f/${dir.split("/")[1]}` }),
      );
    }
  });

  afterAll(() => rmSync(stage, { recursive: true, force: true }));

  it("finds the root from a member workspace", () => {
    expect(findWorkspaceRoot(join(stage, "apps", "web"), stage)).toBe(stage);
  });

  it("returns null for a dir the root's globs don't include", () => {
    expect(findWorkspaceRoot(join(stage, "tools", "scripts"), stage)).toBeNull();
  });

  it("returns null when scanRoot is the workspace root (no walk needed)", () => {
    expect(findWorkspaceRoot(stage, stage)).toBeNull();
  });

  it("stops at stopAt", () => {
    // stopAt below the declaring dir → never sees it.
    expect(findWorkspaceRoot(join(stage, "apps", "web"), join(stage, "apps"))).toBeNull();
  });
});
