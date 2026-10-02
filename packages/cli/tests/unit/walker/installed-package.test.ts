import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInstalledPackage } from "../../../src/walker/installed-package.js";

describe("isInstalledPackage", () => {
  let stage: string;

  beforeAll(() => {
    stage = realpathSync(mkdtempSync(join(tmpdir(), "cc-installed-")));
    mkdirSync(join(stage, "node_modules", "@example", "ui"), { recursive: true });
    writeFileSync(join(stage, "node_modules", "@example", "ui", "package.json"), `{ "name": "@example/ui" }\n`);
    mkdirSync(join(stage, "node_modules", "no-manifest"), { recursive: true });
    mkdirSync(join(stage, "apps", "web", "src"), { recursive: true });
  });

  afterAll(() => rmSync(stage, { recursive: true, force: true }));

  it("finds a package in an ancestor's node_modules", () => {
    expect(isInstalledPackage(join(stage, "apps", "web", "src", "App.tsx"), "@example/ui")).toBe(true);
  });

  it("answers false for a package with no package.json on the lookup path", () => {
    expect(isInstalledPackage(join(stage, "apps", "web", "src", "App.tsx"), "left-pad-ui")).toBe(false);
    expect(isInstalledPackage(join(stage, "apps", "web", "src", "App.tsx"), "no-manifest")).toBe(false);
  });
});
