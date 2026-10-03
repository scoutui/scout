# @scoutui/cli

## 0.3.0

### Minor Changes

- [#57](https://github.com/scoutui/scout/pull/57) [`b31629d`](https://github.com/scoutui/scout/commit/b31629d5fd3e65a6a2d8ded8cb9c7dc1fb34b475) Thanks [@siggerzz](https://github.com/siggerzz)! - In a terminal, the CLI's output now has one look. `scan`, `backfill` and `--help` start with the wordmark, `scout <version>`: `scan` adds the repo and commit, and `backfill` the repo. Numbers stand out, Scout's teal marks links and, in help, commands and flags, and a line saying something went well starts with `✓`, a warning with `!` and an error with `✗`. While `scan` reads files a spinner turns beside a progress bar, and the upload shows a spinner until the dashboard has the scan. `backfill` shows one line for the commit it's working on, with what it's doing, a bar of the commits done and the count, in place of a `Scanning` line per commit, and ends with the link on a line of its own. `auth login` turns a spinner while it waits for you to approve the sign-in.

  None of this appears in CI, when output goes to a file or another command, or with `NO_COLOR`, so logs read as before, apart from these changes:

  - The scan summary lists the most used components only after `scout scan --dry-run` in a terminal. After an upload, and in CI, the summary is the counts, so the dashboard link is the last line.
  - `auth login` ends with `✓ Signed in as <email> to <host>.`, naming the dashboard. With `NO_COLOR`, nothing turns while it waits.
  - Colour stays off in CI unless `FORCE_COLOR` is set.
  - The scan summary groups thousands, as the dashboard does: `1,191 components, 3,925 occurrences`.

- [#53](https://github.com/scoutui/scout/pull/53) [`a2bfa4c`](https://github.com/scoutui/scout/commit/a2bfa4c77a0e3109041ecd5b1557e5f33a77c637) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan` now stops when `include` matches no files, instead of reporting an empty scan as a success. It prints `Error: No files match "include" in ./scout.config.json (<patterns>). Point it at your source files and scan again.` and exits `2`, on a dry run and an upload alike. An upload used to scan first and then exit `1`; it now stops before contacting the dashboard.

- [#60](https://github.com/scoutui/scout/pull/60) [`876263d`](https://github.com/scoutui/scout/commit/876263d3fa5877f69f28c7060509b35327b892ae) Thanks [@siggerzz](https://github.com/siggerzz)! - The scan now counts more of the components your code imports, and names more of them correctly:

  - After `const AliasedStar = Icons.Star`, with `Icons` imported from a package, `<AliasedStar />` counts as `Icons.Star`, the same as `<Icons.Star />`.
  - Members of `export * as Shapes from "./shapes"`, such as `<Shapes.Circle />`, count for the files that declare them.
  - More components imported through a folder outside `include`, or matched by `exclude`, now get the same name, and the same file or package, as when that folder is scanned:
    - A Vue component keeps its own name instead of `default`, and the scan no longer warns "Stopped following re-exports" for it.
    - Members of `export * as Shapes from …`, or of `import * as Shapes from …` exported again with `export { Shapes }`, in that folder count for the file or package that declares them.
    - A component from `export * from` a package counts for the package instead of a file inside `node_modules`.

  A folder below the config's folder that holds its own git repository, such as a submodule or another clone, is no longer scanned as part of your repository. If `include` only matches files in such a folder, the scan stops and names it.

- [#57](https://github.com/scoutui/scout/pull/57) [`b31629d`](https://github.com/scoutui/scout/commit/b31629d5fd3e65a6a2d8ded8cb9c7dc1fb34b475) Thanks [@siggerzz](https://github.com/siggerzz)! - In a terminal, the CLI now says when a newer version is available, on the line under the wordmark (or first, for a command without one), with the command that gets it for your repo's package manager, for example `Scout 0.3.0 is available. Update with npm i -D @scoutui/cli@latest.` If the repo doesn't list the CLI yet, the line says `Install it with …` instead. When the dashboard you last uploaded to can't read the new version's scans yet, the notice says so instead, and to keep the current version until the dashboard is upgraded, with a link to the upgrade guide. `--help` lists `SCOUTUI_NO_UPDATE_CHECK=1`, which turns the notice off. Scout asks the npm registry at most once a day, in the background, so the line never holds up a command and shows what it heard on the next run. It says nothing when it can't reach the registry. The check is off in CI, when output goes to a file or another command, with `--quiet`, and when `SCOUTUI_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER` is set.

### Patch Changes

- [#56](https://github.com/scoutui/scout/pull/56) [`89c4c61`](https://github.com/scoutui/scout/commit/89c4c61103ed6d0c9acb402124ffbf8e606e2796) Thanks [@siggerzz](https://github.com/siggerzz)! - Clearer `--help` text. `scout --help` now ends with how to get started (`scout init`, then `scout scan --dry-run`) and where the docs are. Each option says what it does: `scan --quiet` hides progress and most warnings as well as the summary, and `--host` lists where the address comes from when you don't pass one. `scan`, `init` and `auth` now list `--debug` too.

- [#54](https://github.com/scoutui/scout/pull/54) [`9ae786a`](https://github.com/scoutui/scout/commit/9ae786a282563cdfb349e27c5c17124ecbe84f09) Thanks [@siggerzz](https://github.com/siggerzz)! - Clearer messages from `scout scan` and `scout auth login`:

  - The lines that started with `[scan]` now read `Monorepo root: ../..` and `Path aliases: tsconfig.json`. At a monorepo root with no tsconfig of its own, it counts the workspace packages that have a tsconfig file, instead of saying none was found. With no tsconfig anywhere, it says how to point `tsconfigPath` at one with another name.
  - A tsconfig the scan can't read gets one warning with its path relative to the repository and what to do, such as `docs/tsconfig.json points to docs/.nuxt/tsconfig.json, which doesn't exist, so its path aliases aren't followed.`, in place of the file system's own error. A problem that several tsconfig files reach is reported once.
  - When dependencies aren't installed, the refusal to upload names the first missing package and the `package.json` that lists it, relative to the repository like the scan's own warning.
  - An address that isn't a Scout dashboard now says so (`<host> didn't answer like a Scout dashboard. Check the dashboard address and try again.`) instead of asking you to check the dashboard's logs.
  - With no dashboard address set, the upload error also names `SCOUTUI_HOST`, and `scout auth login` says how to give one.
  - A missing config reads `Couldn't find ./scout.config.json. Run scout init to create one, or pass --config <path>.` Config errors name the config path as you gave it, and invalid JSON ends with what to do; `--debug` shows where the parser stopped.
  - `scout auth --help` lists `--host` and `--debug`, and `scout --help` says what `auth status` does.
  - With `--debug` in a terminal, debug lines no longer print on the end of the progress line.

- [#55](https://github.com/scoutui/scout/pull/55) [`2c6e2d2`](https://github.com/scoutui/scout/commit/2c6e2d2d9c7eddbe64887eb5d50fb1ee4c633fdf) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan`'s progress is easier to read:

  - In a CI log, the file count prints once as the scan starts and then at most every 10 seconds, instead of a line every 50 files.
  - A new line, `Matching occurrences to components…`, shows the part of the scan that used to print nothing.
  - In a terminal, the progress line is cut to the terminal's width, so a narrow window no longer leaves a trail of half-rewritten lines, and a warning no longer lands on the end of it.
  - An upload ends with `Uploaded the scan of <commit>: <url>` instead of an internal scan ID, and the summary no longer repeats the advice the warning above it already gives.

- [#48](https://github.com/scoutui/scout/pull/48) [`473263d`](https://github.com/scoutui/scout/commit/473263d47b81cec89e8c76e7580cca4cd1c281c6) Thanks [@siggerzz](https://github.com/siggerzz)! - In a Vue app that uses `unplugin-vue-components`, the scan now reads the `components.d.ts` the plugin writes, at the top of the app or in `src/`. Components used in a template without an import are now counted for their package or file: with Element Plus's resolver, `<el-button>` is Element Plus's `ElButton` rather than a web component with no package, and `<router-view>` is vue-router's `RouterView`.

## 0.2.0

### Minor Changes

- [#46](https://github.com/scoutui/scout/pull/46) [`85aec8f`](https://github.com/scoutui/scout/commit/85aec8f8643d87c26979bfd1f9730a37b5785749) Thanks [@siggerzz](https://github.com/siggerzz)! - New `scout backfill` command: scans past commits on the branch the dashboard tracks, one per week for the last six months (`--since` to choose), and uploads them, so a repo's charts show its history straight away. It installs each commit in a temporary checkout and never touches yours.

  New optional `install` field in `scout.config.json`: the command `scout backfill` runs to install a commit, for repos where it can't work it out from the lockfile.

### Patch Changes

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan` now checks everything that would stop the upload before it scans, and stops with one line saying what to fix:

  - The commit must be on the branch the dashboard tracks, with no uncommitted changes and the clone's full history.
  - A commit the dashboard already has is skipped without scanning.

  Also:

  - `scout auth login` checks the CLI version before you sign in.
  - The upload and skip lines and the dashboard's warnings print under `--quiet`, and some errors link to a page that explains them.
  - A remote that uses an SSH host alias or a git `insteadOf` rewrite is recorded under its real address.
  - A package listed only in `peerDependencies` or `optionalDependencies` no longer stops the upload when it isn't installed.
  - An uploaded scan records the branch the dashboard tracks and where the commit sits on it (`repo.branch`, `repo.branchPosition`).
  - A CI job needs to know which branch the dashboard tracks: set `branch` in `scout.config.json`, or run `git remote set-head origin --auto` after checkout.

- [#29](https://github.com/scoutui/scout/pull/29) [`156c6a9`](https://github.com/scoutui/scout/commit/156c6a91cb905807999f51116628977fb56e990f) Thanks [@siggerzz](https://github.com/siggerzz)! - Includes security fixes in its dependencies.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The package now includes a CycloneDX software bill of materials at `dist/sbom.cdx.json`, listing the third-party packages bundled into the CLI and the ones it installs. Each release also attaches it to its GitHub Release.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The package now includes Scout's MIT licence.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init` now suggests the same repository name for a Bitbucket Data Center or Azure DevOps clone whether its remote is SSH or HTTPS.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init` now asks for your dashboard's address, the repository's name on the dashboard (suggesting `owner/name` from the git remote) and the branch the dashboard tracks, and saves them in `scout.config.json`. With several remotes and none called `origin` or `upstream`, it asks which one the dashboard follows and saves the answer in that clone's git config as `scout.remote`. It no longer asks for an output path. `scout auth login`, `status` and `logout` read the dashboard's address from `scout.config.json`, so teammates don't have to type it. In a clone with an `upstream` remote, the scan records that remote instead of `origin`, and a remote address with a password or token in it is recorded without them.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init` now suggests the owner and name for a clone whose SSH remote is an `ssh://` URL or uses a user other than `git`, as it does for other remotes.

- [#43](https://github.com/scoutui/scout/pull/43) [`b074eaa`](https://github.com/scoutui/scout/commit/b074eaa8f843964977429864e0f5b7079d3325f2) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init --framework vue`, or picking only Vue when `init` asks, now writes an `include` that finds your files: `src/**/*.{js,jsx,ts,tsx,vue}`. Before, it wrote `src/**/*.{vue}`, which matched no files, so the scan found nothing. Scout reads your `.ts` and `.js` files as well as `.vue` ones, because components imported through an `index.ts` are only credited to the right `.vue` file when Scout can read the index. If you ran `init` for Vue before this release, change `include` in `scout.config.json` to `src/**/*.{js,jsx,ts,tsx,vue}`.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Errors now print one line under `Error:`, without a stack trace, and warnings print under `Warning:` in plain words. Add `--debug`, or set `SCOUTUI_DEBUG=1`, to see the detail behind an error, such as the dashboard's reply, and the counts of usages the scan couldn't match. `scout scan` outside a git repository, in a repository with no commits, and `scout init` over an existing config now say what to do. A failed upload prints one line, and the CLI says once that it's waiting for the dashboard. In a shallow clone, the scan now warns and records no first commit, instead of recording the oldest fetched commit as the first.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Scan files no longer include `depth` on each occurrence. Nothing read it, and the dashboard reads scans with or without it. `scout scan` also no longer prints a "Walking" progress line, which counted a pass that did no work.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - If `scout scan` ever builds a scan file that fails its own format check, it now says in one line that this is a bug in Scout and where to report it, instead of printing a stack trace. It still exits with code `1` and writes no scan file. Scans are otherwise byte for byte the same.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan` now uploads to the dashboard. To scan without uploading, run `scout scan --dry-run`: it writes `scout-scan.json` next to the config and doesn't contact the dashboard.

  - `--upload`, `--output` and `--commit-date` are gone, and so is the config's `output` field. A config with a field Scout doesn't use, such as `output` or a misspelt name, stops the scan with a line naming the field.
  - An upload no longer writes a scan file.
  - New configs point `$schema` at the schema published with the CLI, so editors suggest its fields. In an existing `scout.config.json`, change `$schema` to `https://unpkg.com/@scoutui/cli/schema/config.schema.json`.
  - The summary after a scan is shorter, and its counts match the dashboard's.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Updates the YAML, URL and glob libraries bundled into the CLI to versions without known vulnerabilities. A crafted `pnpm-workspace.yaml` could make `scout scan` use excessive CPU, and the URL library used for config validation could misread some hosts.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The CLI now protects your sign-in and your files more carefully:

  - Hosts must use `https://`. Plain `http://` still works for `localhost`, `127.0.0.1` and `[::1]`.
  - `auth login` opens your browser only for a link on the host you're signing in to. Otherwise, open the printed link yourself.
  - `scout scan --dry-run` won't write `scout-scan.json` through a symbolic link to a file outside the config's folder.

## 0.1.0

First public release. `scout scan` reads a React or Vue repository, web components included, and writes a JSON file that lists every component the repo uses and every place it uses it. `scout init` sets up a repo's `scout.config.json`, and after `scout auth login`, `scout scan --upload` sends each scan to your team's Scout dashboard.
