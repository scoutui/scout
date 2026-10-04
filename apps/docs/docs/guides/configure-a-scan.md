---
description: "Create scout.config.json with init, point it at the files you want scanned, and check that the scan reads them."
sidebar_label: "Configure a scan"
---

# Configure a scan

Set up `scout.config.json` so the scan reads the right files in your repo.

This guide assumes the CLI and the rest of the repo's dependencies are installed. The scan finds a package's components only when that package is installed. If they aren't, see [Install the CLI](/docs/guides/install). For a first run from start to finish, follow [Scan your first repo](/docs/tutorials/scan-your-first-repo).

## Create the config with `init`

From the repo root, run:

```bash
npx scout init -y
```

`init` writes `scout.config.json` in the current folder. It has no `include`, so the scan reads the [whole repository](#scan-the-whole-repository), and its `exclude` is empty.

`-y` skips the questions. Without it, in a terminal, `init` asks for your dashboard's address, the repository's name on the dashboard and the branch the dashboard tracks. In a monorepo, it also asks which packages or folders to leave out of the scan, and writes the ones you pick to `exclude`. With `-y`, pass `--exclude <folder>` for each folder to leave out.

If you run `init` in one package's folder of a monorepo, such as `apps/web`, it asks whether to scan the whole repository instead. If you say yes, it writes the config at the repository root.

`init` sets `repoId`, the [repo id](/docs/reference/glossary#repo-id) the scan is recorded under, from the owner and name in your git remote, such as `acme/storefront`, or from the name of the config's folder if there is no remote. To use a different name, edit `repoId` in the file or pass `--repo-id <name>` to `init`.

`init` won't overwrite an existing config. Edit that file instead, or delete it and run `init` again. Every `init` flag is in the [CLI reference](/docs/reference/cli#init).

## Scan the whole repository

A config from `init` has no `include`, so it already scans every app and package below the config's folder. If your config has an `include`, delete it. Any `exclude` can stay as it is:

```json title="scout.config.json"
{
  "$schema": "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
  "repoId": "storefront"
}
```

The scan then reads every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file there. To leave some of them out, use `exclude`, as below.

## Scan only some folders

Add `include` and point it at the folders you want. Patterns are globs, relative to the folder that holds the config file.

For a repo that keeps its code in `app/` and `components/`, list both folders:

```json title="scout.config.json"
{
  "$schema": "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
  "repoId": "storefront",
  "include": [
    "app/**/*.{js,jsx,ts,tsx}",
    "components/**/*.{js,jsx,ts,tsx}"
  ]
}
```

## Leave out files you don't want counted

Add a pattern to `exclude` for anything you don't want counted, such as `**/__mocks__/**` for mocks or `src/generated/**` for generated code. To leave out a whole package of a monorepo, such as a playground app, name its folder:

```json title="scout.config.json"
{
  "$schema": "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
  "repoId": "storefront",
  "exclude": ["apps/playground"]
}
```

If nothing exists at a folder or file you name, for example after it was renamed, the scan warns and carries on:

```
Warning: "apps/playground" in exclude matches nothing. Update or remove it in ./scout.config.json.
```

Fix the path, or remove it from `exclude`.

The scan already leaves these out, so you don't need to exclude them:

- test, spec and story files, files in `__tests__` folders, type declaration files (`.d.ts`) and `node_modules`;
- files your `.gitignore` ignores;
- folders whose names start with a dot, such as `.next`;
- a folder below the config's folder that holds its own git repository, such as a submodule, even when an `include` pattern points into it.

## Check that the scan reads your files

Scan without uploading:

```bash
npx scout scan --dry-run
```

The summary counts the files it read:

```
Scanned 3 files in 0.1s: 6 components, 5 uses.
```

The first number should be close to the number of source files you expect. If it's too low, narrow `exclude`, or widen `include` if your config has one. If it's too high, add to `exclude`. If there are no files to scan at all, the scan stops before reading anything. When `include` matches no files:

```
Error: No files match "include" in ./scout.config.json (app/**/*.{js,jsx,ts,tsx}, components/**/*.{js,jsx,ts,tsx}). Point it at your source files and scan again.
```

When the config has no `include`, and the config's folder holds no source files or `exclude` leaves them all out:

```
Error: No .js, .jsx, .ts, .tsx or .vue files to scan in /home/dev/storefront. Check "exclude" in ./scout.config.json, or scan from the folder that holds your source files.
```

Code inside a submodule or another clone below the config's folder isn't scanned, so an `include` pattern that points into one matches no files.

If the summary has lines like these, some of the repo's dependencies aren't installed:

```
Scout couldn't match 4 more uses to a component. See https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences
4 of them are from packages that aren't installed.
```

The components from those packages are missing from the scan. Run your package manager's install, then scan again.

If your imports use path aliases such as `@/components`, or the design system lives in another package of the same repo, see [Resolve imports in a monorepo](/docs/guides/resolve-imports-in-a-monorepo).

:::warning
In a Nuxt app, run `npx nuxt prepare` (or `dev` or `build`) before you scan. Without the files it generates under `.nuxt/`, the scan warns with `auto-import-manifest-missing` and can't find auto-imported components, and `scan` refuses with:

```
Error: Couldn't upload the scan: this Nuxt app hasn't been prepared. Run npx nuxt prepare and try again.
```
:::

Every config field, with its type and default, is in the [config reference](/docs/reference/config).
