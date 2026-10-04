---
"@scoutui/cli": minor
---

`include` in `scout.config.json` is now optional, so a scan can cover the whole repository:

- Without `include`, `scout scan` reads every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file below the config's folder, apart from files `.gitignore` ignores and anything `exclude` matches.
- Every scan now leaves out test, spec and story files, `__tests__` folders, type declaration files (`.d.ts`) and `node_modules`, whatever `include` says. If your `include` reached any of these files, the scan counts fewer usages.
- A folder or file in `exclude` that doesn't exist now prints a warning, such as `Warning: "apps/playground" in exclude matches nothing. Update or remove it in ./scout.config.json.`, and the scan carries on.
- Components defined outside every workspace package (in a repo that isn't a monorepo, all of them) now record the root package as their package: the `name` in the root `package.json`, or the repo id when it has none. The dashboard lists them under that package, and a lifecycle record on that package covers them. Scans uploaded before this release keep no package for them. If you rename the package, its components are listed under the new name from the next scan.
- When a scan covers more than one package, each usage records the package it sits in, by name. Every scan file also records what the scan covered: the config's folder, its `include` and `exclude`, and the packages it read.
