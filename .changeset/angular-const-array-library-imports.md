---
"@scoutui/cli": patch
---

Angular components from an installed library are now found when the library's modules are listed only in a shared constant, such as `export const SHARED_ZORRO_MODULES = [NzButtonModule, ...]` in a file with no `@Component` or `@NgModule`, that a component spreads into its `imports`. Before, the scan never read those libraries, so their elements were counted as custom elements (tags) instead of the library's components.
