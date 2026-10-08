---
description: "Scan one commit a week of a repo's history with scout backfill, so its charts show the last six months straight away."
sidebar_label: "Fill in a repo's history"
---

# Fill in a repo's history

A repo you've just set Scout up on has one scan, so each of its charts shows a single point. `scout backfill` scans one commit a week from the history of the branch the dashboard tracks and uploads each scan, so the charts show the last six months straight away.

Before you start:

- The repo has the CLI installed and a `scout.config.json`. See [Install the CLI](/docs/guides/install) and [Configure a scan](/docs/guides/configure-a-scan).
- You're signed in to the dashboard as an Editor or Admin, or `SCOUTUI_TOKEN` is set. See [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads).
- The clone has its full history. In a shallow clone, run `git fetch --unshallow` first.

Your checkout can be on any branch, with uncommitted changes: backfill works in a temporary checkout of its own and never touches yours.

## 1. Update your clone

Backfill scans the tracked branch as your clone last fetched it, and doesn't fetch. Fetch first, so it includes the latest commits:

```bash
git fetch
```

## 2. Run backfill

From the folder that holds `scout.config.json`, run:

```bash
npx scout backfill
```

It says how many commits it found, then scans them newest first:

```text
scout 0.2.0 · storefront

Found 27 commits on origin/main, one a week since 3 Apr 2026. 1 is already on the dashboard, so Scout will scan 26.
⠹ 9b07c3d (25 Sep 2026): installing dependencies…  ──────────────────────────────  1 of 26
```

It picks the latest commit on the branch and, for each earlier week, the newest commit of that week. A commit the dashboard already has, such as the one your first `scout scan` uploaded, is left as it is.

Each commit is installed from its own lockfile and scanned with your current `scout.config.json`, so commits from before you added the config are scanned too, with the same `include` and `exclude`. Every commit gets a full install, so a run takes a while.

When it's done, it prints what happened and links to the repo's page, where the charts now show the history:

```text
✓ Backfilled main since 3 Apr 2026: 26 uploaded, 1 already on the dashboard, 0 skipped.
  See https://scout.example.com/repos/storefront
```

## Choose how far back

Backfill goes back six months unless you pass `--since` with the earliest commit date, as `YYYY-MM-DD`:

```bash
npx scout backfill --since 2026-01-01
```

The latest commit is always included, whatever its date.

## Replace scans already on the dashboard

To scan the commits the dashboard already has as well, for example after upgrading the CLI, add `--rescan`:

```bash
npx scout backfill --rescan
```

## Fix a skipped commit

When a commit can't be scanned, backfill skips it, says why, and carries on with the next one:

```text
! Warning: Skipped 51d8e20 (18 Sep 2026): pnpm install failed.
```

| Reason | What to do |
| --- | --- |
| `npm ci failed.`, `yarn install failed.` or `pnpm install failed.` | Run backfill again with `--debug` to read the install's errors. If the repo installs another way, set [`install`](#set-the-install-command). |
| `the install command in scout.config.json failed.` | Run backfill again with `--debug` to read the command's output, and fix the command. |
| `the install changed tracked files. Set "install" in scout.config.json to the command this repo installs with.` | Set `install` as the line says. `--debug` lists the files the install changed. |
| `some dependencies are missing after the install.` | A package in `dependencies` or `devDependencies` wasn't installed. Set `install` to a command that installs them all. |
| `nuxt prepare failed.` | Run backfill again with `--debug` to read the output. If you set `install`, the command must prepare the Nuxt app too, because backfill then runs only that command. |
| `there's no lockfile to install from.` | Backfill installs from a `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml` in the config's folder or a folder above it. For any other package manager, set `install`. |
| `it installs with Yarn Plug'n'Play, which Scout can't read.` | Nothing: that commit can't be scanned. Commits from after the repo [switched Yarn to `node_modules`](/docs/guides/install#2-switch-yarn-off-plugnplay) can. |
| `the scan found no components.` | Usually nothing: at that commit, the files the scan reads held no components yet. |
| Anything else | The dashboard refused that commit's scan. The line says why. |

