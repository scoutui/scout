import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImportResolver } from "../../../src/walker/resolve-import.js";

let root: string;
beforeEach(() => {
  // realpath: macOS tmpdir symlinks (/var → /private/var) trip up identity comparisons
  // against `require.resolve` output, which always returns the realpath.
  root = realpathSync(mkdtempSync(join(tmpdir(), "cc-resolve-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createImportResolver", () => {
  it("resolves config aliases", () => {
    mkdirSync(join(root, "src/components"), { recursive: true });
    writeFileSync(join(root, "src/components/Button.tsx"), "");
    const resolve = createImportResolver({
      repoRoot: root,
      aliases: { "@components/*": ["src/components/*"] },
    });
    expect(resolve(join(root, "src/app.tsx"), "@components/Button")).toBe(
      join(root, "src/components/Button.tsx"),
    );
  });

  it("matches a multi-segment path against an alias glob", () => {
    mkdirSync(join(root, "src/components/foo"), { recursive: true });
    writeFileSync(join(root, "src/components/foo/Button.tsx"), "");
    const resolve = createImportResolver({
      repoRoot: root,
      aliases: { "@components/*": ["src/components/*"] },
    });
    expect(resolve(join(root, "src/app.tsx"), "@components/foo/Button")).toBe(
      join(root, "src/components/foo/Button.tsx"),
    );
  });

  it("falls through an alias's targets to the first that exists", () => {
    mkdirSync(join(root, "src/new"), { recursive: true });
    writeFileSync(join(root, "src/new/Button.tsx"), "");
    const resolve = createImportResolver({
      repoRoot: root,
      aliases: { "@components/*": ["src/old/*", "src/new/*"] },
    });
    expect(resolve(join(root, "src/app.tsx"), "@components/Button")).toBe(
      join(root, "src/new/Button.tsx"),
    );
  });

  it("reads tsconfig paths", () => {
    mkdirSync(join(root, "src/utils"), { recursive: true });
    writeFileSync(join(root, "src/utils/index.ts"), "");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@utils/*": ["src/utils/*"] } } }),
    );
    const resolve = createImportResolver({
      repoRoot: root,
      tsconfigPath: join(root, "tsconfig.json"),
    });
    expect(resolve(join(root, "src/app.ts"), "@utils/index")).toBe(
      join(root, "src/utils/index.ts"),
    );
  });

  it("resolves tsconfig paths against its baseUrl", () => {
    mkdirSync(join(root, "nested/src/utils"), { recursive: true });
    writeFileSync(join(root, "nested/src/utils/x.ts"), "");
    writeFileSync(
      join(root, "nested/tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@utils/*": ["src/utils/*"] } },
      }),
    );
    const resolve = createImportResolver({
      repoRoot: root,
      tsconfigPath: join(root, "nested/tsconfig.json"),
    });
    expect(resolve(join(root, "nested/src/app.ts"), "@utils/x")).toBe(
      join(root, "nested/src/utils/x.ts"),
    );
  });

  it("falls back to Node module resolution", () => {
    const pkgDir = join(root, "node_modules/@example/ds");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@example/ds", main: "index.js" }),
    );
    writeFileSync(join(pkgDir, "index.js"), "module.exports = {};");
    const resolve = createImportResolver({ repoRoot: root });
    const result = resolve(join(root, "app.js"), "@example/ds");
    expect(result).toBe(join(pkgDir, "index.js"));
  });

  it("config aliases take priority over tsconfig paths", () => {
    mkdirSync(join(root, "src/from-config"), { recursive: true });
    mkdirSync(join(root, "src/from-tsconfig"), { recursive: true });
    writeFileSync(join(root, "src/from-config/x.ts"), "");
    writeFileSync(join(root, "src/from-tsconfig/x.ts"), "");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { paths: { "@x/*": ["src/from-tsconfig/*"] } },
      }),
    );
    const resolve = createImportResolver({
      repoRoot: root,
      aliases: { "@x/*": ["src/from-config/*"] },
      tsconfigPath: join(root, "tsconfig.json"),
    });
    expect(resolve(join(root, "src/app.ts"), "@x/x")).toBe(
      join(root, "src/from-config/x.ts"),
    );
  });

  it("returns null when nothing matches", () => {
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "app.ts"), "totally-not-a-thing")).toBeNull();
  });

  it("tries each file extension for an aliased path", () => {
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(join(root, "src/lib/Thing.ts"), "");
    const resolve = createImportResolver({
      repoRoot: root,
      aliases: { "@lib/*": ["src/lib/*"] },
    });
    expect(resolve(join(root, "src/app.ts"), "@lib/Thing")).toBe(
      join(root, "src/lib/Thing.ts"),
    );
  });

  it("resolves a relative directory import to its index.jsx", () => {
    // Node's require.resolve only auto-resolves index.{js,json,node}, so the
    // resolver probes for index.jsx / index.tsx itself.
    mkdirSync(join(root, "src/modals/learn-more"), { recursive: true });
    writeFileSync(join(root, "src/modals/learn-more/index.jsx"), "");
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/modals/modals.jsx"), "./learn-more")).toBe(
      join(root, "src/modals/learn-more/index.jsx"),
    );
  });

  it("resolves a relative directory import to its index.tsx", () => {
    mkdirSync(join(root, "src/pages/home"), { recursive: true });
    writeFileSync(join(root, "src/pages/home/index.tsx"), "");
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/app.tsx"), "./pages/home")).toBe(
      join(root, "src/pages/home/index.tsx"),
    );
  });

  it("folder-with-basename: relative import `./avatar` → `./avatar/avatar.tsx`", () => {
    // Next.js folder convention: a folder containing a file with the same
    // name as the folder. Node's resolver doesn't try this, so the resolver
    // probes for it.
    mkdirSync(join(root, "src/components/avatar"), { recursive: true });
    writeFileSync(join(root, "src/components/avatar/avatar.tsx"), "");
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/app.tsx"), "./components/avatar")).toBe(
      join(root, "src/components/avatar/avatar.tsx"),
    );
  });

  it("folder-with-basename via alias: `@components/avatar` → `<root>/components/avatar/avatar.tsx`", () => {
    // tryFileWithExtensions reaches the same probe via the alias branch.
    mkdirSync(join(root, "components/avatar"), { recursive: true });
    writeFileSync(join(root, "components/avatar/avatar.jsx"), "");
    const resolve = createImportResolver({
      repoRoot: root,
      aliases: { "@components/*": ["components/*"] },
    });
    expect(resolve(join(root, "src/app.tsx"), "@components/avatar")).toBe(
      join(root, "components/avatar/avatar.jsx"),
    );
  });

  it("folder-with-basename only applies to relative specs, not bare packages", () => {
    // Bare packages have a `main` field, so the folder-basename convention
    // doesn't reach into a package's internal folders.
    mkdirSync(join(root, "node_modules/some-pkg/widget"), { recursive: true });
    writeFileSync(join(root, "node_modules/some-pkg/widget/widget.js"), "");
    // No package.json#main pointing at widget: bare specifier resolution
    // fails rather than landing on the basename file.
    writeFileSync(
      join(root, "node_modules/some-pkg/package.json"),
      JSON.stringify({ name: "some-pkg" }),
    );
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "app.ts"), "some-pkg/widget")).toBeNull();
  });

  it("returns null when folder exists but basename file doesn't", () => {
    // File-existence guard: the probe doesn't fabricate matches.
    mkdirSync(join(root, "src/components/empty"), { recursive: true });
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/app.tsx"), "./components/empty")).toBeNull();
  });

  it("resolves a workspace package through a constant exports entry", () => {
    mkdirSync(join(root, "packages/icons"), { recursive: true });
    writeFileSync(join(root, "packages/icons/types.ts"), "");
    const resolve = createImportResolver({
      repoRoot: root,
      workspaceGraph: {
        packageManager: "yarn",
        rootPath: root,
        rootPackageName: "test",
        packages: [
          {
            name: "@example/icons",
            absolutePath: join(root, "packages/icons"),
            packageJson: { name: "@example/icons", exports: { "./types": "./types.ts" } },
          },
        ],
      },
    });
    expect(resolve(join(root, "src/app.tsx"), "@example/icons/types")).toBe(
      join(root, "packages/icons/types.ts"),
    );
  });

  it("resolves a workspace package through a single-wildcard exports pattern", () => {
    mkdirSync(join(root, "packages/icons/icons"), { recursive: true });
    writeFileSync(join(root, "packages/icons/icons/IcDemo.tsx"), "");
    const resolve = createImportResolver({
      repoRoot: root,
      workspaceGraph: {
        packageManager: "yarn",
        rootPath: root,
        rootPackageName: "test",
        packages: [
          {
            name: "@example/icons",
            absolutePath: join(root, "packages/icons"),
            packageJson: { name: "@example/icons", exports: { "./icons/*": "./icons/*.tsx" } },
          },
        ],
      },
    });
    expect(resolve(join(root, "src/app.tsx"), "@example/icons/icons/IcDemo")).toBe(
      join(root, "packages/icons/icons/IcDemo.tsx"),
    );
  });

  it("tsconfig paths win over workspace exports for the same specifier", () => {
    mkdirSync(join(root, "packages/icons/icons"), { recursive: true });
    mkdirSync(join(root, "via-tsconfig"), { recursive: true });
    writeFileSync(join(root, "packages/icons/icons/IcDemo.tsx"), "");
    writeFileSync(join(root, "via-tsconfig/IcDemo.tsx"), "");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          paths: { "@example/icons/icons/*": ["via-tsconfig/*"] },
        },
      }),
    );
    const resolve = createImportResolver({
      repoRoot: root,
      tsconfigPath: join(root, "tsconfig.json"),
      workspaceGraph: {
        packageManager: "yarn",
        rootPath: root,
        rootPackageName: "test",
        packages: [
          {
            name: "@example/icons",
            absolutePath: join(root, "packages/icons"),
            packageJson: { name: "@example/icons", exports: { "./icons/*": "./icons/*.tsx" } },
          },
        ],
      },
    });
    expect(resolve(join(root, "src/app.tsx"), "@example/icons/icons/IcDemo")).toBe(
      join(root, "via-tsconfig/IcDemo.tsx"),
    );
  });

  it("returns null for a workspace package with no exports field and no install", () => {
    mkdirSync(join(root, "packages/empty"), { recursive: true });
    const resolve = createImportResolver({
      repoRoot: root,
      workspaceGraph: {
        packageManager: "yarn",
        rootPath: root,
        rootPackageName: "test",
        packages: [
          {
            name: "@example/empty",
            absolutePath: join(root, "packages/empty"),
            packageJson: { name: "@example/empty" },
          },
        ],
      },
    });
    // No exports entry + no node_modules symlink → resolver returns null.
    expect(resolve(join(root, "src/app.tsx"), "@example/empty/foo")).toBe(null);
  });
});

describe("createImportResolver: JSONC + extends integration", () => {
  it("resolves an alias declared in a JSONC tsconfig (line comment + trailing comma)", () => {
    mkdirSync(join(root, "src/utils"), { recursive: true });
    writeFileSync(join(root, "src/utils/index.ts"), "");
    writeFileSync(
      join(root, "tsconfig.json"),
      `{
        // JSONC: comment + trailing comma
        "compilerOptions": {
          "paths": {
            "@utils/*": ["src/utils/*"],
          },
        },
      }`,
    );
    const resolve = createImportResolver({
      repoRoot: root,
      tsconfigPath: join(root, "tsconfig.json"),
    });
    expect(resolve(join(root, "src/app.ts"), "@utils/index")).toBe(
      join(root, "src/utils/index.ts"),
    );
  });

  it("resolves an alias inherited via extends from tsconfig.base.json", () => {
    mkdirSync(join(root, "src/utils"), { recursive: true });
    writeFileSync(join(root, "src/utils/index.ts"), "");
    writeFileSync(
      join(root, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { paths: { "@utils/*": ["src/utils/*"] } } }),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json" }),
    );
    const resolve = createImportResolver({
      repoRoot: root,
      tsconfigPath: join(root, "tsconfig.json"),
    });
    expect(resolve(join(root, "src/app.ts"), "@utils/index")).toBe(
      join(root, "src/utils/index.ts"),
    );
  });

  it("surfaces loader warnings via the optional onWarning callback", () => {
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./missing.json" }),
    );
    const warnings: string[] = [];
    createImportResolver({
      repoRoot: root,
      tsconfigPath: join(root, "tsconfig.json"),
      onWarning: (msg) => warnings.push(msg),
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/missing\.json/);
  });
});
