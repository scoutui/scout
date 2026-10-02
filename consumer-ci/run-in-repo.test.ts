import { describe, expect, test } from "vitest";
import { cloneSteps, scanArgs, scanConfig } from "./run-in-repo.js";
import type { ScanSpec, Target } from "./types.js";

const target: Target = {
  name: "t",
  repo: "owner/repo",
  install: "yarn install --immutable --mode=skip-build",
  scans: [],
};

const scan: ScanSpec = {
  cwd: "apps/web",
  repoId: "repo/web",
  include: ["src/**/*.ts"],
};

describe("cloneSteps", () => {
  test("clones the default branch with its full history", () => {
    expect(cloneSteps(target, "/w")).toEqual([
      ["git", "clone", "https://github.com/owner/repo.git", "/w"],
    ]);
  });
});

describe("scanConfig", () => {
  test("includes repoId + gitignore, omits resolution keys when absent", () => {
    expect(scanConfig(scan)).toEqual({
      include: ["src/**/*.ts"],
      repoId: "repo/web",
      gitignore: true,
    });
  });

  test("threads tsconfigPath + aliases when present", () => {
    const withAliases: ScanSpec = {
      ...scan,
      tsconfigPath: "./tsconfig.json",
      aliases: { "@/*": ["./src/*"] },
    };
    expect(scanConfig(withAliases)).toMatchObject({
      tsconfigPath: "./tsconfig.json",
      aliases: { "@/*": ["./src/*"] },
    });
  });
});

describe("scanArgs", () => {
  test("adds --host when host set", () => {
    expect(scanArgs("/c.json", "https://h")).toEqual([
      "scan", "--config", "/c.json", "--host", "https://h",
    ]);
  });

  test("omits --host when host undefined", () => {
    expect(scanArgs("/c.json")).toEqual([
      "scan", "--config", "/c.json",
    ]);
  });
});
