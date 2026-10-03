import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, } from "../../../src/config/loader.js";

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

describe("loadConfig", () => {
  it("loads a valid minimal config", async () => {
    const dir = tmp();
    const path = writeConfig(dir, {
      repoId: "my-repo",
      include: ["src/**/*.ts"],
    });
    const cfg = await loadConfig(path);
    expect(cfg.repoId).toBe("my-repo");
    expect(cfg.include).toEqual(["src/**/*.ts"]);
    expect(cfg.exclude).toEqual([]);
    // configDir is realpath'd (see loader.ts) so it matches the physical
    // path other resolution layers produce, even when `dir` sits behind a
    // symlink (e.g. macOS's /tmp -> /private/tmp).
    expect(cfg.configDir).toBe(realpathSync(dir));
    expect(cfg.tsconfigPath).toBeUndefined();
    expect(cfg.aliases).toBeUndefined();
  });

  it("rejects when file missing, saying how to create one or point at another", async () => {
    await expect(loadConfig("/nonexistent/path.json")).rejects.toMatchObject({
      code: "CONFIG_MISSING",
      message: "Couldn't find /nonexistent/path.json. Run scout init to create one, or pass --config <path>.",
    });
  });

  it("rejects a file that isn't JSON, naming where the parser stopped and what to do", async () => {
    const dir = tmp();
    const path = join(dir, "scout.config.json");
    writeFileSync(path, '{ "include": ["src/**"]\n');
    await expect(loadConfig(path)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringMatching(new RegExp(`^${realpathSync(path)} isn't valid JSON: .*\\(line 2 column 1\\)\\. Fix it and try again\\.$`)),
    });
  });

  it("accepts include array", async () => {
    const dir = tmp();
    const path = writeConfig(dir, {
      repoId: "my-repo",
      include: ["src/**/*.ts"],
    });
    const cfg = await loadConfig(path);
    expect(cfg.include).toEqual(["src/**/*.ts"]);
  });

  it.each([
    ["a field it doesn't use", { include: ["src/**/*.ts"], output: "./scout-scan.json" }, `has a field Scout doesn't use: "output". Remove it and try again.`],
    ["fields it doesn't use", { output: "./scout-scan.json", include: ["src/**/*.ts"], exlude: ["**/*.test.ts"] }, `has fields Scout doesn't use: "output", "exlude". Remove them and try again.`],
  ])("names %s", async (_, cfg, line) => {
    const path = writeConfig(tmp(), cfg);
    await expect(loadConfig(path)).rejects.toMatchObject({ message: `${realpathSync(path)} ${line}` });
  });

  it("names a field it doesn't use before any other problem", async () => {
    const path = writeConfig(tmp(), { output: "./scout-scan.json", include: [] });
    await expect(loadConfig(path)).rejects.toMatchObject({ message: `${realpathSync(path)} has a field Scout doesn't use: "output". Remove it and try again.` });
  });

  it("requires include field", async () => {
    const dir = tmp();
    const path = writeConfig(dir, {
      repoId: "my-repo",
    });
    await expect(loadConfig(path)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await expect(loadConfig(path)).rejects.toThrow(/include/);
  });

  it("accepts tsconfigPath", async () => {
    const dir = tmp();
    const path = writeConfig(dir, {
      repoId: "my-repo",
      include: ["src/**/*.ts"],
      tsconfigPath: "tsconfig.base.json",
    });
    const cfg = await loadConfig(path);
    expect(cfg.tsconfigPath).toBe("tsconfig.base.json");
  });

  it("accepts aliases as Record<string, string[]>", async () => {
    const dir = tmp();
    const path = writeConfig(dir, {
      repoId: "my-repo",
      include: ["src/**/*.ts"],
      aliases: { "@components/*": ["src/components/*"] },
    });
    const cfg = await loadConfig(path);
    expect(cfg.aliases).toEqual({ "@components/*": ["src/components/*"] });
  });

  it("accepts a fully-populated config with all available fields", async () => {
    const dir = tmp();
    const path = writeConfig(dir, {
      $schema: "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
      repoId: "my-repo",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts"],
      tsconfigPath: "tsconfig.json",
      aliases: { "@/*": ["src/*"] },
      install: "npm ci",
    });
    const cfg = await loadConfig(path);
    expect(cfg.repoId).toBe("my-repo");
    expect(cfg.tsconfigPath).toBe("tsconfig.json");
    expect(cfg.aliases).toEqual({ "@/*": ["src/*"] });
    expect(cfg.install).toBe("npm ci");
  });

  it("rejects an empty install", async () => {
    const path = writeConfig(tmp(), { include: ["src/**/*.ts"], install: "" });
    await expect(loadConfig(path)).rejects.toMatchObject({ message: `Invalid config at ${realpathSync(path)}: /install: must NOT have fewer than 1 characters` });
  });

  describe("legacy manifests field migration", () => {
    it("rejects configs containing manifests with a migration error", async () => {
      const dir = tmp();
      const path = writeConfig(dir, {
        repoId: "x",
        manifests: ["@example/pkg"],
        include: ["src/**/*.tsx"],
      });
      await expect(loadConfig(path)).rejects.toThrow(
        /manifests.*removed/i
      );
    });

    it("loads a valid config without packageScopes", async () => {
      const dir = tmp();
      const path = writeConfig(dir, {
        repoId: "x",
        include: ["src/**/*.tsx"],
      });
      const cfg = await loadConfig(path);
      expect(cfg.repoId).toBe("x");
      expect(cfg.include).toEqual(["src/**/*.tsx"]);
    });
  });

  describe("removed fields rejection", () => {
    it("rejects removed packageScopes field", async () => {
      const dir = tmp();
      const path = writeConfig(dir, {
        packageScopes: ["@example/*"],
        include: ["src/**/*.ts"],
      });
      await expect(loadConfig(path)).rejects.toThrow(`has a field Scout doesn't use: "packageScopes". Remove it and try again.`);
    });

    it("rejects removed includePackageScopeManifests field", async () => {
      const dir = tmp();
      const path = writeConfig(dir, {
        includePackageScopeManifests: ["@example/*"],
        include: ["src/**/*.ts"],
      });
      await expect(loadConfig(path)).rejects.toThrow(`has a field Scout doesn't use: "includePackageScopeManifests". Remove it and try again.`);
    });

    it("rejects removed tagRules field", async () => {
      const dir = tmp();
      const path = writeConfig(dir, {
        tagRules: [{ tag: "web", match: { packageName: "@example/*" } }],
        include: ["src/**/*.ts"],
      });
      await expect(loadConfig(path)).rejects.toThrow(`has a field Scout doesn't use: "tagRules". Remove it and try again.`);
    });

    it("repoId is optional", async () => {
      const dir = tmp();
      const path = writeConfig(dir, {
        include: ["src/**/*.ts"],
      });
      const cfg = await loadConfig(path);
      expect(cfg.include).toEqual(["src/**/*.ts"]);
      expect(cfg.repoId).toBeUndefined();
    });
  });
});
