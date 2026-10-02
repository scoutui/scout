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

describe("integration: same-named components declared in sibling functions", () => {
  let dir = "";
  let components: Component[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "scout-sibling-scopes-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "sibling-scopes", private: true }),
      "scout.config.json": JSON.stringify({ repoId: "sibling-scopes", include: ["src/**/*.tsx"] }),
      "src/App.tsx": [
        "export function First() {",
        "  const Item = () => <b />;",
        "  return <Item />;",
        "}",
        "export function Second() {",
        "  const Item = () => <i />;",
        "  return <Item />;",
        "}",
        "",
      ].join("\n"),
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

  // Known gap: both `Item`s share one row, defined at line 2 and credited with both calls.
  it.fails("gives each `Item` its own row, defined where it is declared and credited with its own call", () => {
    const rows = components
      .map((c) => [c.definition?.line, c.stats.occurrenceCount])
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    expect(rows).toEqual([
      [1, 0],
      [2, 1],
      [5, 0],
      [6, 1],
    ]);
  });
});
