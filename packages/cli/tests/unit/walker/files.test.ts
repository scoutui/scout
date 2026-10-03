import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkFiles } from "../../../src/walker/files.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-walker-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "src/sub"), { recursive: true });
  mkdirSync(join(root, "node_modules/x"), { recursive: true });
  writeFileSync(join(root, "src/a.tsx"), "");
  writeFileSync(join(root, "src/b.test.tsx"), "");
  writeFileSync(join(root, "src/sub/c.md"), "");
  writeFileSync(join(root, "node_modules/x/d.tsx"), "");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("walkFiles", () => {
  it("returns matched files, excluded ones removed", async () => {
    const files = await walkFiles({
      root,
      include: ["src/**/*.{tsx,md}"],
      exclude: ["**/*.test.*", "**/node_modules/**"],
      gitignore: true,
    });
    expect(files.sort()).toEqual([
      join(root, "src/a.tsx"),
      join(root, "src/sub/c.md"),
    ].sort());
  });

  it("returns empty array when no matches", async () => {
    const files = await walkFiles({
      root,
      include: ["**/*.svelte"],
      exclude: [],
      gitignore: true,
    });
    expect(files).toEqual([]);
  });
});

function gitignoreFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-walker-gi-"));
  writeFileSync(join(dir, "a.ts"), "");
  writeFileSync(join(dir, "b.tsx"), "");
  mkdirSync(join(dir, ".next"), { recursive: true });
  writeFileSync(join(dir, ".next", "build.ts"), "");
  mkdirSync(join(dir, "ignored"), { recursive: true });
  writeFileSync(join(dir, "ignored", "x.ts"), "");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  return dir;
}

describe("walkFiles: gitignore / dot / exclude semantics", () => {
  it("skips dotfile directories by default (dot:false)", async () => {
    const dir = gitignoreFixture();
    try {
      const files = await walkFiles({
        root: dir,
        include: ["**/*.ts", "**/*.tsx"],
        exclude: [],
        gitignore: true,
      });
      expect(files.some((f) => f.includes(".next"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("respects .gitignore when gitignore: true", async () => {
    const dir = gitignoreFixture();
    try {
      const files = await walkFiles({
        root: dir,
        include: ["**/*.ts"],
        exclude: [],
        gitignore: true,
      });
      expect(files.some((f) => f.includes("ignored/"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes gitignored files when gitignore: false", async () => {
    const dir = gitignoreFixture();
    try {
      const files = await walkFiles({
        root: dir,
        include: ["**/*.ts"],
        exclude: [],
        gitignore: false,
      });
      expect(files.some((f) => f.includes("ignored/"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours user exclude globs", async () => {
    const dir = gitignoreFixture();
    try {
      const files = await walkFiles({
        root: dir,
        include: ["**/*.ts", "**/*.tsx"],
        exclude: ["**/b.*"],
        gitignore: true,
      });
      expect(files.some((f) => f.endsWith("b.tsx"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("walkFiles: nested repositories", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cc-walker-nested-"));
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "vendor/lib/src"), { recursive: true });
    writeFileSync(join(repo, "src/App.tsx"), "");
    writeFileSync(join(repo, "vendor/lib/.git"), "gitdir: ../../.git/modules/lib\n");
    writeFileSync(join(repo, "vendor/lib/src/Widget.tsx"), "");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("skips a folder below the root that holds its own .git", async () => {
    const files = await walkFiles({ root: repo, include: ["**/*.tsx"], exclude: [], gitignore: true });
    expect(files).toEqual([join(repo, "src/App.tsx")]);
  });

  it("lists a nested repository's files when the walk starts inside it", async () => {
    const lib = join(repo, "vendor/lib");
    const files = await walkFiles({ root: lib, include: ["**/*.tsx"], exclude: [], gitignore: true });
    expect(files).toEqual([join(lib, "src/Widget.tsx")]);
  });
});
