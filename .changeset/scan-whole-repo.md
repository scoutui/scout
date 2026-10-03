---
"@scoutui/cli": minor
---

`include` in `scout.config.json` is now optional, so a scan can cover the whole repository:

- Without `include`, `scout scan` reads every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file below the config's folder, apart from files `.gitignore` ignores and anything `exclude` matches.
- Every scan now leaves out test, spec and story files, `__tests__` folders, type declaration files (`.d.ts`) and `node_modules`, whatever `include` says. If your `include` reached test, spec or story files, the scan counts fewer usages than before.
- A folder or file in `exclude` that doesn't exist now prints a warning, such as `Warning: "apps/playground" in exclude matches nothing. Update or remove it in ./scout.config.json.`, and the scan carries on.
- Components defined outside every workspace package, which in a repo that isn't a monorepo means all of them, now record the root package as their package: the `name` in the root `package.json`, or the repo id when it has none. The dashboard lists them under that package.
- When a scan covers more than one package, each usage records the package it sits in, by name, and every scan file records what the scan covered: the config's folder, its `include` and `exclude`, and the packages it read. A dashboard that splits counts by package reads these, so renaming a package starts a new group under its new name.
