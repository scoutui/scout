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

describe("integration: path aliases declared in a project a solution-style tsconfig references", () => {
  let dir = "";
  let artifact: ScanArtifact;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cc-solution-style-tsconfig-"));
    await exec("git", ["init", "-q"], { cwd: dir });
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "vue-app", private: true }),
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": JSON.stringify({ include: ["src/**/*"], compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "scout.config.json": JSON.stringify({ repoId: "vue-app", include: ["src/**/*.vue"] }),
      "src/pages/Home.vue": [
        "<template>",
        '  <ExampleCard title="Welcome" />',
        "</template>",
        "<script setup>",
        'import ExampleCard from "@/components/ExampleCard.vue";',
        "</script>",
        "",
      ].join("\n"),
      "src/components/ExampleCard.vue": "<template><article><slot /></article></template>\n",
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

  it("resolves an aliased import to the component the referenced project's paths point at", () => {
    const identityOf = new Map(artifact.components.map((c) => [c.id, c.identity]));
    expect(
      artifact.occurrences.map((o) => ({
        filePath: o.filePath,
        line: o.line,
        component: o.resolution.status === "resolved" ? identityOf.get(o.resolution.componentId) : o.resolution,
        owner: o.ownerComponentId === undefined ? undefined : identityOf.get(o.ownerComponentId),
        trace: o.trace,
        props: o.props,
      })),
    ).toEqual([
      {
        filePath: "src/pages/Home.vue",
        line: 2,
        component: { kind: "repository-declaration", repoId: "vue-app", filePath: "src/components/ExampleCard.vue", exportName: "ExampleCard" },
        owner: { kind: "repository-declaration", repoId: "vue-app", filePath: "src/pages/Home.vue", exportName: "Home" },
        trace: [{ kind: "import", specifier: "@/components/ExampleCard.vue", name: "default" }],
        props: { title: { tier: "written", value: "Welcome" } },
      },
    ]);
  });
});
