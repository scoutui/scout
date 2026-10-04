# @scoutui/cli

## 0.3.0

### Minor Changes

- [#62](https://github.com/scoutui/scout/pull/62) [`1078322`](https://github.com/scoutui/scout/commit/1078322615b83dbb6858fa061462bb7cf33c12c1) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout auth login` and `scout auth status` show your role on the dashboard: Viewer, Editor or Admin. If you're a Viewer, `scout scan` and `scout backfill` stop before scanning with "You can view this dashboard but not upload to it. Ask an admin to make you an Editor." The same line appears if your role changes during a scan or backfill. Older CLIs also stop before scanning with that line; if the role changes during an upload, they say the dashboard returned an error.

- [#76](https://github.com/scoutui/scout/pull/76) [`a1458b1`](https://github.com/scoutui/scout/commit/a1458b1252575abd357e19e16ff73f74ce2a5540) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init` now sets up a scan of the whole repository:

  - It no longer writes `include`, or the test and story patterns in `exclude`. Without `include`, the scan reads every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file below the config's folder, and it leaves out tests, stories and `node_modules` on its own. `exclude` is always written, as `[]` when nothing is left out.
  - In a monorepo, it asks `Leave any packages or folders out of the scan?` and lists the workspace packages and the top-level folders outside them. The ones you pick are written to `exclude`. To skip the question, pass `--exclude <folder>` once for each folder.
  - Run in a workspace package's folder, when the repository root has no config yet, it asks `Scan the whole repository instead of only this package?`. Yes writes the config at the root. With `--yes`, it writes the config in the current folder and prints the `scout init --output` command that writes it at the root instead.
  - Its questions open with the Scout wordmark, `scout <version> · init`, and it ends with `Wrote scout.config.json. Run scout scan --dry-run to try it, then scout scan to upload.` Outside a git repository, it warns first that `scout scan` needs one.
  - `--framework` and the question about frameworks are gone, so `scout init --framework` now stops with an unknown-option error. Drop the flag: the scan reads React and Vue files alike. To scan only some files, set `include` in `scout.config.json`.

  An existing `scout.config.json` is unchanged.

- [#57](https://github.com/scoutui/scout/pull/57) [`b31629d`](https://github.com/scoutui/scout/commit/b31629d5fd3e65a6a2d8ded8cb9c7dc1fb34b475) Thanks [@siggerzz](https://github.com/siggerzz)! - In a terminal, the CLI's output now has one look. `scan`, `backfill` and `--help` start with the wordmark, `scout <version>`: `scan` adds the repo and commit, and `backfill` the repo. Numbers stand out, Scout's teal marks links and, in help, commands and flags, and a line saying something went well starts with `✓`, a warning with `!` and an error with `✗`. While `scan` reads files a spinner turns beside a progress bar, and the upload shows a spinner until the dashboard has the scan. `backfill` shows one line for the commit it's working on, with what it's doing, a bar of the commits done and the count, in place of a `Scanning` line per commit, and ends with the link on a line of its own. `auth login` turns a spinner while it waits for you to approve the sign-in.

  None of this appears in CI, when output goes to a file or another command, or with `NO_COLOR`, so logs read as before, apart from these changes:

  - The scan summary lists the most used components only after `scout scan --dry-run` in a terminal. After an upload, and in CI, the summary is the counts, so the dashboard link is the last line.
  - `auth login` ends with `✓ Signed in as <email> to <host>.`, naming the dashboard. With `NO_COLOR`, nothing turns while it waits.
  - Colour stays off in CI unless `FORCE_COLOR` is set.
  - The scan summary groups thousands, as the dashboard does: `1,191 components, 3,925 uses`.

- [#107](https://github.com/scoutui/scout/pull/107) [`fd3a53f`](https://github.com/scoutui/scout/commit/fd3a53f83ed1837d83e3d512bd8a055bda47d497) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan` now reads `.mjs`, `.cjs`, `.mts` and `.cts` files. A config without `include` scans them, and an import such as `./theme.mjs` finds `theme.mts`. Type declaration files (`.d.mts`, `.d.cts`) are left out, like `.d.ts`. An installed package whose `.mts` or `.cts` file re-exports a component is now followed to the package that declares it.

  A file the scan can't read or parse is now listed in the scan file as a `file-not-parsed` diagnostic, and prints `Warning: Skipped <file>: couldn't parse it (<reason>).` or `couldn't read it.` at the end of the scan instead of as it reads. The summary's file count no longer includes these files, or files `include` matches with an extension the scan doesn't read. The warning for a file with syntax errors the scan reads past now names the file by its path in the repository, as the skipped-file warning does.

  With no `include` and nothing to scan, the error now reads `No JavaScript, TypeScript or Vue files to scan in <folder>.`

- [#53](https://github.com/scoutui/scout/pull/53) [`a2bfa4c`](https://github.com/scoutui/scout/commit/a2bfa4c77a0e3109041ecd5b1557e5f33a77c637) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan` now stops when `include` matches no files, instead of reporting an empty scan as a success. It prints `Error: No files match "include" in ./scout.config.json (<patterns>). Point it at your source files and scan again.` and exits `2`, on a dry run and an upload alike. An upload used to scan first and then exit `1`; it now stops before contacting the dashboard.

- [#60](https://github.com/scoutui/scout/pull/60) [`876263d`](https://github.com/scoutui/scout/commit/876263d3fa5877f69f28c7060509b35327b892ae) Thanks [@siggerzz](https://github.com/siggerzz)! - The scan now counts more of the components your code imports, and names more of them correctly:

  - After `const AliasedStar = Icons.Star`, with `Icons` imported from a package, `<AliasedStar />` counts as `Icons.Star`, the same as `<Icons.Star />`.
  - Members of `export * as Shapes from "./shapes"`, such as `<Shapes.Circle />`, count for the files that declare them.
  - More components imported through a folder outside `include`, or matched by `exclude`, now get the same name, and the same file or package, as when that folder is scanned:
    - A Vue component keeps its own name instead of `default`, and the scan no longer warns "Stopped following re-exports" for it.
    - Members of `export * as Shapes from …`, or of `import * as Shapes from …` exported again with `export { Shapes }`, in that folder count for the file or package that declares them.
    - A component from `export * from` a package counts for the package instead of a file inside `node_modules`.

  A folder below the config's folder that holds its own git repository, such as a submodule or another clone, is no longer scanned as part of your repository. If `include` only matches files in such a folder, the scan stops and names it.

- [#61](https://github.com/scoutui/scout/pull/61) [`c080a6b`](https://github.com/scoutui/scout/commit/c080a6b47a10e05d426962f0bfecd8aaf0f782e8) Thanks [@siggerzz](https://github.com/siggerzz)! - `include` in `scout.config.json` is now optional, so a scan can cover the whole repository:

  - Without `include`, `scout scan` reads every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file below the config's folder, apart from files `.gitignore` ignores and anything `exclude` matches.
  - Every scan now leaves out test, spec and story files, `__tests__` folders, type declaration files (`.d.ts`) and `node_modules`, whatever `include` says. If your `include` reached any of these files, the scan counts fewer uses.
  - A folder or file in `exclude` that doesn't exist now prints a warning, such as `Warning: "apps/playground" in exclude matches nothing. Update or remove it in ./scout.config.json.`, and the scan carries on.
  - Components defined outside every workspace package (in a repo that isn't a monorepo, all of them) now record the root package as their package: the `name` in the root `package.json`, or the repo id when it has none. The dashboard lists them under that package, and a lifecycle record on that package covers them. A tag whose pattern matches that name counts them too: `@acme/*` matches an app named `@acme/web`, so list a library's packages by their exact names. Scans uploaded before this release keep no package for them. If you rename the package, its components are listed under the new name from the next scan.
  - When a scan covers more than one package, each use records the package it sits in, by name. Every scan file also records what the scan covered: the config's folder, its `include` and `exclude`, and the packages it read.
  - To scan past commits again with these changes and your current config, run `scout backfill --rescan --since <date>`.

- [#57](https://github.com/scoutui/scout/pull/57) [`b31629d`](https://github.com/scoutui/scout/commit/b31629d5fd3e65a6a2d8ded8cb9c7dc1fb34b475) Thanks [@siggerzz](https://github.com/siggerzz)! - In a terminal, the CLI now says when a newer version is available, on the line under the wordmark (or first, for a command without one), with the command that gets it for your repo's package manager, for example `Scout 0.3.0 is available. Update with npm i -D @scoutui/cli@latest.` If the repo doesn't list the CLI yet, the line says `Install it with …` instead. When the dashboard you last uploaded to can't read the new version's scans yet, the notice says so instead, and to keep the current version until the dashboard is upgraded, with a link to the upgrade guide. `--help` lists `SCOUTUI_NO_UPDATE_CHECK=1`, which turns the notice off. Scout asks the npm registry at most once a day, in the background, so the line never holds up a command and shows what it heard on the next run. It says nothing when it can't reach the registry. The check is off in CI, when output goes to a file or another command, with `--quiet`, and when `SCOUTUI_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER` is set.

### Patch Changes

- [#88](https://github.com/scoutui/scout/pull/88) [`22dfa54`](https://github.com/scoutui/scout/commit/22dfa5461ead6af34bd34ca9f46b4d6f1c27551f) Thanks [@siggerzz](https://github.com/siggerzz)! - A path alias that points into an installed package now credits that package's component, whatever the alias looks like. Before, an alias such as `"@ds": ["node_modules/@acme/ui/index.js"]` in tsconfig `paths` left its uses unmatched as `module-not-found`, while `"@ds/ui"` with the same target credited `@acme/ui`. An alias to a file outside the repository that no installed package holds is still `module-not-found`.

- [#87](https://github.com/scoutui/scout/pull/87) [`66386d2`](https://github.com/scoutui/scout/commit/66386d2cff271fbfc55ff96384cca01427ca5f89) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout auth login` prints the sign-in link with your code in it, such as `https://scout.example.com/login/device?code=HJKM-4TQX`, so it works when no browser opens. It says `Opening your browser…` rather than `Opened your browser…`, because it can't tell whether a browser opened. And when you have no default dashboard, for example after signing out of it, signing in to a dashboard you're already signed in to now makes it the default, so `scout auth status` and `scout scan` find it again without `--host`.

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

- [#69](https://github.com/scoutui/scout/pull/69) [`cb445f3`](https://github.com/scoutui/scout/commit/cb445f3f0bf1ae4b4b9b9030754cd4f02ef046b9) Thanks [@siggerzz](https://github.com/siggerzz)! - Clearer messages:

  - A config error names the field and what's wrong with it, such as `"include" in ./scout.config.json can't be an empty list.`, in place of the schema's raw output. A config with the old `manifests` field gets the same message as any other field Scout doesn't use.
  - Commands in messages print without backticks, like the rest of the CLI's messages.
  - `scout auth login` says `To sign in, open:`. When the request is denied on the dashboard, it says so and how to try again.
  - An unknown option with no close match points to the command's `--help`.

- [#91](https://github.com/scoutui/scout/pull/91) [`d294cbb`](https://github.com/scoutui/scout/commit/d294cbbc04052b377a6d00fafc4fd5f3331554b3) Thanks [@siggerzz](https://github.com/siggerzz)! - When the config is in a folder below the repository root, the scan file's `cycle-detected` and `chain-too-deep` paths and an `auto-import-stale-entry`'s `target` are now relative to the repository root, like every other path in it. Before, they were relative to the config's folder or the monorepo root.

- [#77](https://github.com/scoutui/scout/pull/77) [`a6e4e55`](https://github.com/scoutui/scout/commit/a6e4e55c49fe06e4eb805da5c12e43381cc92783) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init` run in a folder inside the repository no longer writes a second config when the repository root already has one. It writes nothing and names the root's config and the folder to run `scout scan` in: `This repository already has a config: ../../scout.config.json. Run scout scan in ../.. to use it.` To write a config somewhere else anyway, pass `--output`.

- [#90](https://github.com/scoutui/scout/pull/90) [`6667e6c`](https://github.com/scoutui/scout/commit/6667e6c6ee47cacf43904092a20204fee1c0960d) Thanks [@siggerzz](https://github.com/siggerzz)! - In React, a prop named `on` plus a capital letter with a written value, such as `onLabel="On"`, is now recorded as a prop with that value instead of as an event. Handlers such as `onClick={save}` are still counted as events. In Vue, a handler bound as a prop, such as `:onClick="save"`, is now counted as an event too, as it is in React.

- [#55](https://github.com/scoutui/scout/pull/55) [`2c6e2d2`](https://github.com/scoutui/scout/commit/2c6e2d2d9c7eddbe64887eb5d50fb1ee4c633fdf) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan`'s progress is easier to read:

  - In a CI log, the file count prints once as the scan starts and then at most every 10 seconds, instead of a line every 50 files.
  - A new line, `Matching uses to components…`, shows the part of the scan that used to print nothing.
  - In a terminal, the progress line is cut to the terminal's width, so a narrow window no longer leaves a trail of half-rewritten lines, and a warning no longer lands on the end of it.
  - An upload ends with `Uploaded the scan of <commit>: <url>` instead of an internal scan ID, and the summary no longer repeats the advice the warning above it already gives.

- [#92](https://github.com/scoutui/scout/pull/92) [`aee5805`](https://github.com/scoutui/scout/commit/aee5805f1e8f9a10f76b8097d9b644cef3c84b51) Thanks [@siggerzz](https://github.com/siggerzz)! - React and Vue scans now agree in two places:

  - A file that isn't code is never a component. In a Vue file, a tag bound to an import such as `import Logo from "./logo.svg"` is no longer counted as a component defined in `logo.svg`, the same as in a React file.
  - A column counts from 1 in React files, as it already did in Vue files and as it does in your editor. This moves the `column` of every use in a React file by one, along with its `occurrenceId`, which is computed from the column. A React component's `definition`, and the `path:line:column` in a scan warning, move by one too.

- [#83](https://github.com/scoutui/scout/pull/83) [`f9f1c3c`](https://github.com/scoutui/scout/commit/f9f1c3ce0e0c80899642d5b47eeec63fdc3aab2c) Thanks [@siggerzz](https://github.com/siggerzz)! - Fixes four problems when a scan starts:

  - `scout scan` run in a workspace package of a monorepo that installs with Yarn Plug'n'Play now stops with the Plug'n'Play error, as it does at the monorepo root. Before, it scanned and reported every package as not installed.
  - When `tsconfigPath` names a file that doesn't exist, the scan warns about it and no longer prints `Path aliases: <that file>` as if it used it.
  - `--config` pointing at a folder now stops with `<folder> is a folder. Pass the config file to --config, such as <folder>/scout.config.json.` and exit code `2`, instead of an unexpected error.
  - With no `repoId` in the config, a git remote ending in `/`, such as `https://github.com/acme/storefront/`, now gives the repository name `storefront`, as the same remote without the slash does, instead of the folder's name.

- [#59](https://github.com/scoutui/scout/pull/59) [`4b825f6`](https://github.com/scoutui/scout/commit/4b825f6141b60e4da57ff3c6502cdf3803db9fe8) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan` now calls each place a component is used a use, as the dashboard does: in its summary (`260 components, 831 uses`), in its warnings and in the line about uses it couldn't match. The scan file and `--json` output don't change.

  Two lines now say what they count:

  - With `--debug`, the count of renders Scout couldn't follow reads `5 renders couldn't be followed to a component and weren't counted as uses.` It used to read like the summary's unmatched uses, which are a different count.
  - `scan --upload` refuses a scan with no uses with `Couldn't upload the scan: no uses were found.`, in place of `no components were found`.

- [#48](https://github.com/scoutui/scout/pull/48) [`473263d`](https://github.com/scoutui/scout/commit/473263d47b81cec89e8c76e7580cca4cd1c281c6) Thanks [@siggerzz](https://github.com/siggerzz)! - In a Vue app that uses `unplugin-vue-components`, the scan now reads the `components.d.ts` the plugin writes, at the top of the app or in `src/`. Components used in a template without an import are now counted for their package or file: with Element Plus's resolver, `<el-button>` is Element Plus's `ElButton` rather than a web component with no package, and `<router-view>` is vue-router's `RouterView`.

- [#94](https://github.com/scoutui/scout/pull/94) [`42c2721`](https://github.com/scoutui/scout/commit/42c2721bc8f122e0cf405ebad09769d8c576eb9d) Thanks [@siggerzz](https://github.com/siggerzz)! - In a Vue file with both `<script>` and `<script setup>`, a component imported in the plain `<script>` is now counted for that component, written `<LineItem>` or `<line-item>`, as it is when imported in `<script setup>`. Before, `<LineItem>` wasn't counted at all and `<line-item>` was counted as a web component with no package.

  A kebab-case tag such as `<lazy-panel>` whose name the file's own script declares (`const LazyPanel = defineAsyncComponent(…)`) is no longer counted as a web component with no package. It isn't counted, the same as `<LazyPanel>`.

  A Vue template tag the scan can't follow to a component, such as an imported icon made by a factory function, now adds an `unresolved-reference` or `late-bound-render` entry to the scan file's diagnostics, as a React tag does. These are `info` entries, shown as counts with `--debug`, and no use counts change.

- [#84](https://github.com/scoutui/scout/pull/84) [`4af6512`](https://github.com/scoutui/scout/commit/4af6512fc353b1dcd84f0420131f2aa24b647994) Thanks [@siggerzz](https://github.com/siggerzz)! - Web components now get their package's version when the package is installed only inside another package's folder, as npm and pnpm do for a dependency of a dependency. Before, they had no version and the dashboard listed the package as unversioned.

  A scan now warns when a package's Custom Elements Manifest is missing or isn't valid JSON, instead of leaving its tags without a package and saying nothing.

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
