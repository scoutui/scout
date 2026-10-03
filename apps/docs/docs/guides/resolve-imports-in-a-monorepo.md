---
description: "Make path aliases and workspace package imports resolve, so every component your code imports is found and listed under the right package."
sidebar_label: "Resolve monorepo imports"
---

# Resolve imports in a monorepo

Make the scan follow your path aliases and workspace package imports. When it can't follow an import, the use becomes an [unresolved occurrence](/docs/reference/glossary#unresolved-occurrence) with the reason `module-not-found`, and the component it imports is missing from the results and the dashboard.

This guide assumes the repo already has a working `scout.config.json`. If it doesn't, see [Configure a scan](/docs/guides/configure-a-scan).

## Find imports that didn't resolve

Scan without uploading, which writes `scout-scan.json`, then list the uses the scan couldn't tie to a component:

```bash
npx scout scan --dry-run
jq -r '.occurrences[] | select(.resolution.status == "unresolved") | "\(.resolution.reason.kind)  \(.filePath):\(.line)  \([.trace[] | select(.kind == "import") | .specifier][0] // .resolution.reason.name // "")"' scout-scan.json | sort
```

Each line shows the reason, where the use is, and the import that failed:

```
module-not-found  apps/storefront/src/App.tsx:10  ~/Modal
module-not-found  apps/storefront/src/App.tsx:8  @/components/Card
```

Here `@/components` and `~/` are path aliases the scan doesn't know, so `Card` and `Modal` are missing. Fix them with [tsconfig `paths`](#if-your-aliases-are-in-tsconfigjson) or [`aliases`](#if-your-aliases-are-only-in-a-bundler-config). If an import of a package from your own monorepo is listed, see [If the design system is a package in the same monorepo](#if-the-design-system-is-a-package-in-the-same-monorepo).

If your config is in one app's folder and that folder is a workspace package, the scan finds the monorepo root on its own and says so:

```
Monorepo root: ../..
```

The path is relative to the config's folder.

## If your aliases are in `tsconfig.json`

The scan reads `compilerOptions.paths`, following `extends`, from `tsconfig.json` or `tsconfig.base.json` in the folder that holds your config, or else in the monorepo root. It prints the one it picked:

```
Path aliases: tsconfig.json
```

If it found none, it prints `Path aliases: no tsconfig.json found. If yours has another name, set "tsconfigPath" in scout.config.json.`

If the tsconfig it picked only references other projects (`"files": []` with a `"references"` list, as Nuxt 4 and Vite's templates create), the scan reads the aliases from those projects. When two of them define the same alias, the first one listed wins. Aliases in that tsconfig itself, or in a file it extends, apply when none of those projects defines them. In a Nuxt 4 app the referenced projects are generated under `.nuxt/`, so run `nuxt prepare` before you scan.

If your tsconfig has another name, such as `tsconfig.app.json`, set `tsconfigPath` in your config, relative to the folder that holds it:

```json
"tsconfigPath": "./tsconfig.app.json"
```

If that file doesn't exist, the scan runs without it. The `Path aliases` line still names the file, so look for a warning just above it: `Warning: <path> doesn't exist, so its path aliases aren't followed.` A missing file in a tsconfig's `extends` prints `Warning: <tsconfig> points to <path>, which doesn't exist, so its path aliases aren't followed.`

Each workspace package's own `tsconfig.json` or `tsconfig.base.json` also applies to that package's files, so two apps can each map `@/*` to their own `src/`. When you scan the whole monorepo from a root that has no tsconfig of its own, the line counts the workspace packages whose tsconfig sets path aliases: `Path aliases: tsconfig files in 12 workspace packages`. If none of them sets any, it prints `Path aliases: no tsconfig.json found.`, so check the list of unresolved imports instead.

## If your aliases are only in a bundler config

Aliases that live only in a Vite, Webpack or Metro config aren't in any tsconfig. Copy them into `aliases`. Each key is an import pattern and each value lists the paths it points to, with `*` standing for the rest of the import:

```json
"aliases": {
  "~/*": ["./src/*"]
}
```

:::warning
When the scan prints `Monorepo root:`, alias paths are relative to that monorepo root, not to your config's folder. In `apps/storefront/scout.config.json`, `"~/*": ["./src/*"]` doesn't resolve. Write the path from the root:

```json
"aliases": { "~/*": ["./apps/storefront/src/*"] }
```
:::

## If the design system is a package in the same monorepo

You don't need any config. The scan reads the package list from `pnpm-workspace.yaml`, or from `workspaces` in the root `package.json`, and follows imports of those packages to their source files. A component found this way is [defined in the repo](/docs/reference/glossary#defined-in-the-repo) and listed under the package's name. List the components to check:

```bash
jq -r '.components[] | "\(.identity.kind)  \(.identity.packageName // .owningPackage // .attribution.target.packageName // "-")  \(.identity.exportName // .identity.tagName)  \(.identity.filePath // "")"' scout-scan.json
```

Each line shows `repository-declaration` for a component defined in the repo or `package-export` for one [from a package](/docs/reference/glossary#from-a-package), then its package, its name and the file that defines it:

```
repository-declaration  @acme/ui  Button  packages/ui/src/Button.tsx
```

If it isn't listed like that:

- **Its package shows as `-`.** The package's folder doesn't match a pattern in `workspaces` or `pnpm-workspace.yaml`. With `"workspaces": ["apps/*"]`, a package in `packages/ui` isn't included. Add `"packages/*"`.
- **Its uses are unresolved, as `package-not-installed` or `module-not-found`.** No workspace package has the name your code imports. Check that the package's `package.json` `name` matches the import exactly and that its folder is in the workspace list, then install dependencies.
- **A deep import such as `@acme/ui/Button` is listed as `package-export` with no file.** Add a matching entry to the package's `exports`, for example `"./*": "./src/*.tsx"`.

## Check the result

Run `npx scout scan --dry-run` again and rerun both `jq` commands. The imports you fixed are gone from the unresolved list, and their components are listed with their files:

```
repository-declaration  storefront  App  apps/storefront/src/App.tsx
repository-declaration  storefront  Modal  apps/storefront/src/Modal.tsx
repository-declaration  storefront  Card  apps/storefront/src/components/Card.tsx
repository-declaration  @acme/ui  Button  packages/ui/src/Button.tsx
package-export  @acme/icons  StarIcon
```

`tsconfigPath` and `aliases` are listed with their types in the [config reference](/docs/reference/config).
