import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

// A repo whose package.json declares @example/ui and has no node_modules:
// the render of its Button is observed, unresolved, and names no package
// component.
describe("integration: unresolved-install, a declared package that is not installed", () => {
  let scan: ScanArtifact;

  beforeAll(async () => {
    ({ artifact: scan } = await scanFixture("unresolved-install", { args: ["--quiet"] }));
  }, 30_000);

  it("observes the render as one package-not-installed occurrence", () => {
    expect(scan.occurrences).toHaveLength(1);
    expect(scan.occurrences[0]).toMatchObject({
      resolution: { status: "unresolved", reason: { kind: "package-not-installed", packageName: "@example/ui" } },
      filePath: "src/App.tsx",
      line: 4,
      trace: [{ kind: "import", specifier: "@example/ui", name: "Button" }],
    });
    expect(Object.keys(scan.occurrences[0]?.props ?? {})).toEqual(["kind"]);
  });

  it("names no package component for it", () => {
    expect(scan.components.filter((c) => c.identity.kind === "package-export")).toEqual([]);
  });
});
