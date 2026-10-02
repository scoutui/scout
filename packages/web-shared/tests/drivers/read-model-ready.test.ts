import { describe, expect, it } from "vitest";
import { PROJECTION_VERSION, READ_MODEL_FORMAT_VERSION, scanModelReady } from "../../src/index.js";

const counts = { repo: 1, component: 2, package: 1, detail: 2, occurrence: 3, "graph-node": 0, "graph-edge": 0 };
const ready = {
  state: "ready", projection_version: PROJECTION_VERSION, format_version: READ_MODEL_FORMAT_VERSION,
  build_revision: 1, expected_counts: counts, actual_counts: counts, details_retained: true,
};

describe("scan model readiness", () => {
  it("accepts a complete model at the current versions", () => {
    expect(scanModelReady(ready)).toBe(true);
    expect(scanModelReady(ready, true)).toBe(true);
  });

  it.each([
    ["a missing model", { state: null, projection_version: null, format_version: null, build_revision: null, expected_counts: null, actual_counts: null, details_retained: null }],
    ["a model still building", { ...ready, state: "building" }],
    ["another format", { ...ready, format_version: READ_MODEL_FORMAT_VERSION + 1 }],
    ["no build revision", { ...ready, build_revision: 0 }],
    ["mismatched counts", { ...ready, actual_counts: { ...counts, occurrence: 2 } }],
    ["a missing repo view", { ...ready, expected_counts: { ...counts, repo: 0 }, actual_counts: { ...counts, repo: 0 } }],
  ])("rejects %s", (_, header) => {
    expect(scanModelReady(header)).toBe(false);
  });

  it("serves another projection version with the current format", () => {
    expect(scanModelReady({ ...ready, projection_version: PROJECTION_VERSION + 6 })).toBe(true);
    expect(scanModelReady({ ...ready, projection_version: 0 })).toBe(false);
  });

  it("requires retained details only when asked", () => {
    expect(scanModelReady({ ...ready, details_retained: false })).toBe(true);
    expect(scanModelReady({ ...ready, details_retained: false }, true)).toBe(false);
  });
});
