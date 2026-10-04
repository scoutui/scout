import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import type { ScanArtifact } from "@scoutui/scan-format";
import { assertValidArtifact } from "../helpers/artifact.js";

const here = import.meta.dirname;
const CLI = resolve(here, "..", "..", "dist", "cli.js");

function commit(stage: string): void {
  execFileSync("git", ["init", "-q"], { cwd: stage, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: stage, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: stage, stdio: "pipe" });
  execFileSync("git", ["add", "-A"], { cwd: stage, stdio: "pipe" });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: stage, stdio: "pipe" });
}

function scan(cwd: string, args: string[] = []): { artifact: ScanArtifact; text: string } {
  execFileSync("node", [CLI, "scan", "--quiet", "--dry-run", ...args], { cwd, stdio: "pipe" });
  const text = readFileSync(join(cwd, "scout-scan.json"), "utf8");
  return { artifact: assertValidArtifact(JSON.parse(text)), text };
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

const tagNamed = (artifact: ScanArtifact, tagName: string) =>
  artifact.components.find((c) => c.identity.kind === "tag" && c.identity.tagName === tagName);

/** The files of a package installed at `dir` whose CEM declares `tags`. */
function cemPackage(dir: string, name: string, tags: string[]): Record<string, string> {
  return {
    [`${dir}/package.json`]: JSON.stringify({ name, version: "1.0.0", main: "index.js", customElements: "custom-elements.json" }),
    [`${dir}/index.js`]: "export {};\n",
    [`${dir}/custom-elements.json`]: JSON.stringify({
      schemaVersion: "1.0.0",
      modules: [{ declarations: tags.map((tagName) => ({ kind: "class", customElement: true, tagName, name: "C" })) }],
    }),
  };
}

// CEM discovery reads every install inside the repository and none above it.
describe("integration: CEM discovery is bounded by the repository root", () => {
  let stage: string;

  beforeAll(() => {
    stage = mkdtempSync(join(tmpdir(), "cc-cem-bound-"));
  });

  afterAll(() => {
    rmSync(stage, { recursive: true, force: true });
  });

  it("ignores a manifest installed above the repository root", () => {
    const outer = join(stage, "above");
    const repo = join(outer, "repo");
    writeFiles(outer, cemPackage("node_modules/@example/above-kit", "@example/above-kit", ["above-tag"]));
    writeFiles(repo, {
      "package.json": JSON.stringify({ name: "above", private: true, version: "0.0.0" }),
      "scout.config.json": JSON.stringify({ repoId: "above", include: ["src/**/*.vue"] }),
      "src/App.vue": "<template>\n  <above-tag></above-tag>\n</template>\n",
    });
    commit(repo);
    const { artifact } = scan(repo);
    expect(tagNamed(artifact, "above-tag")?.attribution).toEqual({ status: "unknown", reason: "absent", evidence: [] });
  });

  /** A repository at `dir` whose `src/App.vue` renders `<tag>`. */
  const consumer = (dir: string, tag: string): void =>
    writeFiles(dir, {
      "package.json": JSON.stringify({ name: "consumer", private: true, version: "0.0.0" }),
      "scout.config.json": JSON.stringify({ repoId: "consumer", include: ["src/**/*.vue"] }),
      "src/App.vue": `<template>\n  <${tag}></${tag}>\n</template>\n`,
    });

  it("ignores an install in a nested repository", () => {
    const repo = join(stage, "nested");
    consumer(repo, "nested-tag");
    commit(repo);
    const sub = join(repo, "sub");
    writeFiles(sub, {
      "package.json": JSON.stringify({ name: "unrelated", private: true, version: "0.0.0" }),
      ...cemPackage("node_modules/@example/nested-kit", "@example/nested-kit", ["nested-tag"]),
    });
    commit(sub);
    const { artifact } = scan(repo);
    expect(tagNamed(artifact, "nested-tag")?.attribution).toEqual({ status: "unknown", reason: "absent", evidence: [] });
  });

  it("ignores an install in a git worktree under the repository root", () => {
    const repo = join(stage, "worktree");
    consumer(repo, "wt-tag");
    commit(repo);
    execFileSync("git", ["worktree", "add", "-q", "-b", "other", join(repo, ".worktrees", "wt")], { cwd: repo, stdio: "pipe" });
    writeFiles(join(repo, ".worktrees", "wt"), cemPackage("node_modules/@example/wt-kit", "@example/wt-kit", ["wt-tag"]));
    const { artifact } = scan(repo);
    expect(tagNamed(artifact, "wt-tag")?.attribution).toEqual({ status: "unknown", reason: "absent", evidence: [] });
  });

  it("reads a nested repository that holds the scanned config when the repository root is set above it", () => {
    const outer = join(stage, "outer");
    writeFiles(outer, { "package.json": JSON.stringify({ name: "outer", private: true, version: "0.0.0" }) });
    commit(outer);
    const app = join(outer, "app");
    consumer(app, "app-tag");
    writeFiles(app, cemPackage("node_modules/@example/app-kit", "@example/app-kit", ["app-tag"]));
    commit(app);
    const { artifact } = scan(app, ["--repo-root", outer]);
    expect(tagNamed(artifact, "app-tag")?.attribution).toMatchObject({
      status: "resolved",
      target: { kind: "package", packageName: "@example/app-kit" },
    });
  });

  it("keeps every claim when the installs outnumber the open-file limit", () => {
    const repo = join(stage, "many");
    const tags = Array.from({ length: 200 }, (_, i) => `many-tag-${i}`);
    writeFiles(repo, {
      "package.json": JSON.stringify({ name: "many", private: true, version: "0.0.0" }),
      "scout.config.json": JSON.stringify({ repoId: "many", include: ["src/**/*.vue"] }),
      "src/App.vue": `<template>\n${tags.map((tag) => `  <${tag}></${tag}>`).join("\n")}\n</template>\n`,
    });
    commit(repo);
    // Written after the commit, so git doesn't add the installs.
    writeFiles(
      repo,
      Object.assign({}, ...tags.map((tag, i) => cemPackage(`node_modules/@example/many-${i}`, `@example/many-${i}`, [tag]))),
    );
    execFileSync("bash", ["-c", 'ulimit -n 128 && exec node "$0" scan --quiet --dry-run', CLI], {
      cwd: repo,
      stdio: "pipe",
    });
    const artifact = assertValidArtifact(JSON.parse(readFileSync(join(repo, "scout-scan.json"), "utf8")));
    expect(tags.filter((tag) => tagNamed(artifact, tag)?.attribution?.status !== "resolved")).toEqual([]);
  }, 30_000);

  it("reads an install outside the include and off the scanned code's lookup path", () => {
    const repo = join(stage, "sibling");
    writeFiles(repo, {
      "package.json": JSON.stringify({ name: "sibling-root", private: true, workspaces: ["apps/*", "packages/*"] }),
      "scout.config.json": JSON.stringify({ repoId: "sibling", include: ["apps/web/**/*.vue"] }),
      "apps/web/package.json": JSON.stringify({ name: "sibling-web", private: true, version: "0.0.0" }),
      "apps/web/src/App.vue": "<template>\n  <kit-tag></kit-tag>\n</template>\n",
      "packages/other/package.json": JSON.stringify({ name: "sibling-other", private: true, version: "0.0.0" }),
      ...cemPackage("packages/other/node_modules/@example/kit", "@example/kit", ["kit-tag"]),
    });
    commit(repo);
    const { artifact } = scan(repo);
    expect(tagNamed(artifact, "kit-tag")?.attribution).toMatchObject({
      status: "resolved",
      target: { kind: "package", packageName: "@example/kit" },
      confidence: "declared",
    });
  });

  // The consumer imports an aggregator and renders a tag only the aggregator's
  // own dependency declares, installed where the consumer cannot import it.
  const leaf = "@example/leaf";
  const aggregator = (dir: string): Record<string, string> => ({
    [`${dir}/package.json`]: JSON.stringify({
      name: "@example/agg",
      version: "1.0.0",
      main: "index.js",
      dependencies: { [leaf]: "1.0.0" },
    }),
    [`${dir}/index.js`]: `import "${leaf}";\n`,
  });
  const pnpmStore = "node_modules/.pnpm";
  it.each([
    [
      "nested in the aggregator's own node_modules",
      { ...aggregator("node_modules/@example/agg"), ...cemPackage("node_modules/@example/agg/node_modules/@example/leaf", leaf, ["leaf-button"]) },
      [],
    ],
    [
      "in pnpm's virtual store",
      {
        ...aggregator(`${pnpmStore}/@example+agg@1.0.0/node_modules/@example/agg`),
        ...cemPackage(`${pnpmStore}/@example+leaf@1.0.0/node_modules/@example/leaf`, leaf, ["leaf-button"]),
      },
      [
        ["node_modules/@example/agg", "../.pnpm/@example+agg@1.0.0/node_modules/@example/agg"],
        [`${pnpmStore}/@example+agg@1.0.0/node_modules/@example/leaf`, "../../../@example+leaf@1.0.0/node_modules/@example/leaf"],
      ],
    ],
  ])("attributes a tag declared by an aggregator's dependency installed %s", (label, files, links) => {
    const repo = join(stage, label.replaceAll(/\W+/g, "-"));
    writeFiles(repo, {
      "package.json": JSON.stringify({ name: "agg", private: true, version: "0.0.0", dependencies: { "@example/agg": "1.0.0" } }),
      "scout.config.json": JSON.stringify({ repoId: "agg", include: ["src/**/*.vue"] }),
      "src/App.vue": '<script setup>\nimport "@example/agg";\n</script>\n<template>\n  <leaf-button></leaf-button>\n</template>\n',
      ...files,
    });
    for (const [path, target] of links) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      symlinkSync(target, join(repo, path));
    }
    commit(repo);
    const { artifact } = scan(repo);
    expect(tagNamed(artifact, "leaf-button")?.attribution).toMatchObject({
      status: "resolved",
      target: { kind: "package", packageName: leaf },
      confidence: "declared",
    });
    expect(tagNamed(artifact, "leaf-button")?.version).toBe("1.0.0");
  });

  it("warns once for each package whose manifest is missing or isn't valid JSON in every install, and links its tags to nothing", () => {
    const repo = join(stage, "unreadable-manifest");
    writeFiles(repo, {
      "package.json": JSON.stringify({ name: "unreadable", private: true, version: "0.0.0" }),
      "scout.config.json": JSON.stringify({ repoId: "unreadable", include: ["src/**/*.vue"] }),
      "src/App.vue": "<template>\n  <gone-tag></gone-tag>\n  <broken-tag></broken-tag>\n  <good-tag></good-tag>\n</template>\n",
      "node_modules/@example/gone/package.json": JSON.stringify({ name: "@example/gone", version: "1.0.0", customElements: "dist/custom-elements.json" }),
      "node_modules/@example/broken/package.json": JSON.stringify({ name: "@example/broken", version: "1.0.0", customElements: "custom-elements.json" }),
      "node_modules/@example/broken/custom-elements.json": "{ not json",
      ...cemPackage("node_modules/@example/good", "@example/good", ["good-tag"]),
      "node_modules/@example/shell/node_modules/@example/good/package.json": JSON.stringify({ name: "@example/good", version: "0.9.0", customElements: "custom-elements.json" }),
    });
    commit(repo);
    const run = spawnSync("node", [CLI, "scan", "--dry-run"], { cwd: repo, encoding: "utf8" });
    expect(run.status).toBe(0);
    const lines = run.stderr.split("\n").filter((line) => line.includes("Custom Elements Manifest"));
    expect(lines).toEqual([
      expect.stringContaining("Couldn't read the Custom Elements Manifest of @example/broken (custom-elements.json isn't valid JSON), so its tags aren't linked to it."),
      expect.stringContaining("Couldn't read the Custom Elements Manifest of @example/gone (dist/custom-elements.json is missing), so its tags aren't linked to it."),
    ]);
    const artifact = assertValidArtifact(JSON.parse(readFileSync(join(repo, "scout-scan.json"), "utf8")));
    expect(tagNamed(artifact, "gone-tag")?.attribution).toEqual({ status: "unknown", reason: "absent", evidence: [] });
    expect(tagNamed(artifact, "broken-tag")?.attribution).toEqual({ status: "unknown", reason: "absent", evidence: [] });
    expect(tagNamed(artifact, "good-tag")?.attribution).toMatchObject({ status: "resolved", target: { kind: "package", packageName: "@example/good" } });
  });
});

