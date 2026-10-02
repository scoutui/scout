import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

// vue-barrel-tag fixture: `src/App.vue` side-effect-imports
// `@example/webc-barrel/components/button.js`, which re-exports
// `@example/web-button` from the barrel's own nested `node_modules`. The
// only CEM declaring `<web-button>` is that nested package's, which the
// consumer cannot import. Staged outside the monorepo, so the nested install
// is the only `@example/web-button` in the scanned repository.

describe("integration: vue-barrel-tag, a CEM reachable only through a barrel's nested install", () => {
  let scan: ScanArtifact;

  beforeAll(async () => {
    ({ artifact: scan } = await scanFixture("vue-barrel-tag", { args: ["--quiet"] }));
  }, 30_000);

  it("observes the <web-button> occurrence", () => {
    expect(scan.occurrences.map((o) => [o.filePath, o.resolution.status])).toEqual([["src/App.vue", "resolved"]]);
  });

  it("attributes <web-button> to the nested install's package by its CEM", () => {
    const comp = scan.components.find((c) => c.identity.kind === "tag" && c.identity.tagName === "web-button");
    expect(comp?.attribution).toMatchObject({
      status: "resolved",
      target: { kind: "package", packageName: "@example/web-button" },
      confidence: "declared",
    });
  });
});
