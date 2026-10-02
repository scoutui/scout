import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

// workspace-cem-installs: two workspace members render a custom element
// without importing it. `apps/web`'s package is installed only in its own
// node_modules; `apps/site`'s only in the workspace root's.
// CEM discovery reads every install in the repository, whichever folder the
// scan starts from.
describe("integration: workspace-cem-installs fixture", () => {
  const scans = new Map<string, ScanArtifact>();
  const tagNamed = (cwd: string, tagName: string) =>
    scans.get(cwd)?.components.find((c) => c.identity.kind === "tag" && c.identity.tagName === tagName);

  beforeAll(async () => {
    for (const cwd of ["apps/web", "apps/site", "."]) {
      scans.set(cwd, (await scanFixture("workspace-cem-installs", { args: ["--quiet"], cwd })).artifact);
    }
  }, 60_000);

  it.each(["apps/web", "."])("attributes <wc-button> to the package in apps/web's own node_modules when scanning from %s", (cwd) => {
    expect(tagNamed(cwd, "wc-button")?.attribution).toMatchObject({
      status: "resolved",
      target: { kind: "package", packageName: "@example/wc-kit" },
      confidence: "declared",
    });
  });

  it("attributes <x-button> to the package in the workspace root's node_modules when scanning from apps/site", () => {
    expect(tagNamed("apps/site", "x-button")?.attribution).toMatchObject({
      status: "resolved",
      target: { kind: "package", packageName: "@example/x-button" },
    });
  });

  it("resolves the <x-button> render in apps/site to the tag's row", () => {
    const button = tagNamed("apps/site", "x-button");
    expect(button).toBeDefined();
    const occ = scans
      .get("apps/site")
      ?.occurrences.find((o) => o.resolution.status === "resolved" && o.resolution.componentId === button?.id);
    expect(occ?.filePath).toBe("apps/site/pages/index.vue");
  });
});
