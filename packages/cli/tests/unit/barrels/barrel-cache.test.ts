import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLazyResolver } from "../../../src/barrels/lazy-resolver.js";
import { createDiagnosticCollector } from "../../../src/diagnostic.js";

function makeBarrelRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-barrel-cache-"));
  const pkgDir = join(dir, "node_modules", "@x", "pkg");
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "@x/pkg", main: "./dist/index.js" }),
  );
  writeFileSync(
    join(pkgDir, "dist", "index.js"),
    `export { Button } from "./Button.js";\nexport { Card } from "./Card.js";\n`,
  );
  writeFileSync(join(pkgDir, "dist", "Button.js"), "export const Button = () => null;");
  writeFileSync(join(pkgDir, "dist", "Card.js"), "export const Card = () => null;");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
  return dir;
}

describe("lazy-resolver: barrel parse cache", () => {
  it("parses a barrel only once even when multiple exports resolve through it", () => {
    const dir = makeBarrelRepo();
    try {
      const collector = createDiagnosticCollector();
      const barrelAbs = join(dir, "node_modules", "@x", "pkg", "dist", "index.js");
      const buttonAbs = join(dir, "node_modules", "@x", "pkg", "dist", "Button.js");
      const cardAbs = join(dir, "node_modules", "@x", "pkg", "dist", "Card.js");
      const resolveImport = (from: string, spec: string) => {
        if (spec === "@x/pkg") return barrelAbs;
        if (spec === "./Button.js") return buttonAbs;
        if (spec === "./Card.js") return cardAbs;
        return null;
      };
      const resolver = createLazyResolver({ resolveImport, repoRoot: dir, collector });

      resolver.lookupExternalLeaf(join(dir, "src", "A.tsx"), "@x/pkg", "Button");
      resolver.lookupExternalLeaf(join(dir, "src", "A.tsx"), "@x/pkg", "Card");

      expect(resolver._barrelParseCount(barrelAbs)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
