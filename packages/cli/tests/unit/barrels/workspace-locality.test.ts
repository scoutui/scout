import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLazyResolver } from "../../../src/barrels/lazy-resolver.js";
import { createImportResolver } from "../../../src/walker/resolve-import.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cc-ws-locality-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeWorkspacePkg(
  root: string,
  relPath: string,
  name: string,
  files: Record<string, string>,
): string {
  const pkgDir = join(root, relPath);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "src/index.js" }),
  );
  for (const [rel, content] of Object.entries(files)) {
    const fp = join(pkgDir, rel);
    mkdirSync(join(fp, ".."), { recursive: true });
    writeFileSync(fp, content);
  }
  return pkgDir;
}

describe("createLazyResolver: workspace-package identity", () => {
  it("resolves workspace sibling as external-style hit (leafPackage set)", () => {
    // A named workspace package is treated like an installed one: the
    // resolver names its leaf package instead of returning null.
    const accountDir = writeWorkspacePkg(tmp, "packages/account", "@a/account", {
      "src/Page.tsx": `import { Button } from "@a/common";\nexport const Page = () => <Button />;`,
    });
    const commonDir = writeWorkspacePkg(tmp, "packages/common", "@a/common", {
      "src/index.js": 'export { Button } from "./Button.js";',
      "src/Button.js": "export function Button() {}",
    });

    // Stub the import resolver to point @a/common at the sibling source file
    // directly, with no node_modules symlink.
    const resolveImport = (_from: string, spec: string): string | null => {
      if (spec === "@a/common") return join(commonDir, "src", "index.js");
      return null;
    };

    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(
      join(accountDir, "src", "Page.tsx"),
      "@a/common",
      "Button",
    );
    expect(hit).not.toBeNull();
    expect(hit).toMatchObject({ leafPackage: "@a/common" });
  });

  it("resolves node_modules external package as external-style hit", () => {
    // A vendor package under node_modules also resolves to its leaf package.
    const accountDir = writeWorkspacePkg(tmp, "packages/account", "@a/account", {
      "src/Page.tsx": "",
    });

    const vendorDir = join(tmp, "node_modules", "@vendor", "ui");
    mkdirSync(vendorDir, { recursive: true });
    writeFileSync(
      join(vendorDir, "package.json"),
      JSON.stringify({ name: "@vendor/ui", version: "1.0.0", main: "index.js" }),
    );
    writeFileSync(join(vendorDir, "index.js"), "export function Button() {}");

    const resolveImport = createImportResolver({ repoRoot: tmp });
    const resolver = createLazyResolver({ resolveImport });

    const hit = resolver.lookupExternalLeaf(
      join(accountDir, "src", "Page.tsx"),
      "@vendor/ui",
      "Button",
    );
    expect(hit).not.toBeNull();
    expect(hit).toMatchObject({ leafPackage: "@vendor/ui" });
  });
});
