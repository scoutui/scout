import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { ScanArtifact } from "@scoutui/scan-format";
import { runScan } from "../../src/commands/scan.js";
import { stageFixture } from "../helpers/stage-fixture.js";
import { assertValidArtifact } from "../helpers/artifact.js";

let stage: string;
let artifact: ScanArtifact;

beforeAll(async () => {
  stage = await stageFixture("react-app");
  const result = await runScan({
    configPath: path.join(stage, "scout.config.json"),
    repoRoot: stage,
    quiet: true,
  });
  artifact = assertValidArtifact(result.output);
}, 30_000);

afterAll(async () => {
  await rm(stage, { recursive: true, force: true });
});

test("scan captures version from node_modules/<pkg>/package.json", () => {
  // react-app fixture has @example/web-button@1.13.4 in deps.
  const webButton = artifact.components.find(
    (c) => c.identity.kind === "package-export" && c.identity.packageName === "@example/web-button",
  );
  expect(webButton?.version).toBe("1.13.4");
});

test("local components have null version", () => {
  const local = artifact.components.find((c) => c.identity.kind === "repository-declaration");
  expect(local?.version).toBeNull();
});
