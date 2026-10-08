---
description: "Every command, flag, exit code and environment variable the Scout CLI accepts."
sidebar_label: "CLI"
---

# CLI reference

```
scout <command> [options]
```

## Commands

| Command | What it does |
| --- | --- |
| [`scan`](#scan) | Scans the repo and uploads the scan to the dashboard. With `--dry-run`, writes the [scan file](/docs/reference/glossary#scan-file) to `scout-scan.json` instead. |
| [`backfill`](#backfill) | Scans past commits on the tracked branch, one a week, and uploads them to the dashboard. |
| [`init`](#init) | Writes a starter `scout.config.json`. |
| [`auth`](#auth) | Signs in to a dashboard, signs out, or shows who you are signed in as. Takes a subcommand: `login`, `logout` or `status`. |

## Global flags

| Flag | Behavior |
| --- | --- |
| `--help`, `-h` | Prints help. After a command, prints that command's help. |
| `--version`, `-v` | Prints the CLI version. |
| `--debug` | Prints the detail behind an error or warning, such as the dashboard's reply or git's own message, and counts the renders a scan couldn't follow. Works before or after the command. |

## Prompts

`init` and `auth` ask questions only in a terminal, when `CI` is unset, empty, `false` or `0`, and, for `init`, without `--yes`. Otherwise they never wait for input: they use their flags and defaults, or stop with an error.

## New versions

When a newer version of `@scoutui/cli` is available, Scout says so, with the command that updates it for your repo's package manager:

```
scout 0.2.0 · acme/storefront at 1a2b3c4
Scout 0.3.0 is available. Update with npm i -D @scoutui/cli@latest.
```

If the dashboard you last uploaded to can't read the new version's scans yet, it tells you to wait instead:

```
Scout 0.3.0 is available, but your dashboard can't read its scans yet.
Keep this version until your dashboard is upgraded.
See https://scoutui.dev/docs/guides/upgrade-scout#version-messages
```

The check runs only in a terminal, outside CI and without `--quiet`. `SCOUTUI_NO_UPDATE_CHECK` or `NO_UPDATE_NOTIFIER` turns it off (see [Environment variables](#environment-variables)).

## `scan`

```
scout scan [options]
```

Most runs need no flags: `scout scan` reads `scout.config.json` in the current directory, [checks that the dashboard can take the scan](#upload-flags), scans, uploads the scan and waits for the dashboard to publish it. It writes no file. To scan without uploading, run `scout scan --dry-run`.

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--config <path>` | path | `./scout.config.json` | Config file to read. Relative to the current directory. |
| `--dry-run` | none | off | Scans without uploading, and writes the scan file to `scout-scan.json` in the config file's folder, replacing any earlier one. Skips the [upload checks](#upload-flags) and never contacts the dashboard. |
| `--quiet` | none | off | Hides progress, the summary and most warnings. Errors, and the line saying what happened to the scan, still print. |

The config file must be inside a git repository with at least one commit.

`scan` needs the repo's dependencies installed. A package in `dependencies` or `devDependencies` that isn't installed stops an upload; a dry run scans anyway, and records each use of that package's components as an [unmatched use](/docs/reference/glossary#unmatched-use). A package listed only in `peerDependencies` or `optionalDependencies` doesn't stop an upload: its uses are unmatched.

### Upload flags

These change where and how `scan` uploads. See [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads) and [Run a scan and upload in CI](/docs/guides/run-in-ci).

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--rescan` | none | off | Replaces the dashboard's scan of this commit if it has one. Can't be used with `--dry-run`. |
| `--host <url>` | URL | see [Host resolution](#host-resolution) | Dashboard to upload to. Ignored with `--dry-run`. |

Before it scans, an upload checks that:

- The checkout has a remote the dashboard can follow: the one `git config scout.remote` names, else `upstream`, else the only remote, else `origin`.
- The checkout has its full history, not a shallow clone.
- The commit is on the tracked branch: `branch` in the config, else the remote's default branch as your clone recorded it (`<remote>/HEAD`). It must be pushed, and on that branch's first-parent history: a commit that came into the branch through a merge doesn't count, but the merge commit does.
- No tracked file has uncommitted changes, and every file the scan reads is committed. A new `scout.config.json` or scan file doesn't count. `--debug` lists the files.
- A dashboard address is set, and you're signed in as an Editor or Admin, or `SCOUTUI_TOKEN` is set.
- The dashboard accepts this CLI version and this repository.
- Every package in `dependencies` and `devDependencies` is installed.
- A Nuxt app has been prepared with `nuxt prepare`.

If one fails, `scan` says which and stops without scanning or uploading. [An upload is refused or fails](/docs/guides/troubleshoot-a-scan#an-upload-is-refused-or-fails) lists each message and its fix.

After the scan, `scan` refuses to upload a scan that found no uses. If the dashboard already has a scan of this commit, `scan` says so and stops without scanning, unless you pass `--rescan`.

### Rarely needed flags

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--repo-id <value>` | string | the config's `repoId`, else derived from the git remote (see [Repo identity](/docs/reference/config#repo-identity)) | [Repo id](/docs/reference/glossary#repo-id) written into the scan file. Replaces the config's `repoId`. |
| `--repo-root <dir>` | path | the top of the git repository that holds the config file | Folder that file paths in the scan file are relative to. Relative to the current directory. |

## `backfill`

```
scout backfill [options]
```

Scans one commit a week of the tracked branch's history, newest first, and uploads each scan to the dashboard. It skips commits the dashboard already has. Each commit is checked out in a temporary folder, so `backfill` never changes your checkout and writes no file. See [Fill in a repo's history](/docs/guides/fill-in-a-repos-history).

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--since <date>` | date, `YYYY-MM-DD` | six months before today | Earliest commit date to pick. |
| `--rescan` | none | off | Also scans the commits the dashboard already has, replacing their scans. |
| `--config <path>` | path | `./scout.config.json` | Config file to read. Relative to the current directory. |
| `--host <url>` | URL | see [Host resolution](#host-resolution) | Dashboard to upload to. |
| `--quiet` | none | off | Hides the progress lines. |

With [`--debug`](#global-flags), `backfill` also prints each install's and each scan's output, and the detail behind each skipped commit.

Before it scans any commit, `backfill` stops on the same config, git, sign-in and dashboard problems as `scan`. It doesn't check which branch is checked out, or for uncommitted changes.

### Which commits it picks

- The latest commit on `<remote>/<branch>`, whatever its date. `backfill` reads the branch as the clone last fetched it, and doesn't fetch. `<remote>` and `<branch>` are the ones `scan` uploads to.
- Then, for each earlier week from Monday to Sunday, the newest commit of that week on the branch's first-parent history whose commit date is on or after `--since`.

Every commit is scanned with the current config file, so commits from before the config existed are scanned too. The config's folder must exist at the latest commit.

### How it installs each commit

- With [`install`](/docs/reference/config#backfill-fields) set, it runs that command through the shell from the top of the repository, and nothing else.
- Otherwise, it installs from the nearest `pnpm-lock.yaml`, `yarn.lock` or `package-lock.json` in the config's folder or a folder above it, without running install scripts. Yarn and pnpm projects install with the version the commit pins, for example in `packageManager`. Then, for a Nuxt app, it runs `nuxt prepare`.

When a commit can't be installed or scanned, `backfill` skips it, says why and carries on. [Fix a skipped commit](/docs/guides/fill-in-a-repos-history#fix-a-skipped-commit) lists each reason and what to do.

## `init`

```
scout init [options]
```

Writes a config file with `$schema`, `repoId` and `exclude`, plus `host` when you give a dashboard address and `branch` when it can tell which branch the dashboard tracks. It writes no `include`, so the scan reads every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file below the config's folder, apart from those it [always skips](/docs/reference/config#common-fields).

`init` never overwrites a config. Without `--output`, it also writes nothing when a folder above it, up to the repository root, already has a config, and tells you to run `scout scan` there.

| Flag | Value | Default | Behavior |
| --- | --- | --- | --- |
| `--output <path>` | path | `./scout.config.json` | Where to write the config file. Relative to the current directory. |
| `--repo-id <name>` | string | the owner and name from the git remote, such as `acme/checkout`, else the name of the config's folder | Value written to `repoId`. |
| `--host <url>` | URL | none | Dashboard address written to `host`, with `https://` added when it has no scheme. It must use `https://`, apart from `http://` on `localhost`, `127.0.0.1` and `[::1]`. |
| `--branch <name>` | string | the remote's default branch | Branch the dashboard tracks. Written to `branch`. |
| `--exclude <folder>` | path | none | Folder to leave out of the scan, written to `exclude` as given. Relative to the config's folder. Repeat the flag for more than one. |
| `-y`, `--yes` | none | off | Runs without prompts. |

### With and without prompts

With [prompts](#prompts) on, `init` asks for the dashboard address, the repository name and the tracked branch, offering each default, and skips the question for any flag you pass. Without prompts, it takes each value from its flag, else its default.

- **In a workspace package's folder**, when the monorepo root has no config yet, `init` asks whether to scan the whole repository instead. Yes writes the config at the monorepo root. Without prompts, it writes the config in the current folder and prints the command that writes it at the root instead.
- **In a monorepo root**, with workspace packages listed in `workspaces` in its `package.json` or in `pnpm-workspace.yaml`, `init` asks which packages or folders to leave out of the scan, and writes them to `exclude`.
- **With several remotes**, none of them called `origin` or `upstream`, `init` asks which one the dashboard follows and saves your answer in this checkout's git config as `scout.remote`. Without prompts, it warns and names the repository after the config's folder; choose a remote with `git config scout.remote <name>`.

## `auth`

```
scout auth <login|logout|status> [--host <url>]
```

| Subcommand | Behavior |
| --- | --- |
| `login` | Signs in with a code you approve in the browser, and saves the session. If you're already signed in to that host and the session still works, it says so. When you have no default host, the host you sign in to becomes it. |
| `status` | Checks the session with the dashboard, and prints who you are signed in as, your role and where the session is saved. |
| `logout` | Ends the session on the dashboard, then deletes it from this computer. If that host was your default, you have no default until you next sign in. |

| Flag | Value | Behavior |
| --- | --- | --- |
| `--host <url>` | URL | Host to act on. Without it, see [Host resolution](#host-resolution). |

For the full sign-in steps, see [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads).

### Where the session is saved

`auth login` saves the session in the system keychain: the macOS Keychain, or on Linux the Secret Service through `secret-tool`. When there is no keychain it can use, such as on Windows or on Linux without `secret-tool` or a Secret Service, it saves the session in `hosts.json` instead and prints a warning.

`hosts.json` also lists the hosts you are signed in to, your default host and the email for each. It's at `~/.config/scoutui/hosts.json`, or `$XDG_CONFIG_HOME/scoutui/hosts.json` when `XDG_CONFIG_HOME` is set.

A session ends after 30 days without use, or 90 days after you signed in, whichever comes first. Uploads, `auth status`, and `auth login` when it finds a saved session count as use. It ends at once when you run `auth logout`, when an Admin removes you on the dashboard, or when you sign out of your identity provider and the dashboard [receives back-channel logouts](/docs/guides/deploy-the-dashboard#end-sessions-when-people-sign-out-of-the-provider).

## Host resolution

The CLI takes the host from the first of these that is set:

1. `--host`
2. `SCOUTUI_HOST`
3. `host` in the config file. The `auth` commands read `scout.config.json` in the current directory.
4. Your default host

Your *default host* is the first host you signed in to with `auth login`. Signing in to another host doesn't change it.

When none is set:

- `scan` and `backfill` stop and ask you to set one. A dry run needs no host.
- `auth login` asks for a `Dashboard address` when prompts are on.
- `auth status` and `auth logout` ask `Which dashboard?` when prompts are on and you are signed in to more than one host.

A host without a scheme gets `https://`. A host must use `https://`; plain `http://` works only for `localhost`, `127.0.0.1` and `[::1]`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. For `scan`, the dashboard published the scan or already had it, or a dry run wrote `scout-scan.json`. |
| `1` | The command ran but failed. For `scan`, the scan wasn't uploaded. For `backfill`, it skipped a commit for a reason you can fix, or stopped with an error. |
| `2` | A usage or config error, such as a misspelled flag or an invalid config file. |

## Environment variables

| Variable | Behavior |
| --- | --- |
| `SCOUTUI_HOST` | Host for uploads and `auth`. Its place in the order is under [Host resolution](#host-resolution). |
| `SCOUTUI_DEBUG` | Any value other than empty or `0` works like [`--debug`](#global-flags). |
| `SCOUTUI_NO_UPDATE_CHECK` | Any value other than empty or `0` turns off the [check for a newer version](#new-versions). |
| `SCOUTUI_TOKEN` | When set and not empty, `scan` and `backfill` upload with this token instead of your saved session. It must match the dashboard's `SCOUTUI_CI_UPLOAD_TOKEN`. Used by CI; see [Run a scan and upload in CI](/docs/guides/run-in-ci). |

Rarely needed:

| Variable | Behavior |
| --- | --- |
| `CI` | Any value other than empty, `false` or `0` turns off [prompts](#prompts) and the [check for a newer version](#new-versions). |
| `NO_COLOR` | Any non-empty value turns off colour, even when `FORCE_COLOR` is set. |
| `FORCE_COLOR` | Any non-empty value other than `0` turns on colour, even when the output isn't a terminal. |
| `NO_UPDATE_NOTIFIER` | When set, even empty, turns off the [check for a newer version](#new-versions). |
| `XDG_CONFIG_HOME` | Folder that holds `scoutui/hosts.json`. Default: `~/.config`. |
| `XDG_CACHE_HOME` | Folder that holds `scoutui/update-check.json`, the [check for a newer version](#new-versions)'s cache. Default: `~/.cache`. |
