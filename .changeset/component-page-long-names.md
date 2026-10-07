---
"@scoutui/web-app": patch
---

On a component's Usage tab, a component whose uses all sit in one package of a monorepo now names that package above its folders, as in **Used in** `@acme/web`. In the **Used in** list, a package name too long for the column keeps the part that tells it apart: its scope reads `@…`, as in `@…/purchase-status`, so two long names that share a scope no longer look the same. On the Composition tab, the component's own box shows its name in full, with no package or path after it.
