import type { Target } from "./types.js";

const INSTALL = "yarn install --immutable --mode=skip-build";

export const TARGETS: Target[] = [
  {
    name: "pie-aperture",
    repo: "justeattakeaway/pie-aperture",
    // pie-aperture ships a Berry lockfile but declares no `packageManager`, so a
    // bare `yarn` resolves to 1.22.x. Yarn 1 ignores the Berry-only flags (build
    // scripts run, the lockfile is rewritten as v1) and drops `nuxt-app`, whose
    // package.json has no `version`. Pin the version the repo's mise.toml names.
    // `--mode=skip-build` also skips nuxt-app's `postinstall: nuxt prepare`, so
    // run it explicitly: without `.nuxt/components.d.ts` the scan can't see
    // auto-imports.
    install: "corepack yarn@3.8.1 install --immutable --mode=skip-build && corepack yarn@3.8.1 workspace nuxt-app run postinstall",
    scans: [
      { cwd: "nextjs-app-v14", repoId: "pie-aperture/nextjs-app-v14", include: ["src/**/*.{ts,tsx,js,jsx}"], tokenSecret: "SCOUTUI_TOKEN_PIE_APERTURE_NEXTJS_APP_V14" },
      { cwd: "nextjs-app-v15", repoId: "pie-aperture/nextjs-app-v15", include: ["src/**/*.{ts,tsx,js,jsx}"], tokenSecret: "SCOUTUI_TOKEN_PIE_APERTURE_NEXTJS_APP_V15" },
      { cwd: "nuxt-app", repoId: "pie-aperture/nuxt-app", include: ["**/*.{ts,js,vue}"], tokenSecret: "SCOUTUI_TOKEN_PIE_APERTURE_NUXT_APP" },
    ],
  },
  {
    name: "cal.diy",
    repo: "calcom/cal.diy",
    install: INSTALL,
    scans: [
      { cwd: "apps/web", repoId: "cal.diy/web", include: ["**/*.{ts,tsx,js,jsx}"], tokenSecret: "SCOUTUI_TOKEN_CAL_DIY_WEB" },
    ],
  },
  {
    name: "elk",
    repo: "elk-zone/elk",
    // Scriptless install, then `nuxt prepare` to generate
    // .nuxt/components.d.ts, which the scan reads for auto-imports.
    install: "pnpm install --frozen-lockfile --ignore-scripts && pnpm exec nuxt prepare",
    scans: [
      {
        cwd: ".",
        repoId: "elk-zone/elk",
        include: ["app/**/*.{ts,js,vue}"],
        tokenSecret: "SCOUTUI_TOKEN_ELK_ZONE_ELK",
      },
    ],
  },
  {
    // The design-system surface (`packages/@core`, `packages/effects`) is a
    // pnpm workspace sibling, not a published package, so this target covers
    // workspace-sibling resolution. Five apps each wire it to a different
    // external Vue UI kit, over the external headless `reka-ui` primitives.
    name: "vue-vben-admin",
    repo: "vbenjs/vue-vben-admin",
    // Explicit imports throughout, so no codegen: a scriptless install is enough.
    install: "pnpm install --frozen-lockfile --ignore-scripts",
    scans: [
      {
        cwd: ".",
        repoId: "vue-vben-admin",
        // apps/backend-mock has no .ts/.tsx/.vue under src/, so the glob skips it.
        include: ["apps/**/src/**/*.{ts,tsx,vue}", "packages/**/src/**/*.{ts,tsx,vue}"],
        tokenSecret: "SCOUTUI_TOKEN_VUE_VBEN_ADMIN",
      },
    ],
  },
  {
    // `moduleResolution: NodeNext`: relative imports spell the emitted `.js`
    // extension while the source on disk is `.ts`/`.tsx`. No other target
    // writes imports this way.
    name: "payload",
    repo: "payloadcms/payload",
    // `--ignore-scripts` skips the root `prepare` build; the scan needs no codegen.
    install: "pnpm install --frozen-lockfile --ignore-scripts",
    scans: [
      {
        cwd: ".",
        repoId: "payloadcms/payload",
        // Leaves out `test/` and `templates/` (e2e fixture apps and starter
        // templates), so counts reflect the admin UI.
        include: ["packages/ui/src/**/*.{ts,tsx}", "packages/richtext-lexical/src/**/*.{ts,tsx}"],
        tokenSecret: "SCOUTUI_TOKEN_PAYLOADCMS_PAYLOAD",
      },
    ],
  },
  {
    // Angular 22 + Angular Material admin template (Yarn classic, no `packageManager`
    // field; `engines.yarn` pins `>=1.22.0 <2`). No codegen: the Angular parser
    // resolves `@angular/compiler` from the scanned repo itself, so a scriptless
    // install is enough. `--ignore-scripts` also skips the `prepare: "is-ci || husky"`
    // lifecycle script.
    name: "ng-matero",
    repo: "ng-matero/ng-matero",
    install: "corepack yarn@1.22.22 install --frozen-lockfile --ignore-scripts",
    scans: [
      {
        cwd: ".",
        repoId: "ng-matero",
        include: ["src/**/*.{ts,html}"],
        // Resolves the `@core`/`@shared`/`@theme`/`@env` paths aliases the app imports through.
        tsconfigPath: "tsconfig.json",
        tokenSecret: "SCOUTUI_TOKEN_NG_MATERO",
      },
    ],
  },
];
