/**
 * Byte-identity gate for the scan pipeline. Asserts that the current scan
 * output for every fixture with a `scout.config.json` matches its
 * captured baseline. The `meta` fields that change on every scan (scanId,
 * scannedAt, scannerVersion, and the repo's commit, committedAt,
 * initialCommit and branch) hold fixed values in a baseline, so a baseline
 * stays a valid scan file.
 *
 * Each fixture is staged as a repository of its own (see stage-fixture.ts),
 * so the scan sees only the fixture and the packages it declares.
 *
 * Capture: `CAPTURE_BASELINES=1 yarn vitest run tests/integration/scan-baseline-vs-oxc.test.ts`
 * writes the current output, with those fields fixed, over the baselines
 * instead of comparing (add `-t <fixture>` for one), so a recaptured baseline
 * differs only where the output does. Read the failing diff before you capture.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runScan } from "../../src/commands/scan.js";
import { stageFixture } from "../helpers/stage-fixture.js";
import { assertValidArtifact } from "../helpers/artifact.js";

const BASELINE_DIR = path.join(import.meta.dirname, "__baselines__", "current");
const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../../../../test/fixtures");
const { CAPTURE_BASELINES } = process.env;
const CAPTURE = CAPTURE_BASELINES === "1";

const fixtures = readdirSync(FIXTURES_ROOT)
  .filter((name) => existsSync(path.join(FIXTURES_ROOT, name, "scout.config.json")))
  .sort();

const FIXED_TIME = "1970-01-01T00:00:00.000Z";

/** What a baseline holds: the scan output with every `meta` field that changes between scans set to a fixed value. */
function withFixedMeta(json: string): string {
  const artifact = JSON.parse(json);
  const { meta } = artifact;
  artifact.meta = {
    ...meta,
    scannerVersion: "0.0.0",
    scanId: "baseline",
    scannedAt: FIXED_TIME,
    repo: { ...meta.repo, commit: "baseline", committedAt: FIXED_TIME, initialCommit: "baseline", branch: "baseline" },
  };
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

describe("scan baseline-vs-oxc byte-identity", () => {
  for (const fixture of fixtures) {
    it(`${fixture} matches its captured baseline`, async () => {
      const stage = await stageFixture(fixture);
      try {
        const result = await runScan({
          configPath: path.join(stage, "scout.config.json"),
          quiet: true,
          repoRoot: stage,
        });
        expect(result.output, `runScan returned no output for ${fixture}`).not.toBeNull();
        const currentJson = await readFile(path.join(stage, "scout-scan.json"), "utf8");
        assertValidArtifact(JSON.parse(currentJson));

        const current = withFixedMeta(currentJson);
        const baselinePath = path.join(BASELINE_DIR, `${fixture}.json`);
        if (CAPTURE) {
          await writeFile(baselinePath, current);
          return;
        }
        expect(current).toBe(await readFile(baselinePath, "utf8"));
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }, 120_000);
  }
});
