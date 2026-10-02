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

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-unparsed-first-party-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "single-app", private: true, version: "0.0.0" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
      "scout.config.json": JSON.stringify({
        repoId: "single-app",
        include: ["src/**/*.tsx", "src/**/*.ts"],
        exclude: ["src/skip/**"],
      }),
      "src/App.tsx": [
        'import { Drawer } from "@/skip/Drawer";',
        'import { Sheet } from "@/skip";',
        "export function App() { return <><Drawer /><Sheet /></>; }",
        "",
      ].join("\n"),
      "src/skip/Drawer.tsx": "export function Drawer() { return <aside />; }\n",
      "src/skip/index.ts": 'export { Sheet } from "./Sheet";\n',
      "src/skip/Sheet.tsx": "export function Sheet() { return <section />; }\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "-A"], { cwd: dir });
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"], { cwd: dir });
    await exec("node", [cli, "scan", "--quiet", "--dry-run"], { cwd: dir });
    components = assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8"))).components;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

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

  it("names no external package after the alias", () => {
    expect(components.flatMap((c) => (c.identity.kind === "package-export" ? [c.identity.packageName] : []))).toEqual([]);
  });
});
