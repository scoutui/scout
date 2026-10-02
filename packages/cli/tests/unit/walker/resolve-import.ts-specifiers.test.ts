/**
 * TypeScript ESM specifiers: under `moduleResolution: node16|nodenext`
 * a relative import spells the emitted extension (`./Leaf.js`) while the
 * file on disk is the TypeScript source (`Leaf.tsx`). The resolver maps
 * the emitted spelling back to the source the same way `tsc` does:
 * `.js` → `.ts` | `.tsx`, `.jsx` → `.tsx`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImportResolver } from "../../../src/walker/resolve-import.js";

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cc-resolve-ts-")));
  mkdirSync(join(root, "src/components"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createImportResolver: TypeScript ESM `.js` specifiers", () => {
  it("maps a relative `./Leaf.js` specifier onto `Leaf.tsx`", () => {
    writeFileSync(join(root, "src/Leaf.tsx"), "");
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/A.tsx"), "./Leaf.js")).toBe(join(root, "src/Leaf.tsx"));
  });

  it("maps a relative `./util.js` specifier onto `util.ts`", () => {
    writeFileSync(join(root, "src/util.ts"), "");
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/A.tsx"), "./util.js")).toBe(join(root, "src/util.ts"));
  });

  it("maps a relative `./Leaf.jsx` specifier onto `Leaf.tsx`", () => {
    writeFileSync(join(root, "src/Leaf.tsx"), "");
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/A.tsx"), "./Leaf.jsx")).toBe(join(root, "src/Leaf.tsx"));
  });

  it("maps a directory-index `./components/index.js` specifier onto `components/index.tsx`", () => {
    writeFileSync(join(root, "src/components/index.tsx"), "");
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/A.tsx"), "./components/index.js")).toBe(
      join(root, "src/components/index.tsx"),
    );
  });

  it("prefers a real `.js` file on disk over its `.tsx` twin", () => {
    writeFileSync(join(root, "src/Leaf.js"), "");
    writeFileSync(join(root, "src/Leaf.tsx"), "");
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/A.tsx"), "./Leaf.js")).toBe(join(root, "src/Leaf.js"));
  });

  it("maps a `.js` specifier through a tsconfig `paths` alias onto `.tsx`", () => {
    writeFileSync(join(root, "src/components/Button.tsx"), "");
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }),
    );
    const resolve = createImportResolver({ repoRoot: root, tsconfigPath: join(root, "tsconfig.json") });
    expect(resolve(join(root, "src/A.tsx"), "@/components/Button.js")).toBe(
      join(root, "src/components/Button.tsx"),
    );
  });

  it("still returns null when neither the `.js` nor a TypeScript twin exists", () => {
    const resolve = createImportResolver({ repoRoot: root });
    expect(resolve(join(root, "src/A.tsx"), "./Missing.js")).toBeNull();
  });
});