// First-party registrations, an installed CEM that claims one of their tags,
// and a Nuxt GlobalComponents member keyed by a custom element name.
describe("integration: per-scan tag attribution from registration and CEM evidence", () => {
  let stage: string;
  let artifact: ScanArtifact;
  let text: string;

  beforeAll(() => {
    stage = mkdtempSync(join(tmpdir(), "cc-tag-attribution-"));
    writeFiles(stage, {
      "package.json": JSON.stringify({ name: "tag-attribution", private: true, version: "0.0.0" }),
      "scout.config.json": JSON.stringify({ repoId: "tag-attribution", include: ["src/**/*.{ts,tsx,vue}"] }),
      "src/card.ts": 'export class Card extends HTMLElement {}\ncustomElements.define("x-card", Card);\n',
      "src/register.ts": [
        'import { Card } from "./card";',
        'import { KitButton } from "@example/kit";',
        'customElements.define("x-card", Card);',
        'customElements.define("kit-button", KitButton);',
        "",
      ].join("\n"),
      "src/anon.ts":
        'customElements.define("x-anon", class extends HTMLElement {});\ncustomElements.define("x-idle", class extends HTMLElement {});\n',
      "src/App.vue": [
        "<template>",
        "  <x-card></x-card>",
        "  <x-badge></x-badge>",
        "  <x-nowhere></x-nowhere>",
        "  <x-anon></x-anon>",
        "  <kit-button></kit-button>",
        "</template>",
        "",
      ].join("\n"),
      "src/XPanel.vue": "<template><div></div></template>\n",
      "src/Page.tsx": "export function Page() {\n  return <x-panel></x-panel>;\n}\n",
      ".nuxt/components.d.ts": [
        "interface _GlobalComponents {",
        `  'x-panel': typeof import("../src/XPanel.vue")['default']`,
        "}",
        "declare module 'vue' {",
        "  export interface GlobalComponents extends _GlobalComponents { }",
        "}",
        "export {}",
        "",
      ].join("\n"),
      "node_modules/@example/kit/package.json": JSON.stringify({
        name: "@example/kit",
        version: "1.0.0",
        main: "index.js",
        customElements: "custom-elements.json",
      }),
      "node_modules/@example/kit/index.js": "export class KitButton extends HTMLElement {}\n",
      "node_modules/@example/kit/custom-elements.json": JSON.stringify({
        schemaVersion: "1.0.0",
        modules: [{ declarations: [{ kind: "class", customElement: true, tagName: "kit-button", name: "KitButton" }] }],
      }),
      "node_modules/@example/stale-kit/package.json": JSON.stringify({
        name: "@example/stale-kit",
        version: "2.0.0",
        customElements: "custom-elements.json",
      }),
      "node_modules/@example/stale-kit/custom-elements.json": JSON.stringify({
        schemaVersion: "1.0.0",
        modules: [
          {
            kind: "javascript-module",
            path: "index.js",
            declarations: [
              { kind: "class", customElement: true, tagName: "x-card", name: "StaleCard" },
              { kind: "class", customElement: true, tagName: "x-badge", name: "Badge" },
            ],
          },
        ],
      }),
    });
    commit(stage);
    ({ artifact, text } = scan(stage));
  });

  afterAll(() => {
    rmSync(stage, { recursive: true, force: true });
  });

  it("resolves registrations of one class to its declaration, over an installed CEM claim that contradicts it", () => {
    const repository = { kind: "repository", repoId: "tag-attribution", filePath: "src/card.ts", exportName: "Card" };
    const registration = (filePath: string, line: number) => ({
      source: "registration",
      strength: "observed",
      locator: { filePath, line },
      target: repository,
      disposition: "supports",
    });
    expect(tagNamed(artifact, "x-card")?.attribution).toEqual({
      status: "resolved",
      target: repository,
      confidence: "observed",
      evidence: [
        registration("src/card.ts", 2),
        registration("src/register.ts", 3),
        {
          source: "cem",
          strength: "declared",
          locator: { packageName: "@example/stale-kit", version: "2.0.0" },
          target: { kind: "package", packageName: "@example/stale-kit" },
          disposition: "contradicts",
        },
      ],
    });
  });

  it("attributes a registered package class to its package, which its CEM supports", () => {
    const kit = { kind: "package", packageName: "@example/kit" };
    expect(tagNamed(artifact, "kit-button")?.attribution).toEqual({
      status: "resolved",
      target: kit,
      confidence: "observed",
      evidence: [
        {
          source: "registration",
          strength: "observed",
          locator: { filePath: "src/register.ts", line: 4 },
          target: kit,
          disposition: "supports",
        },
        {
          source: "cem",
          strength: "declared",
          locator: { packageName: "@example/kit", version: "1.0.0" },
          target: kit,
          disposition: "supports",
        },
      ],
    });
  });

  it("attributes a GlobalComponents member to the SFC its import names, as the SFC's declaration is named", () => {
    const repository = { kind: "repository", repoId: "tag-attribution", filePath: "src/XPanel.vue", exportName: "XPanel" };
    expect(tagNamed(artifact, "x-panel")?.attribution).toEqual({
      status: "resolved",
      target: repository,
      confidence: "declared",
      evidence: [
        {
          source: "global-declaration",
          strength: "declared",
          locator: { filePath: ".nuxt/components.d.ts", line: 2 },
          target: repository,
          disposition: "supports",
        },
      ],
    });
  });

  it("resolves a tag only the CEM declares to its package", () => {
    expect(tagNamed(artifact, "x-badge")?.attribution).toMatchObject({
      status: "resolved",
      target: { kind: "package", packageName: "@example/stale-kit" },
      confidence: "declared",
    });
  });

  it("leaves a tag with no evidence unknown and absent", () => {
    expect(tagNamed(artifact, "x-nowhere")?.attribution).toEqual({ status: "unknown", reason: "absent", evidence: [] });
  });

  it("keeps a registration that names no class as evidence without a target", () => {
    expect(tagNamed(artifact, "x-anon")?.attribution).toEqual({
      status: "unknown",
      reason: "unresolved",
      evidence: [
        { source: "registration", strength: "observed", locator: { filePath: "src/anon.ts", line: 1 }, disposition: "unresolved" },
      ],
    });
  });

  it("drops a registered tag that nothing renders", () => {
    expect(tagNamed(artifact, "x-idle")).toBeUndefined();
  });

  it("writes no absolute or install path into the artefact", () => {
    for (const leak of ["/Users/", "/private/", "/tmp/", "node_modules/", stage]) {
      expect(text.includes(leak), leak).toBe(false);
    }
  });
});
