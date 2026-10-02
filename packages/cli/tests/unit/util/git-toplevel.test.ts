import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readGitToplevel } from "../../../src/util/git.js";

describe("readGitToplevel", () => {
  let stage: string;

  beforeAll(() => {
    // realpathSync: macOS tmpdir is /var → /private/var; git reports physical.
    stage = realpathSync(mkdtempSync(join(tmpdir(), "cc-git-top-")));
    execFileSync("git", ["init", "-q"], { cwd: stage, stdio: "pipe" });
    mkdirSync(join(stage, "apps", "web"), { recursive: true });
  });

  afterAll(() => rmSync(stage, { recursive: true, force: true }));

  it("returns the toplevel from a subdirectory", async () => {
    expect(await readGitToplevel(join(stage, "apps", "web"))).toBe(stage);
  });

  it("returns the toplevel from the root itself", async () => {
    expect(await readGitToplevel(stage)).toBe(stage);
  });

  it("returns null outside a work tree", async () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), "cc-git-none-")));
    try {
      expect(await readGitToplevel(bare)).toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
