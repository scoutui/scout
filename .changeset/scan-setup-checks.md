---
"@scoutui/cli": patch
---

Fixes four problems when a scan starts:

- `scout scan` run in a workspace package of a monorepo that installs with Yarn Plug'n'Play now stops with the Plug'n'Play error, as it does at the monorepo root. Before, it scanned and reported every package as not installed.
- When `tsconfigPath` names a file that doesn't exist, the scan warns about it and no longer prints `Path aliases: <that file>` as if it used it.
- `--config` pointing at a folder now stops with `<folder> is a folder. Pass the config file to --config, such as <folder>/scout.config.json.` and exit code `2`, instead of an unexpected error.
- With no `repoId` in the config, a git remote ending in `/`, such as `https://github.com/acme/storefront/`, now gives the repository name `storefront`, as the same remote without the slash does, instead of the folder's name.
