import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "cc-pack-smoke-")));
const env = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" };
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function pack(cwd) {
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", scratch], cwd));
  return join(scratch, packed.filename);
}

try {
  const install = join(scratch, "install");
  mkdirSync(install);
  writeFileSync(join(install, "package.json"), JSON.stringify({ private: true }));
  process.stdout.write(run("npm", ["install", "--no-audit", "--no-fund", pack(packageRoot)], install));
  const { dependencies } = json(join(install, "node_modules", "@scoutui", "cli", "package.json"));
  assert.deepEqual(
    Object.keys(dependencies).filter((name) => name.startsWith("@scoutui/")),
    [],
    "the packed CLI bundles its workspace packages",
  );
  const sbom = json(join(install, "node_modules", "@scoutui", "cli", "dist", "sbom.cdx.json"));
  const listed = sbom.components.map((component) => component.name);
  assert.ok(listed.includes("js-yaml"), "the SBOM lists a package bundled into the CLI");
  assert.ok(listed.includes("oxc-parser"), "the SBOM lists a runtime dependency");
  assert.ok(!listed.some((name) => name.startsWith("@scoutui/")), "the SBOM leaves out the CLI's own workspace packages");
  assert.ok(
    !listed.some((name) => name.startsWith("@angular/")),
    "the SBOM lists @angular/*: it must be resolved from the scanned repo at runtime, never bundled",
  );
  // esbuild stamps each bundled module with a `// <path>` origin comment when
  // it isn't minified, so a bundled `@angular/compiler` module would leave a
  // literal `@angular/compiler/<subpath>` in the packed dist/cli.js. The bare
  // `require("@angular/compiler")` runtime-resolution call (no trailing
  // slash before the closing quote) is expected and excluded.
  const packedCliSource = readFileSync(join(install, "node_modules", "@scoutui", "cli", "dist", "cli.js"), "utf8");
  assert.ok(
    !/@angular\/compiler\//.test(packedCliSource),
    "the packed dist/cli.js bundles @angular/compiler's own source",
  );
  const bin = join(install, "node_modules", ".bin", "scout");
  assert.match(run(bin, ["--help"], install), /scan/);

  const fixture = join(scratch, "fixture");
  cpSync(join(packageRoot, "tests/fixtures/packed-cli"), fixture, { recursive: true });
  run("git", ["init", "--quiet"], fixture);
  run("git", ["add", "."], fixture);
  run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "test: initialise fixture"], fixture);
  run(bin, ["scan", "--dry-run", "--repo-root", fixture, "--quiet"], fixture);
  const output = json(join(fixture, "scout-scan.json"));
  assert.ok(output.components.length > 0, "scan found components");
  assert.ok(output.occurrences.length > 0, "scan found occurrences");

  // An Angular scan loads `@angular/compiler` from the scanned repo, so the fixture gets a real copy in its node_modules.
  const angular = join(scratch, "angular-fixture");
  cpSync(join(packageRoot, "tests/fixtures/packed-cli-angular"), angular, { recursive: true });
  const compiler = dirname(createRequire(join(packageRoot, "package.json")).resolve("@angular/compiler-22/package.json"));
  cpSync(compiler, join(angular, "node_modules", "@angular", "compiler"), { recursive: true });
  mkdirSync(join(angular, "node_modules", "@angular", "core"), { recursive: true });
  writeFileSync(join(angular, "node_modules", "@angular", "core", "package.json"), JSON.stringify({ name: "@angular/core", version: "0.0.0" }));
  run("git", ["init", "--quiet"], angular);
  writeFileSync(join(angular, ".gitignore"), "node_modules/\n");
  run("git", ["add", "."], angular);
  run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "test: initialise fixture"], angular);
  run(bin, ["scan", "--dry-run", "--repo-root", angular, "--quiet"], angular);
  const angularScan = json(join(angular, "scout-scan.json"));
  const button = angularScan.components.find((c) => c.identity.exportName === "ButtonComponent");
  assert.equal(button?.framework, "angular", "the packed CLI reads an Angular component");
  assert.ok(
    angularScan.occurrences.some((o) => o.resolution.status === "resolved" && o.resolution.componentId === button.id),
    "the packed CLI matches an Angular template element to its component",
  );
  console.log("Packed CLI smoke passed: help, React/Vue fixture scan and Angular fixture scan.");
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
