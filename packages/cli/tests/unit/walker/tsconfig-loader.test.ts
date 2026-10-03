import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTsconfigChain } from "../../../src/walker/tsconfig-loader.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cc-tsloader-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadTsconfigChain: JSONC parse", () => {
  it("parses strict JSON tsconfig with paths", () => {
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@x/*": ["src/x/*"] } } }),
    );
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targets).toEqual(["src/x/*"]);
    expect(entries[0]?.base).toBe(root);
  });

  it("parses JSONC tsconfig with line comments and trailing commas", () => {
    writeFileSync(
      join(root, "tsconfig.json"),
      `{
        // Comment above
        "compilerOptions": {
          "paths": {
            "@x/*": ["src/x/*"], // trailing comma below
          },
        },
      }`,
    );
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targets).toEqual(["src/x/*"]);
  });

  it("returns empty entries + warning when file is missing", () => {
    const { entries, warnings } = loadTsconfigChain(join(root, "does-not-exist.json"), root);
    expect(entries).toEqual([]);
    expect(warnings).toEqual([
      'does-not-exist.json doesn\'t exist, so its path aliases aren\'t followed. Check "tsconfigPath" in scout.config.json and scan again.',
    ]);
  });

  it("returns empty entries + warning when the file can't be read", () => {
    mkdirSync(join(root, "tsconfig.json"));
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"), root);
    expect(entries).toEqual([]);
    expect(warnings).toEqual([
      "Couldn't read tsconfig.json, so its path aliases aren't followed. Check that it's a readable file and scan again.",
    ]);
  });

  it("returns empty entries + warning when file is malformed beyond JSONC repair", () => {
    writeFileSync(join(root, "tsconfig.json"), "{ this is not json at all ");
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"), root);
    expect(entries).toEqual([]);
    expect(warnings).toEqual([
      "tsconfig.json has JSON syntax errors, so some of its path aliases may be missing. Fix them and scan again.",
    ]);
  });

  it("returns empty entries + warning when the file isn't a JSON object", () => {
    writeFileSync(join(root, "tsconfig.json"), "42");
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"), root);
    expect(entries).toEqual([]);
    expect(warnings).toEqual(["tsconfig.json isn't a JSON object, so its path aliases aren't followed. Fix it and scan again."]);
  });

  it("returns empty entries when paths is absent", () => {
    writeFileSync(join(root, "tsconfig.json"), `{ "compilerOptions": {} }`);
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(entries).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("anchors paths to baseUrl when defined", () => {
    mkdirSync(join(root, "nested"), { recursive: true });
    writeFileSync(
      join(root, "nested/tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: "..", paths: { "@x/*": ["src/x/*"] } },
      }),
    );
    const { entries } = loadTsconfigChain(join(root, "nested/tsconfig.json"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.base).toBe(root);
  });

  it("compiles glob aliases into anchored regex", () => {
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { paths: { "@x/*": ["src/x/*"], "@y": ["src/y.ts"] } },
      }),
    );
    const { entries } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(entries).toHaveLength(2);
    const wildcard = entries.find((e) => e.targets[0] === "src/x/*");
    const exact = entries.find((e) => e.targets[0] === "src/y.ts");
    expect(wildcard?.pattern.test("@x/anything")).toBe(true);
    expect(wildcard?.pattern.exec("@x/Foo")?.[1]).toBe("Foo");
    expect(exact?.pattern.test("@y")).toBe(true);
    expect(exact?.pattern.test("@y/extra")).toBe(false);
  });
});

describe("loadTsconfigChain: extends", () => {
  it("inherits paths from a single-string extends parent when child has none", () => {
    writeFileSync(
      join(root, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { paths: { "@base/*": ["src/base/*"] } } }),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json" }),
    );
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targets).toEqual(["src/base/*"]);
    expect(entries[0]?.base).toBe(root);
  });

  it("child's paths replace parent's paths entirely (TS replace semantics)", () => {
    writeFileSync(
      join(root, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: { paths: { "@base/*": ["src/base/*"], "@shared/*": ["src/shared/*"] } },
      }),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: { paths: { "@child/*": ["src/child/*"] } },
      }),
    );
    const { entries } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targets).toEqual(["src/child/*"]);
  });

  it("extends as array applies in order, later overrides earlier", () => {
    writeFileSync(
      join(root, "a.json"),
      JSON.stringify({ compilerOptions: { paths: { "@x/*": ["from-a/*"] } } }),
    );
    writeFileSync(
      join(root, "b.json"),
      JSON.stringify({ compilerOptions: { paths: { "@x/*": ["from-b/*"] } } }),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: ["./a.json", "./b.json"] }),
    );
    const { entries } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targets).toEqual(["from-b/*"]);
  });

  it("breaks extends cycles cleanly with a warning", () => {
    writeFileSync(
      join(root, "a.json"),
      JSON.stringify({ extends: "./b.json", compilerOptions: { paths: { "@a/*": ["src/a/*"] } } }),
    );
    writeFileSync(
      join(root, "b.json"),
      JSON.stringify({ extends: "./a.json" }),
    );
    const { entries, warnings } = loadTsconfigChain(join(root, "a.json"), root);
    expect(warnings).toEqual([
      'b.json extends a.json, which loops back to it, so path aliases past it aren\'t followed. Fix "extends" in b.json and scan again.',
    ]);
    // Whatever resolved before the cycle hit should still be present.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targets).toEqual(["src/a/*"]);
  });

  it("skips a missing extends target with a warning, continues with the rest", () => {
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        extends: ["./does-not-exist.json", "./present.json"],
      }),
    );
    writeFileSync(
      join(root, "present.json"),
      JSON.stringify({ compilerOptions: { paths: { "@x/*": ["src/x/*"] } } }),
    );
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"), root);
    expect(warnings).toEqual([
      "tsconfig.json points to does-not-exist.json, which doesn't exist, so its path aliases aren't followed. Fix the path and scan again.",
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targets).toEqual(["src/x/*"]);
  });

  it("suggests nuxt prepare when the missing extends target is in a .nuxt folder", () => {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: "./.nuxt/tsconfig.json" }));
    const { warnings } = loadTsconfigChain(join(root, "tsconfig.json"), root);
    expect(warnings).toEqual([
      "tsconfig.json points to .nuxt/tsconfig.json, which doesn't exist, so its path aliases aren't followed. Fix the path, or for Nuxt run npx nuxt prepare, and scan again.",
    ]);
  });

  it("warns when an extends package isn't installed", () => {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: "@cc-test/not-installed/tsconfig.json" }));
    const { warnings } = loadTsconfigChain(join(root, "tsconfig.json"), root);
    expect(warnings).toEqual([
      'tsconfig.json extends "@cc-test/not-installed/tsconfig.json", which isn\'t installed, so its path aliases aren\'t followed. Install your dependencies and scan again.',
    ]);
  });

  it("anchors inherited paths to the parent's baseUrl, not the leaf's", () => {
    mkdirSync(join(root, "shared"), { recursive: true });
    writeFileSync(
      join(root, "shared/base.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@x/*": ["src/x/*"] } },
      }),
    );
    mkdirSync(join(root, "app"), { recursive: true });
    writeFileSync(
      join(root, "app/tsconfig.json"),
      JSON.stringify({ extends: "../shared/base.json" }),
    );
    const { entries } = loadTsconfigChain(join(root, "app/tsconfig.json"));
    expect(entries).toHaveLength(1);
    // base must be the parent's dir (shared/), not the leaf's (app/).
    expect(entries[0]?.base).toBe(join(root, "shared"));
  });

  it("exposes the nearest baseUrl directory in the chain, with or without paths", () => {
    mkdirSync(join(root, "shared"), { recursive: true });
    writeFileSync(join(root, "shared/base.json"), JSON.stringify({ compilerOptions: { baseUrl: "./src" } }));
    mkdirSync(join(root, "app"), { recursive: true });
    writeFileSync(join(root, "app/inherits.json"), JSON.stringify({ extends: "../shared/base.json" }));
    writeFileSync(
      join(root, "app/overrides.json"),
      JSON.stringify({ extends: "../shared/base.json", compilerOptions: { baseUrl: "." } }),
    );
    writeFileSync(
      join(root, "app/unset.json"),
      JSON.stringify({ compilerOptions: { paths: { "@x/*": ["src/x/*"] } } }),
    );

    expect(loadTsconfigChain(join(root, "app/inherits.json")).baseUrlDir).toBe(join(root, "shared/src"));
    expect(loadTsconfigChain(join(root, "app/overrides.json")).baseUrlDir).toBe(join(root, "app"));
    expect(loadTsconfigChain(join(root, "app/unset.json")).baseUrlDir).toBeUndefined();
  });

  it("resolves bare-package extends via Node module resolution", () => {
    // Simulate a published shared config under node_modules.
    const pkgDir = join(root, "node_modules", "@cc-test", "shared-config");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@cc-test/shared-config", main: "tsconfig.json" }),
    );
    writeFileSync(
      join(pkgDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@pkg/*": ["src/pkg/*"] } } }),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: "@cc-test/shared-config/tsconfig.json" }),
    );
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(warnings).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targets).toEqual(["src/pkg/*"]);
    expect(entries[0]?.base).toBe(pkgDir);
  });
});

describe("loadTsconfigChain: references", () => {
  const aliases = (entries: ReturnType<typeof loadTsconfigChain>["entries"]) =>
    entries.map((e) => ({ pattern: e.pattern.source, targets: e.targets, base: e.base }));

  it("takes a solution-style tsconfig's aliases from the projects it references, the first to declare a pattern winning it", () => {
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }));
    writeFileSync(
      join(root, "tsconfig.node.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["other/*"], "#build/*": ["build/*"] } } }),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ files: [], references: [{ path: "./app" }, { path: "./tsconfig.node.json" }] }),
    );
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(warnings).toEqual([]);
    expect(aliases(entries)).toEqual([
      { pattern: "^@\\/(.*)$", targets: ["src/*"], base: join(root, "app") },
      { pattern: "^#build\\/(.*)$", targets: ["build/*"], base: root },
    ]);
  });

  it("skips a referenced project that doesn't exist, without a warning", () => {
    writeFileSync(join(root, "tsconfig.app.json"), JSON.stringify({ compilerOptions: { paths: { "~/*": ["app/*"] } } }));
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ files: [], references: [{ path: "./.nuxt/tsconfig.server.json" }, { path: "./tsconfig.app.json" }] }),
    );
    const { entries, warnings } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(warnings).toEqual([]);
    expect(aliases(entries)).toEqual([{ pattern: "^~\\/(.*)$", targets: ["app/*"], base: root }]);
  });

  it("keeps the aliases of a tsconfig that includes files of its own, not those of the projects it references", () => {
    writeFileSync(join(root, "tsconfig.lib.json"), JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["lib/*"] } } }));
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ include: ["src"], compilerOptions: { paths: { "@/*": ["src/*"] } }, references: [{ path: "./tsconfig.lib.json" }] }),
    );
    const { entries } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(aliases(entries)).toEqual([{ pattern: "^@\\/(.*)$", targets: ["src/*"], base: root }]);
  });
});

describe("loadTsconfigChain: a solution-style tsconfig's own options", () => {
  const aliases = (entries: ReturnType<typeof loadTsconfigChain>["entries"]) =>
    entries.map((e) => ({ pattern: e.pattern.source, targets: e.targets, base: e.base }));

  it("falls back to the aliases and baseUrl the tsconfig and its extends chain declare", () => {
    writeFileSync(join(root, "tsconfig.base.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }));
    writeFileSync(join(root, "tsconfig.app.json"), JSON.stringify({ include: ["src"], compilerOptions: { strict: true } }));
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json", files: [], references: [{ path: "./tsconfig.app.json" }] }),
    );
    const { entries, baseUrlDir, warnings } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(warnings).toEqual([]);
    expect(aliases(entries)).toEqual([{ pattern: "^@\\/(.*)$", targets: ["./src/*"], base: root }]);
    expect(baseUrlDir).toBe(root);
  });

  it("gives a pattern both declare to the referenced project", () => {
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }));
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ files: [], references: [{ path: "./app" }], compilerOptions: { paths: { "@/*": ["legacy/*"] } } }),
    );
    const { entries } = loadTsconfigChain(join(root, "tsconfig.json"));
    expect(aliases(entries)).toEqual([{ pattern: "^@\\/(.*)$", targets: ["src/*"], base: join(root, "app") }]);
  });
});
