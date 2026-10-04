import { describe, expect, it } from "vitest";
import { computeVersionShare } from "@/components/viz/version-composition";
import { compareVersions } from "@/lib/version-order";

describe("compareVersions", () => {
  it("orders numerically per segment: 1.5.0 before 1.14.11", () => {
    expect(compareVersions("1.5.0", "1.14.11")).toBeLessThan(0);
    expect(compareVersions("1.14.11", "1.5.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("sorts an array ascending, 0.x before 1.x", () => {
    expect(["1.14.11", "0.9.0", "1.5.0"].sort(compareVersions)).toEqual(["0.9.0", "1.5.0", "1.14.11"]);
  });

  it("puts a release above its prereleases", () => {
    expect(["5.0.0", "5.0.0-rc.2", "4.9.0", "5.0.0-beta.1"].sort(compareVersions)).toEqual(["4.9.0", "5.0.0-beta.1", "5.0.0-rc.2", "5.0.0"]);
  });
});

describe("computeVersionShare ordering", () => {
  it("puts the numerically latest version first and unversioned last", () => {
    const share = computeVersionShare(
      [
        { version: "1.5.0", occurrenceCount: 3 },
        { version: "1.14.11", occurrenceCount: 2 },
        { version: null, occurrenceCount: 1 },
      ],
      2,
    );
    expect(share.map((s) => s.label)).toEqual(["1.14.11", "1.5.0", "unversioned"]);
    expect(share[0]?.latest).toBe(true);
  });
});
