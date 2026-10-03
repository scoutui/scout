import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, cp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { ScanArtifact } from "@scoutui/scan-format";
import { assertValidArtifact } from "../helpers/artifact.js";

const exec = promisify(execFile);
const monorepoRoot = resolve(import.meta.dirname, "../../../..");
const cli = resolve(monorepoRoot, "packages/cli/dist/cli.js");
const fixtureDir = resolve(monorepoRoot, "test/fixtures/reexport-unparsed-barrel");

// The scan's include covers only src/app, so the barrels in src/ui are never
// parsed:
//
//   src/ui/index.ts    export { Button } from "@example/ui";
//                      export { Card } from "@example/shared";
//   src/ui/rewrap.ts   import { Badge } from "@example/ui"; export { Badge };
//   src/ui/star.ts     export * from "./local-star";
//                      export * from "@example/ui";
//   src/ui/ns.ts       import * as UiKit from "@example/ui"; export { UiKit };
//   src/ui/ns-star.ts  export * as UiParts from "@example/ui";
//
// src/ui/local-star.tsx declares Spinner. src/app/through-barrels.tsx renders
// Button, Card, Badge, Tooltip, UiKit.Avatar, UiParts.Banner and Spinner
// through those barrels, and
// src/app/direct.tsx renders Button imported from @example/ui directly.
// @example/ui is installed and untracked; @example/shared is a workspace
// package, linked into node_modules as Yarn does.
async function stageConsumer(): Promise<string> {
  const stagingDir = await mkdtemp(join(tmpdir(), "cc-reexport-unparsed-barrel-"));
  await cp(join(fixtureDir, "consumer"), stagingDir, { recursive: true });
  await mkdir(join(stagingDir, "node_modules", "@example"), { recursive: true });
  await cp(join(fixtureDir, "ui"), join(stagingDir, "node_modules", "@example", "ui"), { recursive: true });
  await symlink(join(stagingDir, "packages", "shared"), join(stagingDir, "node_modules", "@example", "shared"), "dir");
  await exec("git", ["init", "-q"], { cwd: stagingDir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: stagingDir });
  await exec("git", ["config", "user.name", "Test"], { cwd: stagingDir });
  await exec("git", ["add", "-A"], { cwd: stagingDir });
  await exec("git", ["commit", "-q", "-m", "init"], { cwd: stagingDir });
  await exec(process.execPath, [cli, "scan", "--dry-run", "--quiet"], { cwd: stagingDir });
  return stagingDir;
}

describe("integration: a component imported through a barrel the scan leaves out", () => {
  let stagingDir: string;
  let scan: ScanArtifact;

  beforeAll(async () => {
    stagingDir = await stageConsumer();
    scan = assertValidArtifact(JSON.parse(await readFile(join(stagingDir, "scout-scan.json"), "utf8")));
  }, 30_000);

  afterAll(async () => {
    await rm(stagingDir, { recursive: true, force: true });
  });

  /** Every component row named `name`, with its render count. */
  function rows(name: string) {
    return scan.components
      .filter((c) => c.identity.kind !== "tag" && c.identity.exportName === name)
      .map((c) => ({ identity: c.identity, renders: c.stats.occurrenceCount }));
  }

  it("credits `export { X } from` an installed package to that package, in one row with the direct import", () => {
    expect(rows("Button")).toEqual([
      {
        identity: { kind: "package-export", packageName: "@example/ui", publicEntry: "", exportName: "Button" },
        renders: 2,
      },
    ]);
  });

  it("credits an import from an installed package that the barrel exports again to that package", () => {
    expect(rows("Badge")).toEqual([
      {
        identity: { kind: "package-export", packageName: "@example/ui", publicEntry: "", exportName: "Badge" },
        renders: 1,
      },
    ]);
  });

  it("credits a member of a namespace import from an installed package that the barrel exports again to that package", () => {
    expect(rows("Avatar")).toEqual([
      {
        identity: { kind: "package-export", packageName: "@example/ui", publicEntry: "", exportName: "Avatar" },
        renders: 1,
      },
    ]);
  });

  it("credits a member of `export * as` an installed package to that package", () => {
    expect(rows("Banner")).toEqual([
      {
        identity: { kind: "package-export", packageName: "@example/ui", publicEntry: "", exportName: "Banner" },
        renders: 1,
      },
    ]);
  });

  it("credits `export *` from an installed package to that package", () => {
    expect(rows("Tooltip")).toEqual([
      {
        identity: { kind: "package-export", packageName: "@example/ui", publicEntry: "", exportName: "Tooltip" },
        renders: 1,
      },
    ]);
  });

  it("credits a name a repository file exports through `export *` to that file, over a package's `export *` in the same barrel", () => {
    expect(rows("Spinner")).toEqual([
      {
        identity: {
          kind: "repository-declaration",
          repoId: "reexport-unparsed-barrel",
          filePath: "src/ui/local-star.tsx",
          exportName: "Spinner",
        },
        renders: 1,
      },
    ]);
  });

  it("follows `export { X } from` a workspace package to the file that declares it", () => {
    expect(rows("Card")).toEqual([
      {
        identity: {
          kind: "repository-declaration",
          repoId: "reexport-unparsed-barrel",
          filePath: "packages/shared/src/card.tsx",
          exportName: "Card",
        },
        renders: 1,
      },
    ]);
  });
});
