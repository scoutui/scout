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

describe("integration: Vue template element boundaries", () => {
  let dir = "";
  let artifact: ScanArtifact;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-vue-template-boundaries-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "vue-app", private: true, dependencies: { "@example/ui": "1.0.0" } }),
      "node_modules/@example/ui/package.json": JSON.stringify({ name: "@example/ui", version: "1.0.0", main: "index.js" }),
      "node_modules/@example/ui/index.js":
        "export const ExampleCard = {};\nexport const ExampleButton = {};\nexport const ExampleIcon = {};\n",
      "scout.config.json": JSON.stringify({
        repoId: "vue-app",
        include: ["src/**/*.vue"],
      }),
      "src/AfterTag.vue": [
        "<template>",
        "  <example-badge></example-badge>",
        '  <ExampleCard heading="Profile">',
        '    <ExampleButton size="small" />',
        "  </ExampleCard>",
        "</template>",
        "<script setup>",
        'import { ExampleCard, ExampleButton } from "@example/ui";',
        "</script>",
        "",
      ].join("\n"),
      "src/AfterTextarea.vue": [
        "<template>",
        '  <textarea v-model="note" />',
        '  <ExampleButton size="large" />',
        "</template>",
        "<script setup>",
        'import { ExampleButton } from "@example/ui";',
        "</script>",
        "",
      ].join("\n"),
      "src/Siblings.vue": [
        "<template>",
        '  <ExampleIcon name="star" />',
        '  <ExampleButton :itemCount="3" />',
        "</template>",
        "<script setup>",
        'import { ExampleButton, ExampleIcon } from "@example/ui";',
        "</script>",
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
    artifact = assertValidArtifact(JSON.parse(await readFile(join(dir, "scout-scan.json"), "utf8")));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function rendersIn(filePath: string) {
    const identityOf = new Map(artifact.components.map((c) => [c.id, c.identity]));
    return artifact.occurrences
      .filter((o) => o.filePath === filePath)
      .sort((a, b) => a.line - b.line)
      .map((o) => ({
        line: o.line,
        column: o.column,
        component: o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution,
        owner: o.ownerComponentId === undefined ? undefined : identityOf.get(o.ownerComponentId),
        trace: o.trace,
        props: o.props,
      }));
  }

  const ui = (exportName: string) => ({ kind: "package-export", packageName: "@example/ui", publicEntry: "", exportName });
  const sfc = (name: string) => ({ kind: "repository-declaration", repoId: "vue-app", filePath: `src/${name}.vue`, exportName: name });
  const imported = (name: string) => [{ kind: "import", specifier: "@example/ui", name }];

  it("credits a component after a custom element tag with its own import and nesting", () => {
    expect(rendersIn("src/AfterTag.vue")).toEqual([
      { line: 2, column: 3, component: { kind: "tag", tagName: "example-badge" }, owner: sfc("AfterTag"), trace: [], props: {} },
      {
        line: 3,
        column: 3,
        component: ui("ExampleCard"),
        owner: sfc("AfterTag"),
        trace: imported("ExampleCard"),
        props: { heading: { tier: "written", value: "Profile" } },
      },
      {
        line: 4,
        column: 5,
        component: ui("ExampleButton"),
        owner: sfc("AfterTag"),
        trace: imported("ExampleButton"),
        props: { size: { tier: "written", value: "small" } },
      },
    ]);
  });

  it("keeps reading the template after a self-closing textarea", () => {
    expect(rendersIn("src/AfterTextarea.vue")).toEqual([
      {
        line: 3,
        column: 3,
        component: ui("ExampleButton"),
        owner: sfc("AfterTextarea"),
        trace: imported("ExampleButton"),
        props: { size: { tier: "written", value: "large" } },
      },
    ]);
  });

  it("closes a self-closing component, so the next one is its sibling, and keeps prop names as written", () => {
    expect(rendersIn("src/Siblings.vue")).toEqual([
      {
        line: 2,
        column: 3,
        component: ui("ExampleIcon"),
        owner: sfc("Siblings"),
        trace: imported("ExampleIcon"),
        props: { name: { tier: "written", value: "star" } },
      },
      {
        line: 3,
        column: 3,
        component: ui("ExampleButton"),
        owner: sfc("Siblings"),
        trace: imported("ExampleButton"),
        props: { itemCount: { tier: "written", value: 3 } },
      },
    ]);
  });
});
