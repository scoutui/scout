import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedVersionReader, withInstalledVersions } from "../../../src/scan/stamp-version.js";
import type { Component, Occurrence } from "@scoutui/scan-format";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function makeComponent(
  id: string,
  packageName: string,
): Component {
  return {
    id,
    identity: { kind: "package-export", packageName, publicEntry: "", exportName: "Button" },
    framework: "react",
    stats: { occurrenceCount: 1, fileCount: 1 },
    usage: "direct",
    props: {},
    composition: { rendersByCount: {}, renderedByCount: {}, isRootCount: 0, isLeafCount: 1 },
    version: null,
  };
}

function makeOccurrence(componentId: string, filePath: string): Occurrence {
  return {
    occurrenceId: `occ-${componentId}`,
    resolution: { status: "resolved", componentId },
    filePath,
    line: 1,
    column: 0,
    credit: { kind: "render" },
    trace: [],
    props: {},
  };
}

describe("withInstalledVersions", () => {
  it("stamps version from root node_modules when package is hoisted", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-sv-root-"));
    dirs.push(root);

    const pkgDir = join(root, "node_modules", "@scope", "button");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@scope/button", version: "2.0.0" }),
    );

    const component = makeComponent("comp-1", "@scope/button");
    const occurrence = makeOccurrence("comp-1", "src/App.tsx");

    const [stamped] = await withInstalledVersions([component], [occurrence], installedVersionReader(root));

    expect(stamped?.version).toBe("2.0.0");
  });

  it("stamps version from per-app node_modules in multi-app monorepo", async () => {
    // Simulate a multi-app monorepo that installs dependencies per app:
    //   root/
    //     nextjs-app-v14/
    //       src/
    //         App.tsx         ← occurrence filePath
    //       node_modules/
    //         @scope/
    //           button/
    //             package.json  ← version lives here, not at root
    //   (no root/node_modules/@scope/button)
    const root = mkdtempSync(join(tmpdir(), "cc-sv-multiapp-"));
    dirs.push(root);

    const subAppNodeModules = join(root, "nextjs-app-v14", "node_modules", "@scope", "button");
    mkdirSync(subAppNodeModules, { recursive: true });
    writeFileSync(
      join(subAppNodeModules, "package.json"),
      JSON.stringify({ name: "@scope/button", version: "3.5.1" }),
    );

    const component = makeComponent("comp-1", "@scope/button");
    // Occurrence path is relative to root; it points inside the sub-app
    const occurrence = makeOccurrence("comp-1", "nextjs-app-v14/src/App.tsx");

    const [stamped] = await withInstalledVersions([component], [occurrence], installedVersionReader(root));

    expect(stamped?.version).toBe("3.5.1");
  });

  it("returns null when package is absent from both per-app and root node_modules", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-sv-missing-"));
    dirs.push(root);

    const component = makeComponent("comp-1", "@scope/button");
    const occurrence = makeOccurrence("comp-1", "nextjs-app-v14/src/App.tsx");

    const [stamped] = await withInstalledVersions([component], [occurrence], installedVersionReader(root));

    expect(stamped?.version).toBeNull();
  });

  it("falls back to startDir when no occurrences are provided for a package", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-sv-fallback-"));
    dirs.push(root);

    // Package is only at root.
    const pkgDir = join(root, "node_modules", "@scope", "button");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@scope/button", version: "1.2.3" }),
    );

    const component = makeComponent("comp-1", "@scope/button");

    const [stamped] = await withInstalledVersions([component], [], installedVersionReader(root));

    expect(stamped?.version).toBe("1.2.3");
  });

  it("root node_modules wins when per-app has no entry (walks up correctly)", async () => {
    // Package is at root but not in the sub-app's node_modules.
    // Walk starts at sub-app dir, goes up, finds it at root.
    const root = mkdtempSync(join(tmpdir(), "cc-sv-walkup-"));
    dirs.push(root);

    const pkgDir = join(root, "node_modules", "@scope", "button");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@scope/button", version: "4.0.0" }),
    );

    const component = makeComponent("comp-1", "@scope/button");
    const occurrence = makeOccurrence("comp-1", "nextjs-app-v14/src/App.tsx");

    const [stamped] = await withInstalledVersions([component], [occurrence], installedVersionReader(root));

    expect(stamped?.version).toBe("4.0.0");
  });
});
