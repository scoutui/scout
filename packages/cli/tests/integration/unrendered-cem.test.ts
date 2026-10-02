import { describe, it, expect, beforeAll } from "vitest";
import type { ScanArtifact } from "@scoutui/scan-format";
import { scanFixture } from "../helpers/stage-fixture.js";

// unrendered-cem: the repo declares @example/elements, whose CEM declares
// three tags. It side-effect-imports the module that defines <fake-alpha> and
// renders only <fake-beta-one>. A tag gets a components[] row only when it is
// rendered.
describe("integration: unrendered-cem fixture", () => {
  let scan: ScanArtifact;
  const tagNamed = (tagName: string) =>
    scan.components.find((c) => c.identity.kind === "tag" && c.identity.tagName === tagName);

  beforeAll(async () => {
    ({ artifact: scan } = await scanFixture("unrendered-cem", { args: ["--quiet"] }));
  }, 30_000);

  it("attributes the rendered <fake-beta-one> to @example/elements", () => {
    const row = tagNamed("fake-beta-one");
    expect(row?.attribution).toMatchObject({
      status: "resolved",
      target: { kind: "package", packageName: "@example/elements" },
    });
    expect(row?.stats.occurrenceCount).toBe(1);
  });

  it("creates no row for <fake-alpha>, whose module is imported but whose tag is never rendered", () => {
    expect(tagNamed("fake-alpha")).toBeUndefined();
  });

  it("creates no row for <fake-beta-two>, which the CEM declares but nothing renders", () => {
    expect(tagNamed("fake-beta-two")).toBeUndefined();
  });

  it("gives every row not declared in the repo an occurrence", () => {
    const external = scan.components.filter((c) => c.identity.kind !== "repository-declaration");
    expect(external).not.toEqual([]);
    for (const c of external) expect(c.stats.occurrenceCount).toBeGreaterThan(0);
  });
});
