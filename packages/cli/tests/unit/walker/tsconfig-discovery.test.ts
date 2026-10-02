import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveTsconfigPath } from "../../../src/walker/tsconfig-discovery.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cc-tsdiscovery-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveTsconfigPath", () => {
  it("returns the explicit tsconfigPath when set, resolved absolute", () => {
    const configDir = join(tmp, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "tsconfig.json"), "{}");
    const result = resolveTsconfigPath({
      configDir,
      repoRoot: tmp,
      tsconfigPath: "./tsconfig.json",
    });
    expect(result).toBe(join(configDir, "tsconfig.json"));
  });

  it("respects an absolute tsconfigPath unchanged", () => {
    const abs = join(tmp, "custom.tsconfig.json");
    writeFileSync(abs, "{}");
    const result = resolveTsconfigPath({
      configDir: tmp,
      repoRoot: tmp,
      tsconfigPath: abs,
    });
    expect(result).toBe(abs);
  });

  it("auto-detects tsconfig in configDir when not explicitly set", () => {
    const configDir = join(tmp, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "tsconfig.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBe(join(configDir, "tsconfig.json"));
  });

  it("falls back to repoRoot tsconfig when configDir has none", () => {
    const configDir = join(tmp, "subdir");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(tmp, "tsconfig.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBe(join(tmp, "tsconfig.json"));
  });

  it("returns null when no tsconfig is found anywhere", () => {
    const configDir = join(tmp, "no-tsconfig");
    mkdirSync(configDir, { recursive: true });
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBeNull();
  });

  it("prefers configDir tsconfig over repoRoot tsconfig when both exist", () => {
    const configDir = join(tmp, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "tsconfig.json"), "{}");
    writeFileSync(join(tmp, "tsconfig.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBe(join(configDir, "tsconfig.json"));
  });

  it("does not walk above repoRoot", () => {
    const repoRoot = join(tmp, "repo");
    const configDir = join(repoRoot, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(tmp, "tsconfig.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot });
    expect(result).toBeNull();
  });
});

describe("resolveTsconfigPath: tsconfig.base.json fallback", () => {
  it("discovers tsconfig.base.json at configDir when no tsconfig.json exists", () => {
    const configDir = join(tmp, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "tsconfig.base.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBe(join(configDir, "tsconfig.base.json"));
  });

  it("prefers tsconfig.json over tsconfig.base.json at the same location", () => {
    const configDir = join(tmp, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "tsconfig.json"), "{}");
    writeFileSync(join(configDir, "tsconfig.base.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBe(join(configDir, "tsconfig.json"));
  });

  it("falls back to repoRoot tsconfig.base.json when configDir has nothing", () => {
    const configDir = join(tmp, "subdir");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(tmp, "tsconfig.base.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBe(join(tmp, "tsconfig.base.json"));
  });

  it("prefers configDir tsconfig.base.json over repoRoot tsconfig.base.json", () => {
    const configDir = join(tmp, "config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "tsconfig.base.json"), "{}");
    writeFileSync(join(tmp, "tsconfig.base.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBe(join(configDir, "tsconfig.base.json"));
  });

  it("falls back to repoRoot and prefers its tsconfig.json over its tsconfig.base.json", () => {
    // configDir has neither file; repoRoot has both.
    const configDir = join(tmp, "subdir");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(tmp, "tsconfig.json"), "{}");
    writeFileSync(join(tmp, "tsconfig.base.json"), "{}");
    const result = resolveTsconfigPath({ configDir, repoRoot: tmp });
    expect(result).toBe(join(tmp, "tsconfig.json"));
  });
});
