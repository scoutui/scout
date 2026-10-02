import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLazyResolver } from "../../../src/barrels/lazy-resolver.js";
import { createImportResolver } from "../../../src/walker/resolve-import.js";
import { createDiagnosticCollector } from "../../../src/diagnostic.js";

let tmp: string;

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "cc-lazy-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writePkg(repoRoot: string, name: string, files: Record<string, string>, pkgJsonOverrides: Record<string, unknown> = {}) {
  const pkgDir = join(repoRoot, "node_modules", ...name.split("/"));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", ...pkgJsonOverrides }),
  );
  for (const [rel, content] of Object.entries(files)) {
    const fp = join(pkgDir, rel);
    mkdirSync(join(fp, ".."), { recursive: true });
    writeFileSync(fp, content);
  }
}

describe("createLazyResolver: single leaf package", () => {
  it("credits the package whose entry declares the requested export", () => {
    writePkg(tmp, "@example/button-kit", {
      "index.js": "export class Button {}",
    }, { main: "index.js" });

    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(join(tmp, "src", "x.ts"), "@example/button-kit", "Button");
    expect(hit).toMatchObject({ leafPackage: "@example/button-kit" });
  });

  it("resolves a direct import to the leaf identity", () => {
    writePkg(tmp, "@example/leaf", {
      "index.js": `class XBtn extends HTMLElement {} customElements.define("x-btn", XBtn);`,
    }, { main: "index.js" });

    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(
      join(tmp, "src", "App.tsx"),
      "@example/leaf",
      "XBtn",
    );

    expect(hit).toMatchObject({ leafPackage: "@example/leaf" });
  });

  it("returns null when the specifier cannot be resolved", () => {
    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(
      join(tmp, "src", "App.tsx"),
      "@nonexistent/pkg",
      "Foo",
    );

    expect(hit).toBeNull();
  });
});

describe("createLazyResolver: lookupExternalLeaf public entry", () => {
  it("slices an npm-alias entry against the alias it was imported by, not the package's own name", () => {
    // `"my-icons": "npm:@real/icons"` installs @real/icons under node_modules/my-icons.
    const aliasDir = join(tmp, "node_modules", "my-icons");
    mkdirSync(aliasDir, { recursive: true });
    writeFileSync(
      join(aliasDir, "package.json"),
      JSON.stringify({ name: "@real/icons", version: "1.0.0", exports: { "./Add": "./Add.js" } }),
    );
    writeFileSync(join(aliasDir, "Add.js"), "export default function Add() {}");
    writePkg(tmp, "@example/agg", { "index.js": `export { default as Add } from "my-icons/Add";` }, { main: "index.js" });

    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });
    const from = join(tmp, "src", "App.tsx");

    expect(resolver.lookupExternalLeaf(from, "my-icons/Add", "default")).toEqual({
      leafPackage: "@real/icons",
      publicEntry: "Add",
      exportName: "default",
    });
    expect(resolver.lookupExternalLeaf(from, "@example/agg", "Add")).toEqual({
      leafPackage: "@real/icons",
      publicEntry: "Add",
      exportName: "default",
    });
  });
});

describe("createLazyResolver: multi-hop re-export chain", () => {
  it("follows export * from aggregator through to leaf", () => {
    writePkg(tmp, "@example/leaf", {
      "react.js": "export class XBtn {}",
    }, {
      exports: { "./react.js": "./react.js", "./react": "./react.js" },
    });
    writePkg(tmp, "@example/aggregator", {
      "react/btn.js": `export * from "@example/leaf/react.js";`,
    }, {
      exports: { "./react/btn.js": "./react/btn.js", "./react/btn": "./react/btn.js" },
    });

    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(
      join(tmp, "src", "App.tsx"),
      "@example/aggregator/react/btn",
      "XBtn",
    );

    expect(hit).toMatchObject({ leafPackage: "@example/leaf" });
  });

  it("follows named re-export with rename", () => {
    writePkg(tmp, "@example/leaf", {
      "index.js": "export class InternalBtn {}",
    }, { main: "index.js" });
    writePkg(tmp, "@example/agg", {
      "index.js": `export { InternalBtn as XBtn } from "@example/leaf";`,
    }, { main: "index.js" });

    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(join(tmp, "src", "App.tsx"), "@example/agg", "XBtn");

    expect(hit).toMatchObject({ leafPackage: "@example/leaf", exportName: "InternalBtn" });
  });
});

