import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

describe("integration: scan from a folder of a git repo that belongs to no workspace", () => {
  let output: ScanArtifact;

  beforeAll(async () => {
    ({ artifact: output } = await scanFixture("subdir-scan", { args: ["--quiet"], cwd: "apps/web" }));
  }, 120_000);

  it("occurrence filePaths are git-root-relative", () => {
    const occ = output.occurrences.find((o) => o.filePath.endsWith("App.tsx"));
    expect(occ?.filePath).toBe("apps/web/src/App.tsx");
  });

  it("local component identity filePaths are git-root-relative", () => {
    const card = output.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Card");
    expect(card?.identity).toMatchObject({ kind: "repository-declaration", filePath: "apps/web/src/card.tsx" });
  });
});
