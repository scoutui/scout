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

describe("integration: .mjs, .cjs, .mts and .cts files under the default include", () => {
  let dir = "";
  let components: Component[] = [];
  let stdout = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-module-extensions-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "module-extensions", private: true, version: "0.0.0" }),
      "scout.config.json": JSON.stringify({ repoId: "module-extensions" }),
      "src/App.tsx": [
        'import { Button } from "./Button.mjs";',
        'import { Badge } from "./kit.mjs";',
        'import { Chip } from "./Chip.mjs";',
        'import { Card } from "./Card.cjs";',
        "export function App() { return <><Button /><Badge /><Chip /><Card /></>; }",
        "",
      ].join("\n"),
      "src/Button.mjs": "export function Button() { return null; }\n",
      "src/kit.mjs": 'export { Badge } from "./Badge";\n',
      "src/Badge.tsx": "export function Badge() { return <span />; }\n",
      "src/Chip.mts": "export function Chip(): null { return null; }\n",
      "src/Card.cts": "export function Card(): null { return null; }\n",
      "src/legacy.cjs": 'const { Button } = require("./Button.mjs");\nmodule.exports = { Button };\n',
      "src/globals.d.mts": "export declare function Ghost(): null;\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "-A"], { cwd: dir });
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"], { cwd: dir });
    stdout = (await exec("node", [cli, "scan", "--dry-run"], { cwd: dir })).stdout;
    components = assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8"))).components;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("credits each use to the file that declares it, through .mjs and .cjs specifiers and an .mjs barrel", () => {
    const rendered = components
      .filter((c) => c.stats.occurrenceCount > 0)
      .map((c) => ({ identity: c.identity, renders: c.stats.occurrenceCount }));
    const declared = (filePath: string, exportName: string) => ({
      identity: { kind: "repository-declaration", repoId: "module-extensions", filePath, exportName },
      renders: 1,
    });
    expect(rendered).toEqual(
      expect.arrayContaining([
        declared("src/Button.mjs", "Button"),
        declared("src/Badge.tsx", "Badge"),
        declared("src/Chip.mts", "Chip"),
        declared("src/Card.cts", "Card"),
      ]),
    );
    expect(rendered).toHaveLength(4);
  });

  it("scans every .mjs, .cjs, .mts and .cts file, leaving out .d.mts declarations", () => {
    expect(stdout).toContain("Scanned 7 files");
  });
});
