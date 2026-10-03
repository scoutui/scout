---
description: "Match what a failing or incomplete scout scan prints to its cause, and fix it."
sidebar_label: "Troubleshoot a scan"
---

import Link from '@docusaurus/Link';

# Troubleshoot a scan

Find the symptom you see, apply the fix under it, then scan again. This guide assumes the repo already has a `scout.config.json`; if it doesn't, see [Configure a scan](/docs/guides/configure-a-scan).

## The scan stops with `Error:`

The scan prints one line starting with `Error:` and writes nothing. Match the start of the message:

| Message starts with | Fix |
| --- | --- |
| `Couldn't find <path>` | Run the scan from the folder that holds the config, or pass its path with `--config <path>`. If there is no config yet, run `scout init`. |
| `<path> isn't valid JSON` | Fix the syntax. Comments and trailing commas also cause this. To see the line and column where the parser stopped, run the command again with `--debug`. |
| `<path> has a field Scout doesn't use:` or `<path> has fields Scout doesn't use:` | Remove each field the line names, such as `output`. If it's a misspelling of a field you need, such as `exlude` for `exclude`, correct the name instead. The [config reference](/docs/reference/config#fields) lists every field. |
| `Invalid config at <path>:` | Fix each problem it lists as `<field>: <problem>`, such as `/include: must be array`. Check each against the [config reference](/docs/reference/config). |
| `scout-scan.json in <folder> links to a file outside that folder` | Delete the link and scan again. |
| `Scout can't read packages installed with Yarn Plug'n'Play.` | Switch Yarn to `node_modules`, as described in [Install the CLI](/docs/guides/install#2-switch-yarn-off-plugnplay). |

## The scan says the folder isn't a git repository

The scan stops with `Error: Couldn't scan: <path> isn't inside a git repository.` or `Error: Couldn't scan: this repository has no commits yet.` The folder that holds the config must be inside a git repository with at least one commit. Run the scan from a checkout of the repo. If the repository is new and has no commits yet, make the first one with `git add -A` and `git commit -m "Initial commit"`.

If it stops with `Error: Couldn't scan: git failed in <path>.`, run `git status` in that folder: git's own message says what's wrong.

## The scan reads 0 files, or fewer than you expect

If the scan stops with `Error: No files match "include"`, or the summary counts fewer files than your repo has, your `include` patterns don't match your code. See [Check that the scan reads your files](/docs/guides/configure-a-scan#check-that-the-scan-reads-your-files).

If your config has no `include`, the scan reads every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file below the config's folder. When there are none, it stops with `Error: No .js, .jsx, .ts, .tsx or .vue files to scan in /home/dev/storefront.` Run the scan from the folder that holds your source files, or check that `exclude` doesn't leave them all out.

The scan always leaves out test, spec and story files, files in `__tests__` folders, type declaration files (`.d.ts`) and `node_modules`, even when `include` names them. Their usages aren't counted.

The scan skips code inside a submodule or another clone below the config's folder. If `include` only matches files in one, the scan stops with `Error: "include" in <path> (<patterns>) only matches files in <folder>, which is a separate git repository.` With no `include`, the message is `Error: The only source files here are in <folder>, which is a separate git repository.` Run the scan from that folder instead.

## The scan warns that an `exclude` entry matches nothing

A line such as `Warning: "apps/playground" in exclude matches nothing. Update or remove it in ./scout.config.json.` means nothing exists at that path below the config's folder, often because the folder was renamed or moved. The scan carries on. Fix the path in `exclude`, or remove the entry.

## A file has syntax errors

A line such as `Warning: /home/dev/storefront/src/Broken.tsx has syntax errors (Unexpected token), so the scan read what it could.` means the scan couldn't fully parse that file. It carries on, but components defined or used in that file can be missing from the results. Fix the syntax error, or add the file to `exclude` in the config if you don't want it counted.

## Components are missing: Scout couldn't match some occurrences {#unresolved-occurrences}

When the scan sees a component used but can't tell which one it is, it records an [unresolved occurrence](/docs/reference/glossary#unresolved-occurrence). The component gets no entry for that use, and the dashboard leaves it out. The summary counts them in a line such as `Scout couldn't match 3 more occurrences to a component.`, which links to this section.

List them with the reason, the file and line, and the import or name that failed. The command reads `scout-scan.json`, so run `npx scout scan --dry-run` first to write it:

```bash
jq -r '.occurrences[] | select(.resolution.status == "unresolved") | "\(.resolution.reason.kind)  \(.filePath):\(.line)  \([.trace[] | select(.kind == "import") | .specifier][0] // .resolution.reason.name // "")"' scout-scan.json | sort
```

```text
module-not-found  src/App.tsx:8  @/components/Modal
package-not-installed  src/App.tsx:7  @acme/ui
unbound-name  src/App.tsx:9  PromoBanner
```

Fix each reason as follows. The [artifact reference](/docs/reference/artifact#unresolved-occurrences) describes them in full.

| Reason | Fix |
| --- | --- |
| `package-not-installed` | Install the repo's dependencies. See [Dependencies aren't installed](#dependencies-arent-installed). |
| `module-not-found` | Fix the import path. For a path alias such as `@/components`, see [Resolve imports in a monorepo](/docs/guides/resolve-imports-in-a-monorepo#find-imports-that-didnt-resolve). If a build step generates the file, run it before you scan. |
| `unbound-name` | Nothing in the file imports the name. In a Nuxt app, the scan also warns that the app hasn't been prepared: run `npx nuxt prepare`, then scan again. A Vue component registered with `app.component()` or by a plugin, such as `<RouterLink>`, is matched only when the file imports it or a [list of auto-imports](/docs/reference/framework-support#vue) names it. |
| `chain-bailed` | An installed package's re-exports loop or run too deep. There is nothing to fix in your repo; see [Package re-export codes](/docs/reference/diagnostics#package-re-export-codes). |

## Dependencies aren't installed

```text
Warning: @acme/ui is listed in package.json but isn't installed, so 3 occurrences of it aren't matched to a component. Install your dependencies and scan again.
```

The summary also reads `3 of them are from a package that isn't installed.` The scan finds a package's components only in the installed package, so every use of `@acme/ui` is unresolved and none of its components are listed. Run your package manager's install in the scanned checkout, then scan again. In CI, install before the scan step.

## A web component has no package

A tag such as `<acme-button>` shows `<no package>` on its page in the dashboard, and in the artifact its `attribution.status` is `unknown` or `conflict`. It has no version, and lifecycle records can't cover it. If the tag comes from your design system, see [Link web components to your package](/docs/guides/link-web-components-to-your-package).

## Some renders aren't counted

Scan with `--dry-run --debug` and read the count lines before the summary:

```text
1 component passed in as a prop or argument wasn't counted.
```

These are renders the scan saw but couldn't tie to a component, such as `<Icon />` where `Icon` arrives as a prop. They aren't config problems, and the [diagnostics reference](/docs/reference/diagnostics) says what to do about each code. List them with their file and line:

```bash
jq -r '.diagnostics[] | select(.code == "late-bound-render" or .code == "unresolved-reference") | "\(.code)  \(.filePath):\(.line)  \(.symbol)"' scout-scan.json
```

## An upload is refused or fails

| Message starts with | Fix |
| --- | --- |
| `Error: Couldn't upload the scan: this checkout has no remote` | Add the remote the dashboard follows, for example `git remote add origin <url>`, then scan again. |
| `Error: Couldn't upload the scan: this checkout has several remotes` | Choose the remote the dashboard follows with `git config scout.remote <name>`. The choice is saved in this clone. |
| `Error: Couldn't upload the scan: couldn't tell which branch the dashboard tracks.` | Run the `git remote set-head <remote> --auto` command the line names. It asks the remote for its default branch and records it in your clone. Or set `branch` in `scout.config.json`. |
| `Error: Couldn't upload the scan: there's no <branch> on <remote>.` | Fetch the branch with `git fetch <remote>`. If it was renamed, change `branch` in `scout.config.json`. |
| `Error: Couldn't upload the scan: this commit isn't on <remote>/<branch> yet.` | Push the commit to the tracked branch, or merge it there, then scan again. |
| `Error: Couldn't upload the scan: you're on <branch>, and the dashboard tracks <branch>.` | Switch to the tracked branch, pull, and scan again. Scans of other branches never reach the dashboard. |
| `Error: Couldn't upload the scan: commit <commit> isn't on <branch>.` | Check out the tracked branch and scan again. A commit that came into the branch through a merge doesn't count, even though the branch contains it: scan the merge commit instead. |
| `Error: Couldn't upload the scan: this checkout doesn't have the full history.` | Run `git fetch --unshallow`, then scan again. In CI, see [Fetch full history](/docs/guides/run-in-ci#fetch-full-history). |
| `Error: Couldn't upload the scan: you have uncommitted changes.` | Commit or stash them. A change to any tracked file counts, and so does a new file the scan would read. Add `--debug` to list the files. |
| `Error: Couldn't upload the scan: <package> is listed in <package.json> but isn't installed.` | [Install dependencies](#dependencies-arent-installed), then scan again. |
| `Error: Couldn't upload the scan: this Nuxt app hasn't been prepared.` | Run `npx nuxt prepare`, then scan again. |
| `Error: Couldn't upload the scan: no components were found.` | The scan read no components. See [Check that the scan reads your files](/docs/guides/configure-a-scan#check-that-the-scan-reads-your-files). |
| `Error: Couldn't upload the scan: this CLI is newer than the dashboard.` or `… is too old for the dashboard.` | See [If the CLI is newer or older than the dashboard](/docs/guides/upgrade-scout#version-messages). |
| `Error: Couldn't upload the scan: <commit> was scanned with a newer CLI` | Run the `npx` command the line names, such as `npx @scoutui/cli@<version> scan --rescan`, or upgrade the CLI to that version. |
| <Link id="repository-from-another-remote" />`Error: Couldn't upload the scan: <repoId> on the dashboard comes from <address>.` | Another repository already uploads under this `repoId`. Scan a clone of the repository the message names, or set a different `repoId` in `scout.config.json`. If the repository was renamed or moved, ask your dashboard administrator to [reset its remote](/docs/guides/deploy-the-dashboard#reset-a-repositorys-remote). |
| `Error: Couldn't upload the scan: it comes from a CLI this dashboard no longer accepts.` | [Install `@scoutui/cli`](/docs/guides/install), then scan again. |
| `Error: Couldn't upload the scan: <host> didn't answer like a Scout dashboard.` | The address isn't the dashboard's. Check `host` in `scout.config.json`, `--host` or `SCOUTUI_HOST`, whichever you set. |
| Any other `Error:` line about the upload | In CI, see [Fix a failed upload](/docs/guides/run-in-ci#fix-a-failed-upload). On your own machine, run `scout auth status --host <url>` to check you are signed in, and see [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads). Add `--debug` to see the detail behind the line, such as the dashboard's reply. |

Some lines end with `See <url>`: the page that explains that problem.

## Check the fix

Run `npx scout scan --dry-run` again and rerun the command from [Components are missing](#unresolved-occurrences). The uses you fixed are gone from the list, and the summary's "couldn't match" count drops.
