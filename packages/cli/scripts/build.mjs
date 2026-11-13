import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { cycloneDx } from "./sbom.mjs";

// Soft ceiling on the packed `dist/cli.js`, checked after every build. Guards
// against a dependency (or `@angular/compiler`, which must never bundle —
// see the check below) silently growing the bundle. Current size is about
// 4.36 MB; this leaves headroom for normal growth while still catching a
// surprise jump.
const BUNDLE_SIZE_CEILING_BYTES = 5_000_000;

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const require = createRequire(import.meta.url);
const vueSfc = JSON.parse(readFileSync(require.resolve("@vue/compiler-sfc/package.json"), "utf8"));

// @vue/compiler-sfc lazily requires dozens of optional template engines (pug,
// ejs, handlebars...) that only load to compile a <template lang="...">. The
// CLI only parses SFCs, so every package compiler-sfc doesn't declare as a
// dependency is left out of the bundle.
const vueOptionalEngines = {
  name: "vue-optional-engines",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (!/[\\/]@vue[\\/]compiler-sfc[\\/]dist[\\/]/.test(args.importer)) return undefined;
      const name = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0];
      if (name in vueSfc.dependencies || name.startsWith("node:")) return undefined;
      return { path: args.path, external: true };
    });
  },
};

rmSync("dist", { recursive: true, force: true });
const { metafile } = await build({
  entryPoints: ["src/cli.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  mainFields: ["module", "main"],
  // `@angular/compiler` is resolved from the repo being scanned at runtime
  // (see emit-angular-file.ts's `loadAngularCompiler`), never bundled: it's
  // deliberately absent from this package's own dependencies, and listed
  // here explicitly so esbuild can't pull it in even if a workspace sibling
  // (parser-angular's devDependency) happens to be installed where esbuild
  // can resolve it.
  external: [...Object.keys(pkg.dependencies), "@angular/compiler"],
  plugins: [vueOptionalEngines],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  logLevel: "info",
  metafile: true,
});
chmodSync("dist/cli.js", 0o755);

// Defence in depth beyond the `external` entry above: fail the build if any
// `@angular/*` package was actually bundled in, under any path shape.
const bundledAngularInputs = Object.keys(metafile.inputs).filter((input) => /(^|\/)@angular\//.test(input));
if (bundledAngularInputs.length > 0) {
  throw new Error(
    `The CLI bundle must never contain @angular/*: it's resolved from the scanned repo at runtime. Found:\n${bundledAngularInputs.map((i) => `  - ${i}`).join("\n")}`,
  );
}

const bundleSize = statSync("dist/cli.js").size;
if (bundleSize > BUNDLE_SIZE_CEILING_BYTES) {
  throw new Error(
    `dist/cli.js is ${bundleSize} bytes, over the ${BUNDLE_SIZE_CEILING_BYTES}-byte ceiling. If this growth is expected, raise BUNDLE_SIZE_CEILING_BYTES in this file and say why in the pull request.`,
  );
}

writeFileSync(
  "dist/sbom.cdx.json",
  `${JSON.stringify(cycloneDx(pkg, metafile, fileURLToPath(new URL("..", import.meta.url))), null, 2)}\n`,
);
