import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { Component } from "@scoutui/scan-format";
import { assertValidArtifact } from "../helpers/artifact.js";

const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../../dist/cli.js");

describe("integration: a single-package repo importing a file its include excludes", () => {
  let dir = "";
  let components: Component[] = [];
  let scanStderr = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-unparsed-first-party-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "single-app", private: true, version: "0.0.0" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
      "scout.config.json": JSON.stringify({
        repoId: "single-app",
        include: ["src/**/*.tsx", "src/**/*.ts", "src/**/*.vue"],
        exclude: ["src/skip/**"],
      }),
      "src/App.tsx": [
        'import { Drawer } from "@/skip/Drawer";',
        'import { Sheet } from "@/skip";',
        "export function App() { return <><Drawer /><Sheet /></>; }",
        "",
      ].join("\n"),
      "src/Home.vue": [
        '<script setup lang="ts">',
        'import { Tile, Badge } from "@/skip";',
        "</script>",
        "",
        "<template>",
        "  <Tile />",
        "  <Badge />",
        "</template>",
        "",
      ].join("\n"),
      "src/skip/Drawer.tsx": "export function Drawer() { return <aside />; }\n",
      "src/skip/index.ts": [
        'export { Sheet } from "./Sheet";',
        'import Tile from "./Tile.vue";',
        "export { Tile };",
        'export { default as Badge } from "./Badge.vue";',
        "",
      ].join("\n"),
      "src/skip/Sheet.tsx": "export function Sheet() { return <section />; }\n",
      "src/skip/Tile.vue": [
        '<script setup lang="ts">',
        'const label = "tile";',
        "</script>",
        "",
        "<template>",
        "  <div>{{ label }}</div>",
        "</template>",
        "",
      ].join("\n"),
      "src/skip/Badge.vue": [
        '<script setup lang="ts">',
        'defineOptions({ name: "StatusBadge" });',
        "</script>",
        "",
        "<template>",
        "  <span />",
        "</template>",
        "",
      ].join("\n"),
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "-A"], { cwd: dir });
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"], { cwd: dir });
    scanStderr = (await exec("node", [cli, "scan", "--dry-run"], { cwd: dir })).stderr;
    components = assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8"))).components;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Every component row declared in `filePath`, with its render count. */
  function rowsIn(filePath: string) {
    return components
      .filter((c) => c.identity.kind === "repository-declaration" && c.identity.filePath === filePath)
      .map((c) => ({ identity: c.identity, renders: c.stats.occurrenceCount }));
  }

  it("credits an alias import of the excluded file as a local row pinned to that file", () => {
    const drawer = components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Drawer");
    expect(drawer?.identity).toMatchObject({ kind: "repository-declaration", filePath: "src/skip/Drawer.tsx" });
    expect(drawer?.stats.occurrenceCount).toBe(1);
  });

  it("pins an alias import of an excluded barrel to the file that declares the component", () => {
    const sheet = components.find((c) => c.identity.kind !== "tag" && c.identity.exportName === "Sheet");
    expect(sheet?.identity).toMatchObject({ kind: "repository-declaration", filePath: "src/skip/Sheet.tsx" });
    expect(sheet?.stats.occurrenceCount).toBe(1);
  });

  it("names a Vue component an excluded barrel imports and exports again after its file, as a scan of the barrel does", () => {
    expect(rowsIn("src/skip/Tile.vue")).toEqual([
      {
        identity: { kind: "repository-declaration", repoId: "single-app", filePath: "src/skip/Tile.vue", exportName: "Tile" },
        renders: 1,
      },
    ]);
  });

  it("names a Vue component an excluded barrel re-exports by its defineOptions name, as a scan of the barrel does", () => {
    expect(rowsIn("src/skip/Badge.vue")).toEqual([
      {
        identity: { kind: "repository-declaration", repoId: "single-app", filePath: "src/skip/Badge.vue", exportName: "StatusBadge" },
        renders: 1,
      },
    ]);
  });

  it("follows the excluded barrel's re-exports to their files without a warning", () => {
    expect(scanStderr).not.toContain("Stopped following re-exports");
  });

  it("names no external package after the alias", () => {
    expect(components.flatMap((c) => (c.identity.kind === "package-export" ? [c.identity.packageName] : []))).toEqual([]);
  });
});
