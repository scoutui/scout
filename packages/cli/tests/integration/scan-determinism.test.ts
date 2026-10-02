/**
 * Determinism gate: two consecutive scans of the same fixture must produce
 * byte-identical artefacts apart from the volatile meta block. Catches
 * non-determinism anywhere after file discovery: globby's concurrent walk
 * order, Map insertion order, async races.
 */
import { describe, it, expect } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { runScan } from "../../src/commands/scan.js";
import { stageFixture } from "../helpers/stage-fixture.js";
import { assertValidArtifact } from "../helpers/artifact.js";

function stripVolatile(artifact: { meta: unknown }): string {
  const { meta: _meta, ...stable } = artifact;
  return JSON.stringify(stable, null, 2);
}

describe("scan determinism", () => {
  it("two consecutive scans of the same fixture produce byte-identical output", async () => {
    const fixtureDir = await stageFixture("react-shapes");
    const configPath = path.join(fixtureDir, "scout.config.json");
    try {
      const r1 = await runScan({ configPath, repoRoot: fixtureDir, quiet: true });
      const r2 = await runScan({ configPath, repoRoot: fixtureDir, quiet: true });
      expect(stripVolatile(assertValidArtifact(r2.output))).toBe(stripVolatile(assertValidArtifact(r1.output)));
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  }, 60_000);
});
