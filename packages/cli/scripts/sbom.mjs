import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Builds a CycloneDX SBOM for the CLI from esbuild's metafile. The bundle
// carries most of the CLI's third-party code, so the SBOM lists every package
// esbuild pulled a file from, plus the runtime dependencies left external.
// Workspace packages are part of the CLI itself and aren't listed.
export function cycloneDx(pkg, metafile, packageRoot) {
  const found = new Map();
  const add = (manifest) => {
    if (manifest.private || manifest.name === pkg.name) return;
    found.set(`${manifest.name}@${manifest.version}`, manifest);
  };
  for (const input of Object.keys(metafile.inputs)) {
    const manifest = owningManifest(resolve(packageRoot, input));
    if (manifest) add(manifest);
  }
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    const path = installedManifestPath(name, packageRoot);
    if (!path) throw new Error(`Couldn't find the installed ${name} to list it in the SBOM. Run yarn install and build again.`);
    add(JSON.parse(readFileSync(path, "utf8")));
  }

  const components = [...found.values()]
    .map((manifest) => component(manifest))
    .sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
  const root = { ...component(pkg), type: "application" };
  const body = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: { component: root },
    components,
    dependencies: [{ ref: root["bom-ref"], dependsOn: components.map((c) => c["bom-ref"]) }],
  };
  // Derived from the content rather than random, so the same build writes the
  // same file.
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const serial = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return { ...body, serialNumber: `urn:uuid:${serial}` };
}

function component(manifest) {
  const purl = `pkg:npm/${manifest.name.replace(/^@/, "%40")}@${manifest.version}`;
  const license = typeof manifest.license === "string" ? manifest.license : manifest.license?.type;
  return {
    type: "library",
    "bom-ref": purl,
    name: manifest.name,
    version: manifest.version,
    purl,
    ...(license ? { licenses: [{ expression: license }] } : {}),
  };
}

// The nearest package.json above a file that names a package. Some packages
// ship nested package.json files that only set "type", so those are skipped.
function owningManifest(file) {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const path = join(dir, "package.json");
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (manifest.name && manifest.version) return manifest;
  }
  return undefined;
}

function installedManifestPath(name, from) {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
    const path = join(dir, "node_modules", name, "package.json");
    if (existsSync(path)) return path;
  }
  return undefined;
}
