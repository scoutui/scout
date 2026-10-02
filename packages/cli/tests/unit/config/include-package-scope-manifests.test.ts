import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type ConfigError } from "../../../src/config/loader.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function writeConfig(dir: string, cfg: unknown): string {
  const path = join(dir, "scout.config.json");
  writeFileSync(path, JSON.stringify(cfg));
  return path;
}

describe("includePackageScopeManifests removed", () => {
  it("rejects includePackageScopeManifests field (removed)", async () => {
    const dir = tmp();
    const path = writeConfig(dir, {
      repoId: "test",
      include: ["src/**/*"],
      includePackageScopeManifests: ["@x/button", "@x/card-*"],
    });
    let caught: ConfigError | undefined;
    try {
      await loadConfig(path);
    } catch (err) {
      caught = err as ConfigError;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).toBe("CONFIG_INVALID");
    expect(caught?.message).toBe(`${realpathSync(path)} has a field Scout doesn't use: "includePackageScopeManifests". Remove it and try again.`);
  });

  it("loads config without includePackageScopeManifests", async () => {
    const dir = tmp();
    const path = writeConfig(dir, { repoId: "test", include: ["src/**/*"] });
    const cfg = await loadConfig(path);
    expect(cfg.repoId).toBe("test");
    expect(cfg.include).toEqual(["src/**/*"]);
  });
});
