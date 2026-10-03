---
description: "Every command, flag, default, exit code and environment variable the Scout CLI accepts."
sidebar_label: "CLI"
---

# CLI reference

```
scout <command> [options]
```

## Commands

| Command | What it does |
| --- | --- |
| [`scan`](#scan) | Scans the repo and uploads the scan to the dashboard. With `--dry-run`, writes the [artifact](/docs/reference/glossary#artifact) to `scout-scan.json` instead. |
| [`backfill`](#backfill) | Scans past commits on the tracked branch, one a week, and uploads them to the dashboard. |
| [`init`](#init) | Writes a starter `scout.config.json`. |
| [`auth`](#auth) | Signs in to a dashboard, signs out, or shows who you are signed in as. Takes a subcommand: `login`, `logout` or `status`. |

## Global flags

| Flag | Behavior |
| --- | --- |
| `--help`, `-h` | Prints help and exits `0`. After a command, prints that command's help. |
| `--version`, `-v` | Prints the CLI version and exits `0`. |
| `--debug` | Prints the detail behind an error or warning on the lines below it, such as the dashboard's reply or git's own message, and the counts of usages a scan couldn't match. Works before or after the command. |

Every error prints one line starting `Error:`, and every warning one line starting `Warning:`, both on stderr. An error that isn't one of the expected ones prints `Error: Scout stopped unexpectedly (<reason>).` and asks you to run the command again with `--debug` and report the output.

An unknown flag, a value on an on/off flag (`--quiet=true`), or an extra word after `scan`, `backfill` or `init` is an error that exits `2`. For a misspelled flag, the message suggests the closest one.

## Prompts

`init` and `auth` can ask questions in the terminal. *Prompts are on* when all of these hold:

- stdin and stdout are both terminals.
- `CI` is unset, empty, `false` or `0`.
- For `init`, `--yes` is not passed.

With prompts off, a command never waits for input. It uses its flags and defaults, or exits with an error.

## `scan`

```
scout scan [options]
```

Most runs need no flags: `scout scan` reads `scout.config.json` in the current directory, [checks that the dashboard can take the scan](#upload-flags), scans, uploads the scan and waits for the dashboard to publish it. It writes no file. To scan without uploading, run `scout scan --dry-run`.

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--config <path>` | path | `./scout.config.json` | Config file to read. Relative to the current directory. |
| `--dry-run` | none | off | Scans without uploading, and writes the artifact to `scout-scan.json` in the config file's folder, replacing any earlier one. Runs none of the [checks before the scan](#upload-flags) and never contacts the dashboard. Ends with `Wrote scout-scan.json (not uploaded).`, the path relative to the current directory. |
| `--quiet` | none | off | Hides progress, the summary, most warnings and the `Waiting for the dashboard` line. Errors, a few important warnings, the dashboard's warnings and the line saying what happened to the scan still print: the upload's result, or `Wrote scout-scan.json (not uploaded).` on a dry run. |

The config file must be inside a git repository with at least one commit. Otherwise `scan` exits `1` with `Error: Couldn't scan: <folder> isn't inside a git repository. Run scout scan from a git checkout.`, or `Error: Couldn't scan: this repository has no commits yet. Commit your files and try again.` In a shallow clone, a dry run warns `Warning: This checkout doesn't have the full history. Run git fetch --unshallow and scan again.` and records no [`initialCommit`](/docs/reference/artifact#meta). An upload refuses a shallow clone instead (see [Upload flags](#upload-flags)).

If `include` matches no files, or `exclude` and `.gitignore` leave none, `scan` exits `2` before it scans or contacts the dashboard, on a dry run too. It prints `Error: No files match "include" in <config path> (<patterns>). Point it at your source files and scan again.` `<config path>` is the `--config` value (`./scout.config.json` by default).

`scan` needs the repo's dependencies installed. Components from a declared package that isn't installed aren't found: each place that uses one is recorded as an [unresolved occurrence](/docs/reference/glossary#unresolved-occurrence). A package in `dependencies` or `devDependencies` that isn't installed stops `scan` before it scans; a dry run scans anyway. One listed only in `peerDependencies` or `optionalDependencies` doesn't stop it: the scan uploads with its occurrences unresolved.

### Upload flags

These change where and how `scan` uploads. See [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads) and [Run a scan and upload in CI](/docs/guides/run-in-ci).

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--rescan` | none | off | Replaces the dashboard's scan of this commit if it has one. With `--dry-run`, exits `2` with `Error: --rescan and --dry-run can't be used together: --dry-run doesn't upload.` |
| `--host <url>` | URL | see [Host resolution](#host-resolution) | Dashboard to upload to. Ignored with `--dry-run`. |

Before it scans, `scan` checks these, in this order, and stops at the first that fails. It prints the message and exits `1` without scanning. A dry run skips them all:

| Problem | Message |
| --- | --- |
| The checkout has no remote | `Error: Couldn't upload the scan: this checkout has no remote, so Scout can't tell which repository it is. Add one with git remote add origin <url> and try again.` |
| The checkout has several remotes, none of them `origin` or `upstream`, and none chosen with `git config scout.remote` | `Error: Couldn't upload the scan: this checkout has several remotes and none is called origin, so Scout can't tell which one the dashboard follows. Choose one with git config scout.remote <name>, for example git config scout.remote <first remote>.` |
| The checkout is a shallow clone | `Error: Couldn't upload the scan: this checkout doesn't have the full history. Run git fetch --unshallow and try again.` |
| The config sets no `branch`, and the clone has no `<remote>/HEAD` recorded, or it names a branch the clone doesn't have | `Error: Couldn't upload the scan: couldn't tell which branch the dashboard tracks. Run git remote set-head <remote> --auto and try again.` |
| The config's `branch` isn't on the remote | `Error: Couldn't upload the scan: there's no <branch> on <remote>. If the branch was renamed, update "branch" in scout.config.json.` |
| You're on the tracked branch, and the commit isn't pushed | `Error: Couldn't upload the scan: this commit isn't on <remote>/<branch> yet. Push it and try again.` |
| You're on another branch, and the commit isn't on the tracked branch | `Error: Couldn't upload the scan: you're on <checked-out branch>, and the dashboard tracks <branch>. Switch to <branch> and try again.` |
| On a detached HEAD, the commit isn't on the tracked branch | `Error: Couldn't upload the scan: commit <commit> isn't on <branch>. Check out <branch> and try again.` |
| A tracked file has uncommitted changes, or a file the scan reads isn't committed. `--debug` lists the files. | `Error: Couldn't upload the scan: you have uncommitted changes. Commit or stash them and try again.` |
| No upload host is set, or you aren't signed in to it | `Error: Couldn't upload the scan: no dashboard address is set. Add "host" to scout.config.json, or run scout scan --dry-run to scan without uploading.` or `Error: Not signed in to <host>.`, followed by what to run. See [Host resolution](#host-resolution). |
| The dashboard refuses the scan: this CLI's version, the repository name, or a `--rescan` from an older CLI | The dashboard's own line, such as `Error: Couldn't upload the scan: <commit> was scanned with a newer CLI (<version>). Upgrade the CLI to <version> or newer, or run npx @scoutui/cli@<version> scan --rescan.` |
| A package in `dependencies` or `devDependencies` isn't installed | `Error: Couldn't upload the scan: some dependencies aren't installed. Install them and try again.` |
| The scanned folder is a Nuxt app that hasn't been prepared | `Error: Couldn't upload the scan: this Nuxt app hasn't been prepared. Run npx nuxt prepare and try again.` |

`<remote>` is the remote the scan follows (see [`repo.gitRemote`](/docs/reference/artifact#meta)) and `<branch>` the branch the dashboard tracks: `branch` in the config, else the remote's default branch as your clone recorded it. A commit passes when it's on that branch's first-parent history, whatever is checked out.

When a check before the scan fails, nothing is uploaded and no file is written.

After the scan, `scan` refuses a scan that found no components: `Error: Couldn't upload the scan: no components were found. Check "include" in <config path> and try again.` `<config path>` is the `--config` value, `./scout.config.json` by default.

If the dashboard already has a scan of this commit, `scan` prints `Commit <commit> is already on the dashboard: <url>. Run scout scan --rescan to scan it again.` and exits `0` without scanning, unless the dashboard couldn't prepare that scan: then the upload replaces it. Some error lines end with `See <url>`: the page that explains that problem.

### Rarely needed flags

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--repo-id <value>` | string | the config's `repoId`, else derived from the git remote (see [Repo identity](/docs/reference/config#repo-identity)) | [Repo id](/docs/reference/glossary#repo-id) written into the artifact. Replaces the config's `repoId`. |
| `--repo-root <dir>` | path | the top of the git repository that holds the config file | Folder that file paths in the artifact are relative to. Relative to the current directory. |

## `backfill`

```
scout backfill [options]
```

Scans one commit a week of the tracked branch's history, newest first, and uploads each scan to the dashboard. It asks the dashboard which of those commits it already has, then for each of the others: checks the commit out in a temporary folder, installs its dependencies, scans it with the current config file and uploads the scan. It never changes your checkout and writes no file. See [Fill in a repo's history](/docs/guides/fill-in-a-repos-history).

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--since <date>` | date, `YYYY-MM-DD` | six months before today | Earliest commit date to pick. Any other form, or a date that doesn't exist, exits `2` with `Error: --since must be a date in the form YYYY-MM-DD, for example 2026-04-02.` |
| `--rescan` | none | off | Also scans the commits the dashboard already has, replacing their scans. |
| `--config <path>` | path | `./scout.config.json` | Config file to read. Relative to the current directory. |
| `--host <url>` | URL | see [Host resolution](#host-resolution) | Dashboard to upload to. |
| `--quiet` | none | off | Hides the [progress lines](#backfill-output): the `Found` line, the `Scanning` lines and the `slow down` line. Everything else still prints. |

With [`--debug`](#global-flags), `backfill` also prints each install's and each scan's output, `Waiting for the dashboard to process the scan…` once for each upload, and the detail behind a skip, such as the files an install changed or `The install was stopped after 10 minutes.`

Before it scans any commit, `backfill` stops with the same messages as `scan` when:

- the config file is missing or invalid (exit `2`).
- the config's folder isn't in a git repository with a commit, or one of the remote, full-history or tracked-branch checks in [Upload flags](#upload-flags) fails (exit `1`).
- no host is set, you aren't signed in, or the dashboard refuses or fails the request (exit `1`).

It doesn't check which branch is checked out, or for uncommitted changes.

### Which commits it picks

- The latest commit on `<remote>/<branch>`, whatever its date. `backfill` reads the branch as the clone last fetched it, and doesn't fetch. `<remote>` and `<branch>` are the ones `scan` uploads to.
- Then, for each earlier week from Monday to Sunday, the newest commit of that week on the branch's first-parent history whose commit date is on or after `--since`. A commit that came into the branch through a merge is never picked; the merge commit can be.
- Commits the dashboard already has are counted as already on the dashboard and not scanned, unless `--rescan` is passed.

Every commit is scanned with the current config file, so commits from before the config existed are scanned too. The config's folder must exist at the latest commit.

### How it installs each commit

- With [`install`](/docs/reference/config#backfill-fields) set, it runs that command through the shell from the top of the repository, and nothing else.
- Otherwise, it installs from the nearest `pnpm-lock.yaml`, `yarn.lock` or `package-lock.json` in the config's folder or a folder above it, without running install scripts. npm projects install with `npm ci`, using your own `npm`. Yarn and pnpm projects install through Corepack, with the version that the `package.json` beside the lockfile names in `packageManager`, else the first exact version (for Yarn, one whose major fits the lockfile: 1 for a Yarn 1 lockfile, 2 or later otherwise) from its `devEngines.packageManager`, then its `volta`, then mise or asdf's `.tool-versions` in the lockfile's folder or a folder above it, else its `devEngines.packageManager` range, else a version that writes that lockfile. `backfill` downloads Corepack once per run, using your npm settings, the first time a commit needs it. Then, for a Nuxt app, it runs `nuxt prepare`.

Installs run without `SCOUTUI_TOKEN` in their environment.

### Skips {#backfill-skips}

A commit that can't be scanned prints `Warning: Skipped <commit> (<date>): <reason>`, and the run goes on to the next commit.

| Reason | When | Exit `1` |
| --- | --- | --- |
| `npm ci failed.`, `yarn install failed.` or `pnpm install failed.` | The install from the lockfile failed, or ran out of time. | yes |
| `the install command in scout.config.json failed.` | The `install` command failed, or ran out of time. | yes |
| `the install changed tracked files. Set "install" in scout.config.json to the command this repo installs with.` | The install changed a file git tracks. | yes |
| `some dependencies are missing after the install.` | A package in `dependencies` or `devDependencies` isn't installed. | yes |
| `nuxt prepare failed.` | `nuxt prepare` failed, or the Nuxt app still isn't prepared after the install. | yes |
| `there's no lockfile to install from.` | No `install` is set, and neither the config's folder nor a folder above it has a `pnpm-lock.yaml`, `yarn.lock` or `package-lock.json`. | yes |
| `it installs with Yarn Plug'n'Play, which Scout can't read.` | The install used Yarn Plug'n'Play. | no |
| `the scan found no components.` | The scan found no components in the files `include` matches. | no |
| The dashboard's reason | The dashboard refused the commit's scan, before the scan or on upload. | no |

The first seven are *install skips*. Three in a row stop the run (see [Stop lines](#backfill-stop-lines)); an upload starts the count again. A scan with no components and a dashboard refusal neither count nor start it again. A skip marked *Exit `1`* makes the run exit `1`, unless it is one of the three that stopped the run at the history line.

### Stop lines {#backfill-stop-lines}

| Line | When | Exit code |
| --- | --- | --- |
| `3 commits in a row wouldn't install, so the charts start at <date>. Check the lines above, or set "install" in scout.config.json.` | Three install skips in a row, with at least one commit of the range on the dashboard. `<date>` is the oldest of those commits' dates. | `0`, or `1` after an earlier skip marked *Exit `1`* |
| `<folder> doesn't exist before <date>, so the charts start there.` | The config's folder isn't in the commit. `<date>` is the date of the next newer picked commit that has the folder. | `0`, or `1` after a skip marked *Exit `1`* |
| `Error: Couldn't install the 3 newest commits, so nothing was uploaded. Check the lines above, or set "install" in scout.config.json.` | Three install skips in a row, with no commit of the range on the dashboard. | `1` |
| `Error: <folder> isn't on <remote>/<branch> yet, so there's nothing to backfill. Merge it, run git fetch, then run scout backfill again.` | The config's folder isn't in the latest commit. | `1` |
| `Error: Couldn't download Corepack, which Scout needs to install Yarn and pnpm projects. Check your connection and npm registry settings, then run scout backfill again.` | Downloading Corepack failed. `--debug` prints npm's output. | `1` |
| `Error: Couldn't scan <commit> (<date>): the scan stopped unexpectedly. Run scout backfill --debug to see how far it got.` | The scan of a commit stopped before it finished, for example because it ran out of memory. Any lines the scan printed come first. `--debug` prints the scan's progress up to where it stopped. | `1` |
| `Error: Couldn't check out <commit> (<date>) in a temporary folder. Run scout backfill --debug to see git's output.` | Git couldn't check out the commit, for example because the disk is full. `--debug` prints git's output. | `1` |
| An upload error, then `Run scout backfill again to continue: it skips what's already on the dashboard.` | An upload failed for a reason other than the dashboard refusing that commit, for example the dashboard can't be reached. | `1` |
| `Stopped. Run scout backfill again to continue: it skips what's already on the dashboard.` | Ctrl-C, the terminal closed, or the process received SIGTERM. The temporary checkout is removed first. | `130` |

`<folder>` is the config's folder, relative to the top of the repository. The first two lines are followed by the last line; the others aren't.

### Output {#backfill-output}

Progress lines print on stderr, and `--quiet` hides them:

| Line | When |
| --- | --- |
| `Found 27 commits on origin/main, one a week since 3 Apr 2026. Scout will scan all 27.` | First, unless there's nothing to scan. When some are already on the dashboard, it ends `1 is already on the dashboard, so Scout will scan 26.`; with `--rescan`, `Scout will scan all 27, replacing the 1 already on the dashboard.` |
| `Scanning <commit> (<date>), <n> of <total>…` | Before each commit. |
| `The dashboard asked Scout to slow down. Continuing in 1 minute…` | The dashboard is receiving too many uploads. `backfill` waits as long as it asks, then uploads the scan again. |

The last line prints on stdout, even with `--quiet`:

```text
Backfilled main since 3 Apr 2026: 26 uploaded, 1 already on the dashboard, 0 skipped. See https://scout.example.com/repos/storefront
```

It names the tracked branch, the `--since` date and the repo's page on the dashboard. *Already on the dashboard* counts the commits the dashboard already had, whether it said so before the scan or on upload. With `--rescan`, the line also counts the scans it replaced, after the uploads: `26 uploaded, 1 replaced, 0 already on the dashboard, 0 skipped.` Those aren't counted as already on the dashboard.

When a skip marked *Exit `1`* makes the run exit `1`, the last line is followed on stderr by `Run scout backfill --debug to retry the skipped commits and see why they failed.`, even with `--quiet`. It doesn't print when the run stops at the history line.

### Exit codes {#backfill-exit-codes}

| Code | Meaning |
| --- | --- |
| `0` | The run finished, or stopped at the history or folder line, with no skip marked *Exit `1`*. |
| `1` | A skip marked *Exit `1`*, except the three that stopped the run at the history line. A stop line starting `Error:`. A problem before the first commit: the folder isn't in a git repository, a check on the remote, history or branch failed, no host, not signed in, or the dashboard refused or failed the request. Also any unexpected error. |
| `2` | Usage or config error: an unknown flag, an extra argument, a `--since` that isn't a `YYYY-MM-DD` date, or a missing or invalid config file. |
| `130` | You stopped it with Ctrl-C or closed the terminal, or it received SIGTERM. |

## `init`

```
scout init [options]
```

Writes a config file with `$schema`, `repoId`, `include` and `exclude`, plus `host` when you give a dashboard address and `branch` when it can tell which branch the dashboard tracks. `init` never overwrites: if the file already exists, it exits `1`. When it's done, it prints `Wrote <path>. Run scout scan to scan the repo and upload the scan.`

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--output <path>` | path | `./scout.config.json` | Where to write the config file. Relative to the current directory. |
| `--repo-id <name>` | string | the owner and name from the git remote, such as `acme/checkout`, else the current directory's name | Value written to `repoId`. |
| `--host <url>` | URL | none | Dashboard address written to `host`, with `https://` added when it has no scheme. It must use `https://`, apart from `http://` on `localhost`, `127.0.0.1` and `[::1]`; any other `http://` address exits `2`. |
| `--branch <name>` | string | the remote's default branch | Branch the dashboard tracks. Written to `branch`. |
| `--framework <name>` | `react` or `vue` | none | Sets which file extensions `include` matches. Repeat the flag for both. Only used without prompts; with prompts, you pick frameworks in the prompt. |
| `-y`, `--yes` | none | off | Runs without prompts. |

### With and without prompts

See [Prompts](#prompts) for when prompts are on.

| | With prompts | Without prompts |
| --- | --- | --- |
| `host` | Asks `Dashboard address (optional)`. Leave it empty to write no `host`. | Taken from `--host`, else not written. |
| `repoId` | Asks `Repository name on the dashboard`, filled in with the `--repo-id` default. | Taken from `--repo-id`, else its default. |
| `branch` | Asks `Branch the dashboard tracks`, filled in with the remote's default branch, else the checked-out branch. | Taken from `--branch`, else the same default without asking. |
| Frameworks | Asks `Which frameworks does this repo use?`, pre-selecting whichever of `react` and `vue` your `package.json` depends on (`react` if neither). | Taken from `--framework`. |
| `include` | `src/**/*.{…}`, with the extensions of the chosen frameworks | `src/**/*.{…}`, with the extensions of the `--framework` values. With no `--framework`: `src/**/*.{ts,tsx,jsx,js,vue}`. |

A flag you pass skips its question. The remote `init` reads is the one `git config scout.remote` names, else `upstream` when there is one, else the only remote, else `origin`. With several remotes and none of them called `origin` or `upstream`:

- With prompts on, `init` asks `Which remote does the dashboard follow?` and saves your answer in this checkout's git config as `scout.remote`. It isn't in `scout.config.json`, because remote names can differ from one clone to the next.
- With prompts off, it warns `Warning: this checkout has several remotes and none is called origin, so Scout can't tell which one the dashboard follows. Choose one with git config scout.remote <name>, for example git config scout.remote github.` and uses the directory's name.

Extensions each framework adds to `include`:

| Framework | Extensions |
| --- | --- |
| `react` | `ts`, `tsx`, `js`, `jsx` |
| `vue` | `vue` |

## `auth`

```
scout auth <login|logout|status> [--host <url>]
```

| Subcommand | Behavior | Exit code |
| --- | --- | --- |
| `login` | Signs in with a code you approve in the browser, and saves the session. It opens the browser only for a link on the host you're signing in to. If you are already signed in to that host and the session still works, it prints `Already signed in as <email> to <host>.` instead. The first host you sign in to becomes your default host. | `0` signed in. `1` sign-in failed, for example the host can't be reached or the code expired or was declined. `2` no host found and prompts are off, or the host isn't `https://`. |
| `status` | Checks the session with the dashboard and prints `Signed in as <email> to <host> (session saved in the system keychain).` When the session is saved in `hosts.json`, the line ends with that file's path instead, for example `(session saved in ~/.config/scoutui/hosts.json).` | `0` signed in. `1` not signed in to that host, the session is no longer valid, or the dashboard can't check it. |
| `logout` | Ends the session on the dashboard, then deletes it from this computer. If that host was your default, you have no default until you next sign in. | `0`, including when you weren't signed in. `1` the dashboard couldn't end the session, so it stays saved. |

| Flag | Value | Behavior |
| --- | --- | --- |
| `--host <url>` | URL | Host to act on. Without it, see [Host resolution](#host-resolution). |

For the full sign-in steps, see [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads).

### Where the session is saved

`auth login` saves the session in the system keychain: the macOS Keychain, or on Linux the Secret Service through `secret-tool`. When there is no keychain it can use, such as on Windows or on Linux without `secret-tool` or a Secret Service, it saves the session in `hosts.json` instead and prints a warning.

`hosts.json` also lists the hosts you are signed in to, your default host and the email for each. It's at `~/.config/scoutui/hosts.json`, or `$XDG_CONFIG_HOME/scoutui/hosts.json` when `XDG_CONFIG_HOME` is set.

A session ends after 30 days without use, or 90 days after you signed in, whichever comes first. Uploads, `auth status`, and `auth login` when it finds a saved session count as use. `auth logout` ends it at once, and so does signing out of your identity provider when the dashboard [receives back-channel logouts](/docs/guides/deploy-the-dashboard#end-sessions-when-people-sign-out-of-the-provider).

## Host resolution

The CLI takes the host from the first of these that is set:

1. `--host`
2. `SCOUTUI_HOST`
3. `host` in the config file. The `auth` commands read `scout.config.json` in the current directory.
4. Your default host

Your *default host* is the first host you signed in to with `auth login`. Signing in to another host doesn't change it.

When none is set:

- `scan` and `backfill` fail with `Couldn't upload the scan: no dashboard address is set. Add "host" to scout.config.json, or run scout scan --dry-run to scan without uploading.` and exit `1`. A dry run needs no host.
- `auth login` asks for a `Dashboard address` when prompts are on. Otherwise it exits `2`.
- `auth status` and `auth logout` ask `Which dashboard?` when prompts are on and you are signed in to more than one host. Otherwise they treat you as not signed in.

If `scout.config.json` in the current directory can't be read, the `auth` commands print the config's error and exit `2`.

A host without a scheme gets `https://`. A host must use `https://`; plain `http://` works only for `localhost`, `127.0.0.1` and `[::1]`. Any other `http://` host fails with `<host> doesn't use https://, so your sign-in would be sent unencrypted.`: `scan` exits `1`, and the `auth` commands exit `2`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, including `auth logout` when you weren't signed in. For `scan`, the dashboard published the scan or already had it, or a dry run wrote `scout-scan.json`. |
| `1` | The command ran but failed: `scan` [refused the scan](#upload-flags), the upload failed or didn't finish in time, the config for `scan` isn't in a git repository with a commit or git can't read that repository, `init` found an existing config, `auth login` or `auth status` failed, or `auth logout` couldn't end the session on the dashboard. Also any unexpected error. |
| `2` | Usage or config error: unknown command, flag or `auth` subcommand, a malformed flag, an extra argument, `--rescan` with `--dry-run`, an unknown `--framework` value, a missing or invalid config file, a config field Scout doesn't use, an `include` that matches no files, a `--repo-root` that isn't a folder, Yarn Plug'n'Play detected, `auth login` with no host and prompts off, or an `auth` or `init --host` address that isn't `https://`. On a dry run, also a `scout-scan.json` that links to a file outside the config's folder: `Error: scout-scan.json in <folder> links to a file outside that folder, so the scan won't write it. Delete the link and try again.` |
| `130` | You cancelled a prompt in `init` or `auth`, or stopped `backfill`. |

[Run a scan and upload in CI](/docs/guides/run-in-ci#fix-a-failed-upload) lists the upload errors behind exit code `1`. `backfill` uses the same codes for its own outcomes: see [its exit codes](#backfill-exit-codes).

## Environment variables

| Variable | Behavior |
| --- | --- |
| `SCOUTUI_HOST` | Host for uploads and `auth`. Its place in the order is under [Host resolution](#host-resolution). |
| `SCOUTUI_DEBUG` | Any value other than empty or `0` works like [`--debug`](#global-flags). |
| `SCOUTUI_TOKEN` | When set and not empty, `scan` and `backfill` upload with this token instead of your saved session. It must match the dashboard's `SCOUTUI_CI_UPLOAD_TOKEN`. Used by CI; see [Run a scan and upload in CI](/docs/guides/run-in-ci). |

Rarely needed:

| Variable | Behavior |
| --- | --- |
| `CI` | Any value other than empty, `false` or `0` turns [prompts](#prompts) off in `init` and `auth`. |
| `NO_COLOR` | Any non-empty value turns off colored output, even when `FORCE_COLOR` is set. |
| `FORCE_COLOR` | Any non-empty value other than `0` turns on colored output even when the output isn't a terminal. |
| `XDG_CONFIG_HOME` | Folder that holds `scoutui/hosts.json`. Default: `~/.config`. |