describe("createLazyResolver: failure modes", () => {
  it("skips an `export *` back into a module the walk has already visited", () => {
    writePkg(tmp, "@example/a", { "index.js": `export * from "@example/b";\nexport * from "@example/c";` }, { main: "index.js" });
    writePkg(tmp, "@example/b", { "index.js": `export * from "@example/a";\nexport * from "@example/c";` }, { main: "index.js" });
    writePkg(tmp, "@example/c", { "index.js": "export const X = 1;" }, { main: "index.js" });
    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    expect(resolver.lookupExternalLeaf(join(tmp, "src", "x.ts"), "@example/a", "X")).toMatchObject({
      leafPackage: "@example/c",
    });
    expect(resolver.diagnostics()).toEqual([]);
  });

  it("credits the package itself when its entry file has no ES exports to follow", () => {
    writePkg(tmp, "@example/bundled", {
      "dist/index.min.js": "var x=1;module.exports={};",
    }, { main: "dist/index.min.js" });

    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(join(tmp, "src", "x.ts"), "@example/bundled", "Foo");
    expect(hit).toMatchObject({ leafPackage: "@example/bundled" });
    expect(resolver.diagnostics()).toEqual([]);
  });


  it("credits the package itself when its entry re-exports only through CommonJS `require`", () => {
    writePkg(
      tmp,
      "@example/cjs-pkg",
      { "index.js": 'module.exports = require("@nowhere/x");' },
      { main: "index.js" },
    );
    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(join(tmp, "src", "x.ts"), "@example/cjs-pkg", "Foo");
    expect(hit).toMatchObject({ leafPackage: "@example/cjs-pkg" });
    expect(resolver.diagnostics()).toEqual([]);
  });

  it("never follows an `export type *`", () => {
    writePkg(tmp, "@example/types", { "index.ts": "export interface Card {}" }, { main: "index.ts" });
    writePkg(tmp, "@example/card", { "index.js": "exports.Card = function Card() {};" }, { main: "index.js" });
    writePkg(
      tmp,
      "@example/typed",
      { "index.ts": `export type * from "@example/types";\nexport * from "@example/card";` },
      { main: "index.ts" },
    );
    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    expect(resolver.lookupExternalLeaf(join(tmp, "src", "x.ts"), "@example/typed", "Card")).toMatchObject({
      leafPackage: "@example/card",
    });
  });
});

describe("createLazyResolver: local imports (outside node_modules)", () => {
  it("returns null when the resolved file is inside the consumer's own workspace", () => {
    // A consumer-shaped tmp dir with its own package.json and a local
    // component file. The resolver doesn't attribute the local file to the
    // consumer's package: local detection handles it.
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ name: "consumer-app", version: "0.0.0" }),
    );
    mkdirSync(join(tmp, "components"), { recursive: true });
    writeFileSync(join(tmp, "components", "Local.tsx"), "export function Local() {}");

    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(
      join(tmp, "src", "App.tsx"),
      "../components/Local",
      "Local",
    );

    expect(hit).toBeNull();
  });
});

describe("createLazyResolver: diagnostics carry packageName", () => {
  it("populates packageName on cycle-detected", () => {
    writePkg(tmp, "@example/a", { "index.js": 'export * from "@example/b";' }, { main: "index.js" });
    writePkg(tmp, "@example/b", { "index.js": 'export * from "@example/a";' }, { main: "index.js" });
    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    resolver.lookupExternalLeaf(join(tmp, "src", "x.ts"), "@example/a", "Foo");

    const d = resolver.diagnostics().find((x) => x.code === "cycle-detected");
    expect(d?.packageName).toMatch(/^@example\/[ab]$/);
  });

  it("bails on a re-export chain past MAX_REEXPORT_HOPS, naming the package in its chain-too-deep diagnostic", () => {
    const N = 35;
    for (let i = 0; i < N; i++) {
      writePkg(
        tmp,
        `@example/p${i}`,
        { "index.js": i === N - 1 ? "export const X = 1;" : `export * from "@example/p${i + 1}";` },
        { main: "index.js" },
      );
    }
    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    expect(resolver.lookupExternalLeaf(join(tmp, "src", "x.ts"), "@example/p0", "X")).toEqual({ bailed: "chain-too-deep" });

    const d = resolver.diagnostics().find((x) => x.code === "chain-too-deep");
    expect(d?.packageName).toMatch(/^@example\/p\d+$/);
  });
});

describe("createLazyResolver: shared collector", () => {
  it("emits into a caller-supplied collector when provided", () => {
    const N = 35;
    for (let i = 0; i < N; i++) {
      writePkg(
        tmp,
        `@example/p${i}`,
        {
          "index.js":
            i === N - 1
              ? "export const X = 1;"
              : `export * from "@example/p${i + 1}";`,
        },
        { main: "index.js" },
      );
    }
    const collector = createDiagnosticCollector();
    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport, collector });

    resolver.lookupExternalLeaf(
      join(tmp, "src", "App.tsx"),
      "@example/p0",
      "X",
    );

    // The caller drains its own collector; the resolver's diagnostics() passes through to it.
    const drained = collector.drain();
    expect(drained.some((d) => d.code === "chain-too-deep")).toBe(true);
  });
});
