import { afterAll, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCemIndex, type CemIndex } from "../../src/scan/cem-index.js";

const scratch = mkdtempSync(path.join(tmpdir(), "cc-cem-index-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Writes package `name` to `dir`, with a CEM that declares `tags`. */
function writePackage(dir: string, name: string, pkg: Record<string, unknown>, tags: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, ...pkg }));
  writeFileSync(
    path.join(dir, "custom-elements.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      modules: [{ declarations: tags.map((tagName) => ({ kind: "class", customElement: true, tagName, name: "C" })) }],
    }),
  );
}

/** Installs a package under `<root>/node_modules` whose CEM declares `tags`. */
function install(root: string, name: string, pkg: Record<string, unknown>, tags: string[]): void {
  writePackage(path.join(root, "node_modules", ...name.split("/")), name, pkg, tags);
}

const claimsOf = (index: CemIndex, tag: string) =>
  index.byTag.get(tag)?.map(({ packageName, version }) => ({ packageName, version }));

test("buildCemIndex maps tag names to the claiming package", async () => {
  const root = path.join(scratch, "claim");
  install(root, "@example/web-button", { version: "1.0.0", customElements: "custom-elements.json" }, ["web-button"]);
  const index = await buildCemIndex({ root, configDir: root, gitignore: true });
  const [entry] = index.byTag.get("web-button") ?? [];
  expect(entry?.packageName).toBe("@example/web-button");
});

test("buildCemIndex returns empty index when node_modules has no CEMs", async () => {
  const root = path.join(scratch, "no-cem");
  mkdirSync(path.join(root, "node_modules", "@example", "react-ds"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "@example", "react-ds", "package.json"), JSON.stringify({ name: "@example/react-ds", version: "1.0.0" }));
  const index = await buildCemIndex({ root, configDir: root, gitignore: true });
  expect(index.byTag.size).toBe(0);
});

test("buildCemIndex indexes workspace-package CEMs via node_modules symlinks", async () => {
  // A workspace package lives outside node_modules; the install links it in.
  const root = path.join(scratch, "workspace");
  const pkg = { version: "1.0.0", customElements: "custom-elements.json" };
  writePackage(path.join(root, "packages", "shoelace"), "@example/shoelace", pkg, ["fake-button"]);
  mkdirSync(path.join(root, "node_modules", "@example"), { recursive: true });
  symlinkSync(path.join("..", "..", "packages", "shoelace"), path.join(root, "node_modules", "@example", "shoelace"));
  const index = await buildCemIndex({ root, configDir: root, gitignore: true });
  const [entry] = index.byTag.get("fake-button") ?? [];
  expect(entry?.packageName).toBe("@example/shoelace");
});

test("buildCemIndex reads a CEM only through package.json#customElements", async () => {
  const root = path.join(scratch, "pointer");
  install(root, "@example/declared", { version: "1.0.0", customElements: "custom-elements.json" }, ["x-declared"]);
  install(root, "@example/undeclared", { version: "1.0.0" }, ["x-undeclared"]);
  const index = await buildCemIndex({ root, configDir: root, gitignore: true });
  expect(index.byTag.get("x-declared")?.map((c) => c.packageName)).toEqual(["@example/declared"]);
  expect(index.byTag.has("x-undeclared")).toBe(false);
});

test("buildCemIndex takes a package's version from the install nearest the config directory's lookup path", async () => {
  const root = path.join(scratch, "lookup");
  const app = path.join(root, "apps", "b");
  const pointer = { customElements: "custom-elements.json" };
  install(root, "@example/kit", { version: "1.0.0", ...pointer }, ["x-button", "x-old"]);
  install(app, "@example/kit", { version: "2.0.0", ...pointer }, ["X-Button"]);
  install(root, "@example/other", { version: "3.0.0", ...pointer }, ["x-button"]);
  const fromApp = await buildCemIndex({ root, configDir: app, gitignore: true });
  expect(claimsOf(fromApp, "x-button")).toEqual([
    { packageName: "@example/kit", version: "2.0.0" },
    { packageName: "@example/other", version: "3.0.0" },
  ]);
  expect(claimsOf(fromApp, "x-old")).toEqual([{ packageName: "@example/kit", version: "1.0.0" }]);
  const fromRoot = await buildCemIndex({ root, configDir: root, gitignore: true });
  expect(claimsOf(fromRoot, "x-button")?.[0]).toEqual({ packageName: "@example/kit", version: "1.0.0" });
});

test("buildCemIndex takes the shallowest install's version, then path order, off the config directory's lookup path", async () => {
  const root = path.join(scratch, "shallowest");
  const pointer = { customElements: "custom-elements.json" };
  install(path.join(root, "apps", "b"), "@example/kit", { version: "2.0.0", ...pointer }, ["x-kit"]);
  install(path.join(root, "apps", "a"), "@example/kit", { version: "1.0.0", ...pointer }, ["x-kit"]);
  install(path.join(root, "apps", "a", "deep"), "@example/kit", { version: "0.1.0", ...pointer }, ["x-kit"]);
  const index = await buildCemIndex({ root, configDir: root, gitignore: true });
  expect(claimsOf(index, "x-kit")).toEqual([{ packageName: "@example/kit", version: "1.0.0" }]);
});

test("buildCemIndex keeps a sibling app's claim when another app installs the same package without a CEM", async () => {
  const root = path.join(scratch, "sibling");
  const appA = path.join(root, "apps", "a");
  install(appA, "@example/kit", { version: "1.0.0" }, ["x-b"]);
  install(path.join(root, "apps", "b"), "@example/kit", { version: "2.0.0", customElements: "custom-elements.json" }, ["x-b"]);
  const index = await buildCemIndex({ root, configDir: appA, gitignore: true });
  expect(claimsOf(index, "x-b")).toEqual([{ packageName: "@example/kit", version: "2.0.0" }]);
});

test("buildCemIndex reads a symlinked package through its link without walking into it", async () => {
  const root = path.join(scratch, "links", "repo");
  const outside = path.join(scratch, "links", "outside");
  const pointer = { version: "1.0.0", customElements: "custom-elements.json" };
  install(outside, "@example/linked", pointer, ["x-linked"]);
  install(path.join(outside, "node_modules", "@example", "linked"), "@example/hidden", pointer, ["x-hidden"]);
  mkdirSync(path.join(root, "node_modules", "@example"), { recursive: true });
  symlinkSync(path.join(outside, "node_modules", "@example", "linked"), path.join(root, "node_modules", "@example", "linked"));
  symlinkSync(root, path.join(root, "node_modules", "@example", "loop"));
  const index = await buildCemIndex({ root, configDir: root, gitignore: true });
  expect([...index.byTag.keys()]).toEqual(["x-linked"]);
});

test("buildCemIndex does not walk a symlinked pnpm store entry or store node_modules", async () => {
  const root = path.join(scratch, "store-link", "repo");
  const outside = path.join(scratch, "store-link", "outside");
  install(outside, "@example/esc", { version: "1.0.0", customElements: "custom-elements.json" }, ["esc-tag"]);
  const store = path.join(root, "node_modules", ".pnpm");
  mkdirSync(path.join(store, "@example+inner@1.0.0"), { recursive: true });
  symlinkSync(outside, path.join(store, "@example+esc@1.0.0"));
  symlinkSync(path.join(outside, "node_modules"), path.join(store, "@example+inner@1.0.0", "node_modules"));
  const index = await buildCemIndex({ root, configDir: root, gitignore: true });
  expect(index.byTag.size).toBe(0);
});