Backfill uses the Yarn or pnpm version each commit pins. If older commits pin none and fail with `yarn install failed.`, set [`install`](#set-the-install-command).

If a commit was skipped for a reason you can fix, backfill fails when it ends, so a CI job shows that history is missing. Once you've fixed it, run backfill again: it scans only the commits that aren't on the dashboard yet.

### Set the install command

`install` in `scout.config.json` replaces backfill's own install. Backfill runs it through the shell at every commit, from the top of the repository, even when the config is in a subfolder:

```json title="scout.config.json"
{
  "include": ["src/**/*.{ts,tsx}"],
  "install": "yarn install --immutable"
}
```

Backfill runs the command with your own tools and doesn't download Yarn or pnpm for it, so if the command uses one of them, it must be installed.

For a Nuxt app, the command must also prepare the app, because backfill then doesn't run `nuxt prepare` itself. For a Nuxt app at the top of the repository, for example, that's `yarn install --immutable && yarn nuxt prepare`. For one in a subfolder, change into it first: `yarn install --immutable && cd apps/web && yarn nuxt prepare`.

`scout scan` ignores `install`. See the [config reference](/docs/reference/config#backfill-fields).

## Where the charts start

Backfill can stop before it reaches the `--since` date. It then prints where the charts start, followed by the `Backfilled` line:

- `3 commits in a row wouldn't install, so the charts start at 6 Apr 2026. Check the lines above, or set "install" in scout.config.json.` This usually means older history needs older tools. To go further back, fix what the skip lines name, often by setting [`install`](#set-the-install-command), and run backfill again.
- `apps/web doesn't exist before 6 Apr 2026, so the charts start there.` The config's folder isn't in older commits, for example because the app was created or moved then. Older commits can't be scanned with this config.

## If backfill stops with `Error:`

| Message starts with | What to do |
| --- | --- |
| `Error: Couldn't install the 3 newest commits, so nothing was uploaded.` | Fix what the skip lines above it name, often by setting [`install`](#set-the-install-command), and run backfill again. |
| `Error: <folder> isn't on <remote>/<branch> yet` | The config's folder is only on a branch that isn't merged yet. Merge it, run `git fetch`, then run backfill again. |
| `Error: Couldn't download Corepack` | Check your connection and your npm registry settings, then run backfill again. Or set [`install`](#set-the-install-command) to the command the repo installs with: backfill then doesn't need Corepack. |
| `Error: Couldn't scan <commit> (<date>): the scan stopped unexpectedly.` | Run backfill again with `--debug` to see how far the scan got before it stopped. A scan can stop like this when it runs out of memory, for example in a container with a low memory limit. |
| `Error: Couldn't check out <commit> (<date>) in a temporary folder.` | Run backfill again with `--debug` to read git's error. Fix what it names, for example by freeing disk space, then run backfill again. |
| An upload error, such as `Error: Couldn't reach <host>.`, followed by `Run scout backfill again to continue: it skips what's already on the dashboard.` | Fix what the error names, then run backfill again. See [Fix a failed upload](/docs/guides/run-in-ci#fix-a-failed-upload). |

Before it scans anything, backfill stops on the same problems as `scout scan`, such as a shallow clone or a missing sign-in, with the same lines. See [An upload is refused or fails](/docs/guides/troubleshoot-a-scan#an-upload-is-refused-or-fails).

## Stop and run it again

Press Ctrl-C to stop. Backfill cleans up its temporary checkout and prints:

```text
Stopped. Run scout backfill again to continue: it skips what's already on the dashboard.
```

Run it again whenever you like. It counts the commits it has uploaded as already on the dashboard and scans only the rest. Leave out `--rescan` if you used it, or it scans them all again.

For every flag, see the [CLI reference](/docs/reference/cli#backfill).
