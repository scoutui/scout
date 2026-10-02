import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  console.log("Packed CLI smoke passed: help and React/Vue fixture scan.");
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
