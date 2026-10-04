import { build } from "esbuild";

await build({
  entryPoints: ["src/worker/entry.ts"],
  outfile: "dist/worker.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["pg-native"],
  footer: {
    js: 'if (require.main === module) module.exports.main().catch((err) => { console.error(`[worker] couldn\'t start: ${module.exports.errorReason(err)}`); process.exitCode = 1; });',
  },
});
