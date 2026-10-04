import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { assertValidArtifact } from "../helpers/artifact.js";

const exec = promisify(execFile);
const monorepoRoot = resolve(import.meta.dirname, "../../../..");
const cli = resolve(monorepoRoot, "packages/cli/dist/cli.js");

/**
 * The generated declaration exactly as Nuxt emits it: members in a sibling
 * interface, reached from the augmentation through `extends`. `prefix` is the
 * `../` run that walks back to the app root from the declaration's own
 * directory, which differs between the two layouts below.
 */
function componentsDeclaration(prefix: string): string {
  return [
    "import type { DefineComponent, SlotsType } from 'vue'",
    "interface _GlobalComponents {",
    `  FooCard: typeof import("${prefix}app/components/FooCard.vue")['default']`,
    `  GhostCard: typeof import("${prefix}app/components/GhostCard.vue")['default']`,
    "}",
    "",
    "declare module 'vue' {",
    "  export interface GlobalComponents extends _GlobalComponents { }",
    "}",
    "",
    "export {}",
    "",
  ].join("\n");
}

/**
 * The two shapes Nuxt ships. Nuxt 3 puts the augmentation and the `export
 * const` list in one file; Nuxt 4 leaves only the `export const` list at
 * `.nuxt/components.d.ts` and moves the augmentation into `.nuxt/types/`.
 * Both must resolve, and each declaration's relative paths must resolve
 * against its own directory.
 */
const LAYOUTS = [
  {
    name: "nuxt 3 (augmentation in .nuxt/components.d.ts)",
    files: { ".nuxt/components.d.ts": componentsDeclaration("../") },
  },
  {
    name: "nuxt 4 (augmentation split into .nuxt/types/components.d.ts)",
    files: {
      ".nuxt/components.d.ts": `export const FooCard: typeof import("../app/components/FooCard.vue")['default']\n`,
      ".nuxt/types/components.d.ts": componentsDeclaration("../../"),
    },
  },
] as const;

// Nuxt auto-imported Vue components:
//   - FooCard is used in app/pages/index.vue with no script import; it is
//     resolved via the generated `GlobalComponents` declaration to a
//     repository declaration, exactly as an explicit import would produce.
//   - GhostCard is a registry entry whose target file doesn't exist: it
//     surfaces as an `auto-import-stale-entry` diagnostic (never an identity).
//   - MysteryWidget has no script import, no registry entry, and no tag
//     registration: it surfaces as an unresolved `unbound-name` occurrence.
/** Writes the Nuxt app described above into `dir`, with the generated declaration `files`. */
async function writeNuxtApp(dir: string, files: Record<string, string>): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture-nuxt-app", private: true, dependencies: { nuxt: "^4.0.0" } }),
  );
  await writeFile(
    join(dir, "scout.config.json"),
    JSON.stringify({ include: ["app/**/*.vue"], repoId: "fixture/nuxt-app" }),
  );
  await mkdir(join(dir, "app", "components"), { recursive: true });
  await mkdir(join(dir, "app", "pages"), { recursive: true });
  await mkdir(join(dir, ".nuxt", "types"), { recursive: true });
  await writeFile(
    join(dir, "app", "components", "FooCard.vue"),
    "<template><div>foo</div></template>\n",
  );
  await writeFile(
    join(dir, "app", "pages", "index.vue"),
    "<template><main><FooCard title=\"hi\" /><MysteryWidget /></main></template>\n",
  );
  for (const [relPath, source] of Object.entries(files)) {
    await writeFile(join(dir, relPath), source);
  }
}

