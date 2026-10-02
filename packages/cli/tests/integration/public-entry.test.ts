/**
 * A package-export component is keyed by the public entry the consumer's
 * import chain crosses into, and by the name exported at that entry, never by
 * the file that declares it.
 *
 * design-system-upgrade is scanned with `@example/leaf-kit` 1.0.0 installed,
 * then again after the test upgrades it to the 2.0.0 in
 * `test/fixtures/example-leaf-kit-2.0.0`:
 *   1.0.0  dist/index.js  export { Button } from "./button.js"
 *   2.0.0  dist/index.js  export { ButtonImpl as Button } from "./impl/button.js"
 * `src/App.tsx` reaches `Button` through `@example/agg-kit`
 * (`export * from "@example/leaf-kit"`), `src/Direct.tsx` imports it from
 * `@example/leaf-kit` itself, and `src/Loop.tsx` imports `Widget` from
 * `@example/loop-kit`, whose two barrels re-export each other.
 * `src/Layered.tsx` crosses two packages:
 *   @example/agg-kit/deep   export * from "@example/mid-kit"
 *   @example/mid-kit        export { Button } from "@example/leaf-kit/react"
 *   leaf-kit dist/react.js  export { Impl as Button } from "./react-impl.js"
 * A staged copy with 1.0.0 adds `src/Page.vue`, which imports the same
 * `Button` from `@example/agg-kit` in `<script setup>`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { ScanArtifact } from "@scoutui/scan-format";
import { stageFixture } from "../helpers/stage-fixture.js";
import { assertValidArtifact } from "../helpers/artifact.js";

const exec = promisify(execFile);
const monorepoRoot = resolve(import.meta.dirname, "../../../..");
const cli = resolve(monorepoRoot, "packages/cli/dist/cli.js");

let outDir: string;

async function scanDir(dir: string): Promise<ScanArtifact> {
  await exec(process.execPath, [cli, "scan", "--quiet", "--dry-run"], { cwd: dir });
  return assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8")));
}

/** design-system-upgrade scanned with `@example/leaf-kit` 1.0.0, then with 2.0.0. */
async function scanBeforeAndAfterUpgrade(): Promise<[ScanArtifact, ScanArtifact]> {
  const stage = await stageFixture("design-system-upgrade");
  try {
    const before = await scanDir(stage);
    const leafKit = join(stage, "node_modules/@example/leaf-kit");
    await rm(leafKit, { recursive: true });
    await cp(resolve(monorepoRoot, "test/fixtures/example-leaf-kit-2.0.0"), leafKit, { recursive: true });
    const git = (...args: string[]) =>
      exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], { cwd: stage });
    await git("add", "-A");
    await git("commit", "-q", "-m", "upgrade @example/leaf-kit");
    return [before, await scanDir(stage)];
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** design-system-upgrade plus a Vue page importing `Button` from the aggregator. */
async function scanWithVuePage(): Promise<ScanArtifact> {
  const dir = join(outDir, "design-system-upgrade-vue");
  await cp(resolve(monorepoRoot, "test/fixtures/design-system-upgrade"), dir, { recursive: true });
  await writeFile(
    join(dir, "src/Page.vue"),
    '<script setup lang="ts">\nimport { Button } from "@example/agg-kit";\n</script>\n<template><Button /></template>\n',
  );
  await writeFile(join(dir, "scout.config.json"), JSON.stringify({ repoId: "design-system-upgrade", include: ["src/**/*.{tsx,vue}"] }));
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  return scanDir(dir);
}

/** The component id each resolved occurrence in `file` names. */
function componentIdsIn(scan: ScanArtifact, file: string): (string | undefined)[] {
  return scan.occurrences.filter((o) => o.filePath === file).map((o) => o.resolution.componentId);
}

function componentById(scan: ScanArtifact, id: string | undefined) {
  return scan.components.find((c) => c.id === id);
}

describe("integration: a package export is keyed by its public entry", () => {
  let v1: ScanArtifact;
  let v2: ScanArtifact;
  let withVue: ScanArtifact;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "cc-public-entry-"));
    [[v1, v2], withVue] = await Promise.all([scanBeforeAndAfterUpgrade(), scanWithVuePage()]);
  }, 60_000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("keeps Button's id when the leaf package moves its declaration to another file", () => {
    const [v1Id] = componentIdsIn(v1, "src/App.tsx");
    const [v2Id] = componentIdsIn(v2, "src/App.tsx");
    expect(v1Id).toBeDefined();
    expect(v2Id).toBe(v1Id);
    expect(componentById(v2, v2Id)?.identity).toEqual({
      kind: "package-export",
      packageName: "@example/leaf-kit",
      publicEntry: "",
      exportName: "Button",
    });
  });

  it("names the export at the entry, and a direct import of the entry gives the same id", () => {
    for (const scan of [v1, v2]) {
      const [viaAggregator] = componentIdsIn(scan, "src/App.tsx");
      expect(componentIdsIn(scan, "src/Direct.tsx")).toEqual([viaAggregator]);
      expect(componentById(scan, viaAggregator)?.identity).toMatchObject({ exportName: "Button" });
    }
    expect(v2.components.filter((c) => c.identity.kind === "package-export").map((c) => c.identity)).not.toContainEqual(
      expect.objectContaining({ exportName: "ButtonImpl" }),
    );
  });

  it("keys a chain through two packages by the last entry it crossed, whatever the leaf does behind it", () => {
    const [id] = componentIdsIn(v1, "src/Layered.tsx");
    expect(componentById(v1, id)?.identity).toEqual({
      kind: "package-export",
      packageName: "@example/leaf-kit",
      publicEntry: "react",
      exportName: "Button",
    });
  });

  it("keys a Vue import through the aggregator by the declaring package, the same as a React one", () => {
    const [viaVue] = componentIdsIn(withVue, "src/Page.vue");
    expect(componentById(withVue, viaVue)?.identity).toEqual({
      kind: "package-export",
      packageName: "@example/leaf-kit",
      publicEntry: "",
      exportName: "Button",
    });
    expect(componentIdsIn(withVue, "src/App.tsx")).toEqual([viaVue]);
  });

  it("reports a render whose re-export chain loops as unresolved chain-bailed", () => {
    const loop = v1.occurrences.filter((o) => o.filePath === "src/Loop.tsx");
    expect(loop.map((o) => o.resolution)).toEqual([
      { status: "unresolved", reason: { kind: "chain-bailed", code: "cycle-detected" } },
    ]);
    expect(loop[0]?.trace).toEqual([{ kind: "import", specifier: "@example/loop-kit", name: "Widget" }]);
    expect(
      v1.components.some((c) => c.identity.kind === "package-export" && c.identity.packageName === "@example/loop-kit"),
    ).toBe(false);
  });
});
