---
description: "Every field in scout.config.json, with its type, default and what paths are relative to, plus repo-id resolution and validation errors."
sidebar_label: "Config"
---

# Config reference

[`scan`](/docs/reference/cli#scan) and [`backfill`](/docs/reference/cli#backfill) read `scout.config.json` from the current directory, or the file named by their `--config` flag. The file is plain JSON: comments and trailing commas are errors.

The smallest valid config:

```json title="scout.config.json"
{
  "include": ["src/**/*.{js,jsx,ts,tsx}"]
}
```

The *config folder* is the folder that holds the config file. Relative paths in the config resolve against it, whatever directory you run `scan` or `backfill` from. The one exception is `aliases`; see [Paths](#paths).

## Fields

### Common fields

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `include` | array of non-empty strings, at least one | none, required | Glob patterns for the files to scan. |
| `exclude` | array of non-empty strings | `[]` | Glob patterns for files to leave out, even when `include` matches them. |
| `repoId` | non-empty string | derived; see [Repo identity](#repo-identity) | The [repo id](/docs/reference/glossary#repo-id) the scan is recorded under. `--repo-id` replaces it. |

Files and folders whose names start with a dot, such as `.next`, are skipped unless an `include` pattern names them, for example `src/.generated/*.tsx`. Files ignored by `.gitignore` are skipped too; see [`gitignore`](#other-fields).

### Upload fields

Only needed when you upload scans to a dashboard.

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `host` | non-empty string | none | Dashboard that `scan` and `backfill` upload to and the `auth` commands sign in to. `--host` and `SCOUTUI_HOST` win over it; it wins over your default host. See [Host resolution](/docs/reference/cli#host-resolution). `init` writes it when you give a dashboard address. |
| `branch` | non-empty string | the remote's default branch | Branch the dashboard tracks. Without it, `scan` and `backfill` follow the remote's default branch as the clone recorded it (`<remote>/HEAD`). `init` writes it when it can tell which branch that is. |

### Backfill fields

Only [`backfill`](/docs/reference/cli#backfill) reads this field. `scan` ignores it, and `init` never writes it.

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `install` | non-empty string | none: `backfill` works out the install from the lockfile | Command `backfill` runs at each commit to install dependencies, through the shell, from the top of the repository. It replaces `backfill`'s own install, `nuxt prepare` included, so for a Nuxt app the command must prepare the app too. Example: `"yarn install --immutable"`. |

### Import resolution fields

Rarely needed. Set these only when imports go through path aliases the scan can't find on its own. See [Resolve imports in a monorepo](/docs/guides/resolve-imports-in-a-monorepo).

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `tsconfigPath` | non-empty string | none: the scan looks for a tsconfig itself | tsconfig whose `compilerOptions.paths` are used, following `extends`. Absolute, or relative to the config folder. If the file can't be read, the scan prints a `[scan] tsconfig:` warning and carries on without it. |
| `aliases` | object: each key an import pattern, each value an array of non-empty strings | none | Import aliases that aren't in a tsconfig, such as ones only in a bundler config. |

How `aliases` entries match:

- A key without `*` matches only that exact import. A `*` in the key matches any text, for example `"~/*"` matches `~/components/Card`. In each value, `*` is replaced by the text it matched.
- Values are tried in order, and the first one that points at an existing file wins. When more than one key matches, keys are tried in the order they appear in the file.
- A value can leave out the file extension, or point at a folder that holds an `index` file.
- `aliases` are tried before tsconfig `paths`. If no value points at an existing file, the scan falls back to tsconfig `paths`.

```json
"aliases": {
  "~/*": ["./src/*"],
  "@acme/ui-legacy": ["./vendor/ui-legacy/index.ts"]
}
```

### Other fields

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `$schema` | string | none | Lets editors validate the file and suggest fields. `init` sets it to `https://unpkg.com/@scoutui/cli/schema/config.schema.json`. The scan ignores it. |
| `gitignore` | boolean | `true` | `true` skips files ignored by the repo's `.gitignore` files. `false` scans them too, for example to include untracked work. |

No other keys are allowed; an unknown or misspelled key is an error. See [Validation errors](#validation-errors).

## Paths

What each path in the config is relative to:

| Field | Relative to |
| --- | --- |
| `include`, `exclude` | The config folder. |
| `tsconfigPath` | The config folder. |
| `aliases` values | The monorepo root when `scan` prints `[scan] workspace root: <dir>`, otherwise the config folder. |

`scan` prints `[scan] workspace root:` when the config folder is one of a monorepo's workspace packages. [Resolve imports in a monorepo](/docs/guides/resolve-imports-in-a-monorepo#if-your-aliases-are-only-in-a-bundler-config) shows the same alias written both ways.

## Repo identity

The [repo id](/docs/reference/glossary#repo-id) comes from the first of these that is set:

| Order | Source | Example |
| --- | --- | --- |
| 1 | `--repo-id <value>` | `--repo-id storefront` gives `storefront` |
| 2 | `repoId` in the config | `"repoId": "storefront"` gives `storefront` |
| 3 | The last part of the remote's URL, without `.git`. The remote is the one `git config scout.remote` names, else `upstream` when there is one, else the only remote, else `origin`. | `git@github.com:acme/checkout.git` gives `checkout` |
| 4 | The name of the config folder | A config in `apps/web` gives `web`, even when you run `scan` from the repo root |

`init` writes `repoId` for you, from the owner and name in the same remote's URL: `git@github.com:acme/checkout.git` gives `acme/checkout`.

## Validation errors

A config error stops `scan` or `backfill` with exit code `2` before it reads any source files. Each message starts with `Error:`. `<path>` is the absolute path of the config file, and `<folder>` the config folder.

| Problem | Message |
| --- | --- |
| No file at the config path | ``Scout config not found at <path>. Run `scout init` to scaffold one.`` |
| The file isn't valid JSON | `<path> is not valid JSON: <parser message>` |
| A top-level `manifests` key | ``<path>: the `manifests` field was removed. Replace with `include` (array of glob patterns for files to scan).`` |
| A field that isn't in [Fields](#fields), such as a misspelled name | `<path> has a field Scout doesn't use: "<field>". Remove it and try again.` With several, it names every one: `<path> has fields Scout doesn't use: "<field>", "<field>". Remove them and try again.` No other problem is shown until they are gone. |
| Anything else the schema rejects | `Invalid config at <path>: <problems>` |
| On a dry run ([`scout scan --dry-run`](/docs/reference/cli#scan)), `scout-scan.json` in the config folder links to a file outside it | `scout-scan.json in <folder> links to a file outside that folder, so the scan won't write it. Delete the link and try again.` |

`<problems>` lists every problem found, separated by `; `, each as `<location>: <message>`. The location is `<root>` for the whole file, or the field's path, such as `/include/0` for the first `include` entry. Messages you are likely to see:

| Config | Problem shown |
| --- | --- |
| `include` left out | `<root>: must have required property 'include'` |
| `"include": []` | `/include: must NOT have fewer than 1 items` |
| `"include": "src/**/*.tsx"` | `/include: must be array` |