async function commitAll(dir: string): Promise<void> {
  await exec("git", ["init", "-q"], { cwd: dir });
  await exec("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "T"], { cwd: dir });
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

describe.each(LAYOUTS)("nuxt auto-import integration: $name", ({ files }) => {
  let stagingDir = "";

  beforeAll(async () => {
    stagingDir = await mkdtemp(join(tmpdir(), "cc-nuxt-auto-"));
    await writeNuxtApp(stagingDir, files);
    await commitAll(stagingDir);
  }, 30_000);

  afterAll(async () => {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
  });

  it("resolves auto-imported components to local identities and reports stale + unresolved tags", async () => {
    await exec("node", [cli, "scan", "--dry-run", "--quiet"], { cwd: stagingDir });
    const out = assertValidArtifact(JSON.parse(await readFile(join(stagingDir, "scout-scan.json"), "utf8")));

    const foo = out.components.find(
      (c) => c.framework === "vue" && c.identity.kind !== "tag" && c.identity.exportName === "FooCard",
    );
    expect(foo, "FooCard Vue repository declaration must surface via auto-import").toBeTruthy();
    expect(foo?.identity).toMatchObject({ kind: "repository-declaration", filePath: "app/components/FooCard.vue" });

    // The GlobalComponents reader resolves in-repo entries to an absolute
    // specifier. The artefact rebases trace specifiers to repo-relative POSIX,
    // like every other filePath, so that machine-local path never leaks.
    const fooOccurrence = out.occurrences.find((o) => o.resolution.componentId === foo?.id);
    expect(fooOccurrence, "FooCard occurrence must be present").toBeTruthy();
    const imports = fooOccurrence?.trace.filter((t) => t.kind === "import") ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ specifier: "app/components/FooCard.vue" });

    const staleDiagnostic = out.diagnostics.find((d) => d.code === "auto-import-stale-entry");
    expect(
      staleDiagnostic,
      "auto-import-stale-entry diagnostic must appear for GhostCard's dead target",
    ).toBeTruthy();
    // Target must be repo-relative, not the
    // absolute path the manifest reader resolved internally.
    expect((staleDiagnostic as { target?: string } | undefined)?.target).toBe(
      "app/components/GhostCard.vue",
    );
    expect(
      out.occurrences.filter((o) => o.resolution.status === "unresolved").map((o) => [o.resolution, o.filePath]),
      "MysteryWidget must surface as an unresolved occurrence",
    ).toEqual([
      [{ status: "unresolved", reason: { kind: "unbound-name", name: "MysteryWidget" } }, "app/pages/index.vue"],
    ]);
  }, 30_000);
});

describe("nuxt auto-import integration: missing declarations", () => {
  it.each([[["--quiet"]], [[]]])("warns once when nuxt is a dependency but no manifest exists (flags %j)", async (flags) => {
    const bare = await mkdtemp(join(tmpdir(), "cc-nuxt-missing-"));
    try {
      await writeFile(
        join(bare, "package.json"),
        JSON.stringify({ name: "fixture-bare", private: true, dependencies: { nuxt: "^4.0.0" } }),
      );
      await writeFile(
        join(bare, "scout.config.json"),
        JSON.stringify({ include: ["app/**/*.vue"], repoId: "fixture/bare" }),
      );
      await mkdir(join(bare, "app"), { recursive: true });
      await writeFile(join(bare, "app", "index.vue"), "<template><div/></template>\n");
      await exec("git", ["init", "-q"], { cwd: bare });
      await exec("git", ["config", "user.email", "t@example.com"], { cwd: bare });
      await exec("git", ["config", "user.name", "T"], { cwd: bare });
      await exec("git", ["add", "-A"], { cwd: bare });
      await exec("git", ["commit", "-q", "-m", "init"], { cwd: bare });

      const { stderr } = await exec("node", [cli, "scan", "--dry-run", ...flags], { cwd: bare });
      const warning = "Warning: This Nuxt app hasn't been prepared, so auto-imported components aren't counted. Run npx nuxt prepare and scan again.";
      expect(stderr.split("\n").filter((line) => line === warning)).toHaveLength(1);

      const out = assertValidArtifact(JSON.parse(await readFile(join(bare, "scout-scan.json"), "utf8")));
      expect(out.diagnostics.find((d) => d.code === "auto-import-manifest-missing")).toMatchObject({
        detail: "This Nuxt app hasn't been prepared, so auto-imported components aren't counted. Run npx nuxt prepare and scan again.",
      });
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  }, 30_000);
});

it("names a stale entry's target from the repository root when the app is in a folder below it", async () => {
  const root = await mkdtemp(join(tmpdir(), "cc-nuxt-below-root-"));
  try {
    await mkdir(join(root, "web"));
    await writeNuxtApp(join(root, "web"), LAYOUTS[0].files);
    await commitAll(root);
    await exec("node", [cli, "scan", "--dry-run", "--quiet"], { cwd: join(root, "web") });
    const out = assertValidArtifact(JSON.parse(await readFile(join(root, "web", "scout-scan.json"), "utf8")));
    expect(out.diagnostics).toContainEqual(
      expect.objectContaining({ code: "auto-import-stale-entry", filePath: "web/.nuxt/components.d.ts", target: "web/app/components/GhostCard.vue" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
