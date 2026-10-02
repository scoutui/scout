import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readToolPackage } from "../../../src/envelope/index.js";

describe("readToolPackage", () => {
  it("returns name and version from package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-tv-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@example/tool", version: "1.2.3" }));
      expect(readToolPackage(dir)).toEqual({ name: "@example/tool", version: "1.2.3" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["a URL", "https://example.com/issues"],
    ["{ url }", { url: "https://example.com/issues", email: "bugs@example.com" }],
  ])("returns the bugs URL when package.json gives bugs as %s", (_form, bugs) => {
    const dir = mkdtempSync(join(tmpdir(), "cc-tv-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@example/tool", version: "1.2.3", bugs }));
      expect(readToolPackage(dir)).toEqual({ name: "@example/tool", version: "1.2.3", bugs: "https://example.com/issues" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns version 0.0.0 and no name when package.json is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-tv-"));
    try {
      expect(readToolPackage(dir)).toEqual({ version: "0.0.0" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
