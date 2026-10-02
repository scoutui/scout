import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readVersion } from "../../../src/util/version.js";

describe("readVersion", () => {
  it("returns the version from package.json (never a drifting constant)", () => {
    const pkgUrl = new URL("../../../package.json", import.meta.url);
    const expected = (JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string }).version;
    expect(readVersion()).toBe(expected);
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
