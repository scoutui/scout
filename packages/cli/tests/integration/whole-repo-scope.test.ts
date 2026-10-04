import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { Component, ScanArtifact } from "@scoutui/scan-format";
import type { Diagnostic } from "../../src/diagnostic.js";
import { assertValidArtifact } from "../helpers/artifact.js";
import { stageFixture } from "../helpers/stage-fixture.js";

const CLI = resolve(import.meta.dirname, "..", "..", "dist", "cli.js");

/** Stages whole-repo-scope with `files` written over it. */
async function stage(files: Record<string, string> = {}): Promise<string> {
  const dir = await stageFixture("whole-repo-scope");
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
  return dir;
}

function scan(cwd: string, args: string[] = []): ScanArtifact<Diagnostic> {
  execFileSync("node", [CLI, "scan", "--quiet", "--dry-run", ...args], { cwd, stdio: "pipe" });
  return assertValidArtifact(JSON.parse(readFileSync(join(cwd, "scout-scan.json"), "utf8")));
}

const exportNameOf = (c: Component | undefined): string | undefined =>
  c !== undefined && c.identity.kind !== "tag" ? c.identity.exportName : undefined;

function component(o: ScanArtifact, exportName: string): Component {
  const found = o.components.find((c) => exportNameOf(c) === exportName);
  if (found === undefined) throw new Error(`no ${exportName} component`);
  return found;
}

/** `[filePath, component name, usedIn]` for each occurrence, sorted. */
const occurrenceRows = (o: ScanArtifact) =>
  o.occurrences
    .map((occ) => [occ.filePath, exportNameOf(o.components.find((c) => c.id === occ.resolution.componentId)), occ.usedIn])
    .sort();

describe("integration: what a scan covers and which package each usage sits in", () => {
  const stages: string[] = [];
  let whole: ScanArtifact;
  let excluded: ScanArtifact;
  let sub: ScanArtifact;
  let renamed: ScanArtifact;

  beforeAll(async () => {
    const wholeStage = await stage();
    const excludedStage = await stage({
      "scout.config.json": JSON.stringify({
        repoId: "whole-repo-scope",
        include: ["**/*.{ts,tsx}"],
        exclude: ["apps/playground", "packages/shared-ui"],
      }),
    });
    const subStage = await stage({ "apps/web/scout.config.json": JSON.stringify({ repoId: "whole-repo-scope" }) });
    const renamedStage = await stage({
      "package.json": JSON.stringify({ private: true, workspaces: ["apps/*", "packages/*"] }),
    });
    stages.push(wholeStage, excludedStage, subStage, renamedStage);
    whole = scan(wholeStage);
    excluded = scan(excludedStage);
    sub = scan(join(subStage, "apps", "web"));
    renamed = scan(renamedStage, ["--repo-id", "example-renamed"]);
  }, 60_000);

  afterAll(() => {
    for (const dir of stages) rmSync(dir, { recursive: true, force: true });
  });

  describe("whole repository", () => {
    it("records the config's folder, its exclude and each package a scanned file sits in, with no include", () => {
      expect(whole.meta.scope).toStrictEqual({
        folder: "",
        exclude: [],
        packages: [
          { name: "whole-repo-scope", folder: "" },
          { name: "@example/playground", folder: "apps/playground" },
          { name: "@example/web", folder: "apps/web" },
          { name: "@example/shared-ui", folder: "packages/shared-ui" },
        ],
      });
    });

    it("records the package each usage sits in, and reads no file under __tests__", () => {
      expect(occurrenceRows(whole)).toEqual([
        ["apps/playground/src/Demo.tsx", "SharedButton", "@example/playground"],
        ["apps/web/src/App.tsx", "Button", "@example/web"],
        ["apps/web/src/App.tsx", "SharedButton", "@example/web"],
        ["apps/web/src/App.tsx", "SharedButton", "@example/web"],
        ["packages/shared-ui/src/SharedButton.tsx", "Button", "@example/shared-ui"],
        ["scripts/preview.tsx", "SharedButton", "whole-repo-scope"],
      ]);
    });

    it("credits a workspace package's components to it and a component outside every workspace package to the root package", () => {
      expect(["Button", "SharedButton", "Preview"].map((name) => component(whole, name).owningPackage)).toEqual([
        "@example/shared-ui",
        "@example/shared-ui",
        "whole-repo-scope",
      ]);
    });
  });

  describe("with two packages excluded", () => {
    it("records the include, the exclude and only the packages its scanned files sit in", () => {
      expect(excluded.meta.scope).toStrictEqual({
        folder: "",
        include: ["**/*.{ts,tsx}"],
        exclude: ["apps/playground", "packages/shared-ui"],
        packages: [
          { name: "whole-repo-scope", folder: "" },
          { name: "@example/web", folder: "apps/web" },
        ],
      });
    });

    it("keeps an excluded package's component under the same id and package, without its declared props or what it renders", () => {
      const all = component(whole, "SharedButton");
      const partial = component(excluded, "SharedButton");
      expect([all.declared === undefined, Object.keys(all.composition.rendersByCount).length]).toEqual([false, 1]);
      expect({
        id: partial.id,
        declared: partial.declared,
        rendersByCount: partial.composition.rendersByCount,
        owningPackage: partial.owningPackage,
      }).toEqual({ id: all.id, declared: undefined, rendersByCount: {}, owningPackage: "@example/shared-ui" });
    });

    it("records the package each usage sits in, keeping the excluded component's usages and dropping the usage inside an excluded file", () => {
      expect(occurrenceRows(excluded)).toEqual([
        ["apps/web/src/App.tsx", "Button", "@example/web"],
        ["apps/web/src/App.tsx", "SharedButton", "@example/web"],
        ["apps/web/src/App.tsx", "SharedButton", "@example/web"],
        ["scripts/preview.tsx", "SharedButton", "whole-repo-scope"],
      ]);
    });
  });

  describe("config in a workspace package's folder", () => {
    it("records the package's folder and only that package", () => {
      expect(sub.meta.scope).toStrictEqual({
        folder: "apps/web",
        exclude: [],
        packages: [{ name: "@example/web", folder: "apps/web" }],
      });
    });

    it("records no package on a usage when the scan covers one package", () => {
      expect(sub.occurrences.map((o) => [o.filePath, o.usedIn])).toEqual([
        ["apps/web/src/App.tsx", undefined],
        ["apps/web/src/App.tsx", undefined],
        ["apps/web/src/App.tsx", undefined],
      ]);
    });
  });

  describe("root package.json with no name", () => {
    it("names the root package after the repository", () => {
      const preview = renamed.occurrences.find((o) => o.filePath === "scripts/preview.tsx");
      expect({
        owningPackage: component(renamed, "Preview").owningPackage,
        rootPackage: renamed.meta.scope?.packages[0],
        usedIn: preview?.usedIn,
      }).toEqual({
        owningPackage: "example-renamed",
        rootPackage: { name: "example-renamed", folder: "" },
        usedIn: "example-renamed",
      });
    });
  });
});
