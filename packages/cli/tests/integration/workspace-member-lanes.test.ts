import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { ScanArtifact } from "@scoutui/scan-format";
import { assertValidArtifact } from "../helpers/artifact.js";
import { stageFixture } from "../helpers/stage-fixture.js";

const CLI = resolve(import.meta.dirname, "..", "..", "dist", "cli.js");

type Install = "none" | "linked" | "published";

async function stageInstall(install: Install): Promise<string> {
  const stage = await stageFixture("workspace-subscan");

  if (install === "linked") {
    // A symlink to the workspace package, as Yarn links one.
    mkdirSync(join(stage, "node_modules", "@ws-sub"), { recursive: true });
    symlinkSync(join(stage, "packages", "ui"), join(stage, "node_modules", "@ws-sub", "ui"), "dir");
  }
  if (install === "published") {
    // A real directory, not a symlink: what yarn materialises when a
    // version pin isn't satisfied by the workspace member. It differs from
    // the member on purpose, so filePath assertions fail if resolution lands here.
    const published = join(stage, "node_modules", "@ws-sub", "ui");
    mkdirSync(join(published, "dist"), { recursive: true });
    writeFileSync(
      join(published, "package.json"),
      JSON.stringify({ name: "@ws-sub/ui", version: "9.9.9", main: "dist/index.js" }),
    );
    writeFileSync(join(published, "dist", "index.js"), "export const Button = () => null;\n");
  }
  return stage;
}

function scan(cwd: string): ScanArtifact {
  execFileSync("node", [CLI, "scan", "--quiet", "--dry-run"], { cwd, stdio: "pipe" });
  return assertValidArtifact(JSON.parse(readFileSync(join(cwd, "scout-scan.json"), "utf8")));
}

const findButton = (o: ScanArtifact) =>
  o.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Button");

describe("integration: workspace-member lanes are install-state independent", () => {
  const installs: Install[] = ["none", "linked", "published"];
  const stages = new Map<Install, string>();
  const outs = new Map<Install, ScanArtifact>();
  const out = (install: Install) => outs.get(install) as ScanArtifact;

  beforeAll(async () => {
    for (const install of installs) {
      const stage = await stageInstall(install);
      stages.set(install, stage);
      outs.set(install, scan(stage));
    }
  });

  afterAll(() => {
    for (const stage of stages.values()) rmSync(stage, { recursive: true, force: true });
  });

  it("no install at all: member Button is local, pinned to its definition file", () => {
    const button = findButton(out("none"));
    expect(button?.identity).toMatchObject({ kind: "repository-declaration", filePath: "packages/ui/src/button.tsx" });
    expect(button?.owningPackage).toBe("@ws-sub/ui");
  });

  it("linked into node_modules: member Button is local source, owned by its package", () => {
    const button = findButton(out("linked"));
    expect(button?.identity).toMatchObject({ kind: "repository-declaration", filePath: "packages/ui/src/button.tsx" });
    expect(button?.owningPackage).toBe("@ws-sub/ui");
  });

  it("linked into node_modules: App is owned by its own package and renders the member's Button once", () => {
    const linked = out("linked");
    const app = linked.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "App");
    expect(app?.identity.kind).toBe("repository-declaration");
    expect(app?.owningPackage).toBe("@ws-sub/web");
    expect(app?.composition.rendersByCount[findButton(linked)?.id ?? ""]).toBe(1);
  });

  it("version-pinned published copy present: member Button is still local source", () => {
    const button = findButton(out("published"));
    expect(button?.identity).toMatchObject({ kind: "repository-declaration", filePath: "packages/ui/src/button.tsx" });
  });

  it("identity is install-invariant: every install state agrees on Button's id", () => {
    const ids = installs.map((install) => findButton(out(install))?.id);
    expect(ids[0]).toBeDefined();
    expect(new Set(ids).size).toBe(1);
  });

  it("no phantom external component for the member in any state", () => {
    for (const install of installs) {
      expect(
        out(install).components.some(
          (c) => c.identity.kind === "package-export" && c.identity.packageName === "@ws-sub/ui",
        ),
      ).toBe(false);
    }
  });
});
