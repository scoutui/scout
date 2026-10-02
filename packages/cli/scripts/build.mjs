import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { cycloneDx } from "./sbom.mjs";

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
  external: Object.keys(pkg.dependencies),
  plugins: [vueOptionalEngines],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  logLevel: "info",
  metafile: true,
});
chmodSync("dist/cli.js", 0o755);
writeFileSync(
  "dist/sbom.cdx.json",
  `${JSON.stringify(cycloneDx(pkg, metafile, fileURLToPath(new URL("..", import.meta.url))), null, 2)}\n`,
);
