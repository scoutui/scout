import { describe, expect, it } from "vitest";
import { compareCliVersions } from "@/lib/scan-acceptance";

const sign = { above: 1, "equal to": 0, below: -1 } as const;

describe("compareCliVersions", () => {
  it.each<[string, keyof typeof sign, string]>([
    ["1.4.0", "above", "1.4.0-rc.1"],
    ["1.10.0", "above", "1.9.0"],
    ["1.4.0-rc.10", "above", "1.4.0-rc.2"],
    ["1.4.0+build.5", "equal to", "1.4.0"],
    ["0.0.0-pr-752-a1c9e04-20260928120000", "below", "0.1.0"],
  ])("ranks %s %s %s", (a, relation, b) => {
    expect(Math.sign(compareCliVersions(a, b))).toBe(sign[relation]);
  });
});
