import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

describe("integration: two workspace apps that define the same `@/*` alias in their own tsconfig", () => {
  let output: ScanArtifact;

  beforeAll(async () => {
    ({ artifact: output } = await scanFixture("per-package-aliases", { args: ["--quiet"] }));
  }, 120_000);

  it("aliased imports resolve to local components (no phantom external)", () => {
    const card = output.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Card");
    expect(card?.identity).toMatchObject({
      kind: "repository-declaration",
      filePath: "apps/one/src/components/card.tsx",
    });
    expect(card?.stats.occurrenceCount).toBe(1);
  });

  it("the second app's same alias resolves to its own target, not the first app's", () => {
    const panel = output.components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Panel");
    expect(panel?.identity).toMatchObject({
      kind: "repository-declaration",
      filePath: "apps/two/src/components/panel.tsx",
    });
    expect(panel?.stats.occurrenceCount).toBe(1);
  });

  it("no external component is fabricated from the alias prefix", () => {
    expect(
      output.components.some((c) => c.identity.kind === "package-export" && c.identity.packageName === "@/components"),
    ).toBe(false);
  });
});
