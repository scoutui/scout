import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { ScanArtifact } from "@scoutui/scan-format";
import { assertValidArtifact } from "../helpers/artifact.js";

const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../../dist/cli.js");

/** Barrels that `export *` one package beside an export the parser does not record. */
const BARRELS: Record<string, string> = {
  ds1: 'export * from "@example/ds";\nimport * as icons from "../icons";\nexport const { Star } = icons;\n',
  ds2: 'export * from "@example/ds";\nexport default { install() {} };\n',
  ds3: 'export * from "@example/ds";\nexport enum Size { S }\n',
  ds4: 'export * from "@example/ds";\nexport default class {}\n',
  ds5: 'export * from "@example/ds";\nexport * from "../plugin";\n',
};
const names = Object.keys(BARRELS);
const local = (n: string) => `B${n}`;

describe("integration: a barrel that `export *`s one package beside an export the parser does not record", () => {
  let dir = "";
  let artifact: ScanArtifact;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-barrel-unrecorded-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "app", private: true, dependencies: { "@example/ds": "1.0.0" } }),
      "node_modules/@example/ds/package.json": JSON.stringify({ name: "@example/ds", version: "1.0.0", main: "index.js" }),
      "node_modules/@example/ds/index.js": "export function Button() { return null; }\n",
      "scout.config.json": JSON.stringify({ repoId: "app", include: ["src/**/*.{ts,tsx,vue}"] }),
      "src/icons.ts": "export const Star = () => null;\n",
      "src/plugin.ts": "export default { install() {} };\n",
      "src/App.tsx": [
        ...names.map((n) => `import { Button as ${local(n)} } from "./${n}";`),
        `export function App() { return <>${names.map((n) => `<${local(n)} />`).join("")}</>; }`,
        "",
      ].join("\n"),
      "src/VApp.vue": [
        `<template><div>${names.map((n) => `<${local(n)}></${local(n)}>`).join("")}</div></template>`,
        '<script setup lang="ts">',
        ...names.map((n) => `import { Button as ${local(n)} } from "./${n}";`),
        "</script>",
        "",
      ].join("\n"),
      ...Object.fromEntries(Object.entries(BARRELS).map(([n, source]) => [`src/${n}/index.ts`, source])),
    };
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "-A"], { cwd: dir });
    await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"], { cwd: dir });
    await exec("node", [cli, "scan", "--quiet", "--dry-run"], { cwd: dir });
    artifact = assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8")));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each(["src/App.tsx", "src/VApp.vue"])("credits the package's export at every render in %s", (file) => {
    const button = artifact.components.find(
      (c) => c.identity.kind === "package-export" && c.identity.packageName === "@example/ds" && c.identity.exportName === "Button",
    );
    expect(button).toBeDefined();
    const credited = artifact.occurrences.filter((o) => o.filePath === file);
    expect(credited.map((o) => o.resolution)).toEqual(names.map(() => ({ status: "resolved", componentId: button?.id })));
  });
});
