---
"@scoutui/cli": patch
---

A path alias that points into an installed package now credits that package's component, whatever the alias looks like. Before, an alias such as `"@ds": ["node_modules/@acme/ui/index.js"]` in tsconfig `paths` left its uses unmatched as `module-not-found`, while `"@ds/ui"` with the same target credited `@acme/ui`. An alias to a file outside the repository that no installed package holds is still `module-not-found`.
