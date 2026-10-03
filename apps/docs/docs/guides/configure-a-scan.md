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

`init` writes `scout.config.json` in the current folder. Its `include` pattern, `src/**/*.{ts,tsx,jsx,js,vue}`, matches React and Vue files under `src/`.

`-y` skips the questions. Without it, in a terminal, `init` asks for your dashboard's address, the repository's name on the dashboard, the branch the dashboard tracks, and which frameworks the repo uses (React, Vue or both), and narrows `include` to their files.

`init` sets `repoId`, the [repo id](/docs/reference/glossary#repo-id) the scan is recorded under, from the owner and name in your git remote, such as `acme/storefront`, or from the folder name if there is no remote. To use a different name, edit `repoId` in the file or pass `--repo-id <name>` to `init`.

`init` won't overwrite an existing config. Edit that file instead, or delete it and run `init` again. Every `init` flag is in the [CLI reference](/docs/reference/cli#init).

## Point `include` at your source files

If your code isn't under `src/`, change `include`. Patterns are globs, relative to the folder that holds the config file.

For a repo that keeps its code in `app/` and `components/`, list both folders:

```json title="scout.config.json"
{
  "$schema": "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
  "repoId": "storefront",
  "include": [
    "app/**/*.{js,jsx,ts,tsx}",
    "components/**/*.{js,jsx,ts,tsx}"
  ],
  "exclude": [
    "**/*.{test,spec,stories}.*",
    "**/node_modules/**"
  ]
}
```

## Leave out files you don't want counted

The `exclude` patterns from `init` skip test, spec and story files, and `node_modules`. Add a pattern to `exclude` for anything else you don't want counted, such as `**/__mocks__/**` for mocks or `src/generated/**` for generated code.

You don't need to exclude files your `.gitignore` already ignores, or folders whose names start with a dot, such as `.next`. The scan skips both.

## Check that the scan reads your files

Scan without uploading:

```bash
npx scout scan --dry-run
```

The summary counts the files it read:

```
Scanned 3 files in 0.1s: 6 components, 5 uses.
```

The first number should be close to the number of source files you expect. If it's too low, widen `include`. If it's too high, add to `exclude`. If `include` matches no files at all, the scan stops before reading anything:

```
Error: No files match "include" in ./scout.config.json (src/**/*.{ts,tsx,jsx,js,vue}). Point it at your source files and scan again.
```

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
