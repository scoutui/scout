import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLazyResolver } from "../../../src/barrels/lazy-resolver.js";

/**
 * Fixture: consumer imports from a wrapper package whose subpath modules
 * re-export from a leaf package. Mirrors the aggregator-barrel shape at unit
 * level.
 *
 *   @x/wrapper/react/button.js  →  export * from "@x/leaf/dist/react.js"
 *   @x/wrapper/react/renamed.js →  export { XButton as YButton } from "@x/leaf/dist/react.js"
 *   @x/leaf/dist/react.js       →  defines + exports XButton (terminal)
 */
function makeShape(root: string): void {
  const wrapper = join(root, "node_modules/@x/wrapper");
  const leaf = join(root, "node_modules/@x/leaf");
  mkdirSync(join(wrapper, "react"), { recursive: true });
  mkdirSync(join(leaf, "dist"), { recursive: true });
  writeFileSync(join(wrapper, "package.json"), JSON.stringify({ name: "@x/wrapper", version: "1.0.0" }));
  writeFileSync(join(leaf, "package.json"), JSON.stringify({ name: "@x/leaf", version: "1.0.0" }));
  writeFileSync(join(wrapper, "react/button.js"), 'export * from "@x/leaf/dist/react.js";\n');
  writeFileSync(
    join(wrapper, "react/renamed.js"),
    'export { XButton as YButton } from "@x/leaf/dist/react.js";\n',
  );
  writeFileSync(join(leaf, "dist/react.js"), "class XButton {}\nexport { XButton };\n");
  // Consumer package.json so fromFile's package differs from the wrapper's.
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "consumer", version: "0.0.0" }));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/App.tsx"), "// consumer\n");
}

/** Deterministic resolver: maps @x/* specifiers to the fixture files. */
function makeResolveImport(root: string) {
  return (_fromFile: string, spec: string): string | null => {
    for (const pkg of ["@x/wrapper", "@x/leaf"]) {
      if (spec.startsWith(`${pkg}/`)) return join(root, "node_modules", pkg, spec.slice(pkg.length + 1));
    }
    return null;
  };
}

describe("lookupExternalLeaf entry export name", () => {
  it("names the leaf entry a star re-export chain crosses into", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "cc-leaf-")));
    try {
      makeShape(root);
      const resolver = createLazyResolver({
        resolveImport: makeResolveImport(root),
        repoRoot: root,
      });
      const hit = resolver.lookupExternalLeaf(join(root, "src/App.tsx"), "@x/wrapper/react/button.js", "XButton");
      expect(hit).toEqual({ leafPackage: "@x/leaf", publicEntry: "dist/react", exportName: "XButton" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("names the leaf-side export when the chain renames it", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "cc-leaf-")));
    try {
      makeShape(root);
      const resolver = createLazyResolver({
        resolveImport: makeResolveImport(root),
        repoRoot: root,
      });
      const hit = resolver.lookupExternalLeaf(join(root, "src/App.tsx"), "@x/wrapper/react/renamed.js", "YButton");
      expect(hit).toEqual({ leafPackage: "@x/leaf", publicEntry: "dist/react", exportName: "XButton" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
