---
"@scoutui/cli": patch
---

In a Vue app that uses `unplugin-vue-components`, the scan now reads the `components.d.ts` the plugin writes, at the top of the app or in `src/`. Components used in a template without an import are now counted for their package or file: with Element Plus's resolver, `<el-button>` is Element Plus's `ElButton` rather than a web component with no package, and `<router-view>` is vue-router's `RouterView`.
