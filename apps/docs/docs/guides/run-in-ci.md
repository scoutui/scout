---
description: "Run scout scan from a GitHub Actions job to upload each scan, using a CI upload token instead of a personal sign-in."
sidebar_label: "Run in CI"
---

# Run a scan and upload in CI

Scan a repo on every push to `main` and upload the result to your dashboard, with no one signing in. The example uses GitHub Actions; the same environment variables work in any CI system.

Before you start:

- The repo has the CLI as a dev dependency and a committed `scout.config.json`. See [Install the CLI](/docs/guides/install) and [Configure a scan](/docs/guides/configure-a-scan).
- The dashboard accepts a CI upload token. Whoever runs it sets that up once, as described in [Deploy the dashboard](/docs/guides/deploy-the-dashboard#let-ci-upload).

## 1. Store the token as a CI secret

Get the CI upload token from whoever runs the dashboard. In the repo's GitHub settings, add it as an Actions secret named `SCOUTUI_TOKEN`.

## 2. Add the workflow

The job checks out the repo with its full history, installs the repo's dependencies, then scans and uploads, in that order:

```yaml title=".github/workflows/scout.yml"
name: scout

on:
  push:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: git remote set-head origin --auto
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx scout scan
        env:
          SCOUTUI_HOST: https://scout.example.com
          SCOUTUI_TOKEN: ${{ secrets.SCOUTUI_TOKEN }}
```

Replace `npm ci` with your package manager's install command, and the host with your dashboard's address.

- **`npm ci`**: install before you scan. Without the repo's dependencies, the scan can't find the components those packages provide, and `scan` refuses the scan. In a Nuxt app, add `- run: npx nuxt prepare` after the install.
- **`SCOUTUI_TOKEN`**: the CLI sends this token with the upload instead of a personal sign-in.
- **`SCOUTUI_HOST`**: the dashboard to upload to, as an `https://` address. Only a `--host` flag wins over it; it wins over a `host` field in the repo's config. Always set it in a job that scans repos you don't control: otherwise a repo's config could name another host, and the job would send it the token.
- **`branches: [main]`**: runs the job only on the branch the dashboard tracks. `scan` refuses a commit that isn't on that branch, so a run on any other branch would fail at the scan step. See [Which scan a page shows](/docs/explanation/cli-and-dashboard#which-scan-a-page-shows).
- **`fetch-depth: 0`**: fetches full git history, which `scan` needs. See [Fetch full history](#fetch-full-history).
- **`git remote set-head origin --auto`**: asks the remote for its default branch and records it in the clone. `scan` reads it there to find the branch the dashboard tracks. The command uses the credentials the checkout step saved, so don't set `persist-credentials: false` on the checkout step. Leave this step out if the config sets `branch`.

## 3. Check the run

Push to `main` and open the job's log. After the scan summary, the CLI says once that it's waiting while the dashboard processes the upload, then prints the scan and your repo's page:

```text
Waiting for the dashboard to process the scan…
Uploaded scan 01K5Z8Q3M7T2V9XH4C6N1BRDWE → https://scout.example.com/repos/storefront
```

If the dashboard already has a scan of this commit, for example because the job ran again, the job skips the scan, prints `Commit a1c9e04 is already on the dashboard: <url>. Run scout scan --rescan to scan it again.` and still passes. [What happens after you upload](/docs/explanation/cli-and-dashboard#after-upload) describes the states an upload passes through.

The scan step's exit code decides whether the job passes:

- `0`: the dashboard published the scan, or already had it.
- `1`: the CLI refused to upload the scan, or the upload failed or didn't finish in time. See [Fix a failed upload](#fix-a-failed-upload).
- `2`: the scan didn't run, for example because the config is missing or invalid, or a flag is misspelled.

## Fix a failed upload

Each of these prints one `Error:` line and exits `1`. Match the error in the job log. To see the detail behind it, such as the dashboard's reply, add `--debug` to the scan command and run the job again.

| Error starts with | Cause | Fix |
| --- | --- | --- |
| `Error: Couldn't upload the scan: this checkout doesn't have the full history.` | The checkout step fetched only the latest commit. | Set `fetch-depth: 0` on the checkout step. See [Fetch full history](#fetch-full-history). |
| `Error: Couldn't upload the scan: couldn't tell which branch the dashboard tracks.` | The clone doesn't record the remote's default branch. | Keep the `git remote set-head origin --auto` step, or set `branch` in the config. |
| `Error: Couldn't upload the scan: commit <commit> isn't on <branch>.` or `you're on <branch>` | The job ran on a commit that isn't on the tracked branch, such as a pull request. | Run the upload job only on pushes to that branch, as the workflow above does. |
| `Error: Couldn't upload the scan: you have uncommitted changes.` | A step before the scan changed a tracked file, often an install rewriting the lockfile. | Use your package manager's frozen install, such as `npm ci` or `yarn install --immutable`. Add `--debug` to list the files. |
| `Error: Couldn't upload the scan: some dependencies aren't installed.` | The job didn't install all of the repo's dependencies before the scan. | Run the install step before the scan step. |
| `Error: Couldn't upload the scan: this Nuxt app hasn't been prepared.` | The Nuxt app's `.nuxt/` folder wasn't generated. | Add `npx nuxt prepare` after the install step. |
| `Error: Couldn't upload the scan: no components were found.` | The scan found nothing in the files `include` matches. | See [Check that the scan reads your files](/docs/guides/configure-a-scan#check-that-the-scan-reads-your-files). |
| `Error: Couldn't upload the scan: the dashboard rejected SCOUTUI_TOKEN.` | The token doesn't match the dashboard's, or the dashboard has no CI upload token set. | Copy the token again from whoever runs the dashboard. |
| `Error: Not signed in to <host>.` | `SCOUTUI_TOKEN` was empty. | Check the secret's name, and that the job can read it. |
| `Error: Couldn't upload the scan: no dashboard address is set.` | No host was set. | Set `SCOUTUI_HOST`, or add `host` to the config. |
| `Error: <host> doesn't use https://` | `SCOUTUI_HOST` starts with `http://`. | Use the dashboard's `https://` address. |
| `Error: Couldn't reach <host>.` | The job couldn't reach the host. | Check the host address, and that the dashboard is running. |
| `Error: Couldn't upload the scan: it's larger than the dashboard accepts.` | The scan is bigger than the dashboard's upload limit. | Ask whoever runs the dashboard to raise the limit. |
| `Error: Couldn't upload the scan: the dashboard is busy.` | The dashboard is receiving too many uploads at once. | Run the job again in a few minutes. |
| `Error: Couldn't upload the scan: the dashboard returned an error.` | The dashboard failed while receiving the scan. | Run the job again. If it keeps failing, ask whoever runs the dashboard to check its logs. |
| `Error: The dashboard is still processing the scan after 5 minutes.` | The dashboard didn't finish processing the upload in time. | Ask whoever runs the dashboard to check that its worker is running. The scan can still appear later. |
| `Error: Lost contact with the dashboard while it processed the scan.` | The connection dropped after the dashboard received the scan. | Check the repo's page in a few minutes. If the scan isn't there, run the job again. |
| `Error: Couldn't upload the scan: <repoId> on the dashboard comes from <address>.` | Another repository already uploads under this `repoId`. | See [A repository from another remote](/docs/guides/troubleshoot-a-scan#repository-from-another-remote). |
| Any other `Error: Couldn't upload the scan:` line | The CLI or the dashboard refused the scan. The line says why. | Fix what the line names, then run the job again. |

For every exit code and environment variable, see the [CLI reference](/docs/reference/cli#exit-codes).

## Fetch full history {#fetch-full-history}

Keep `fetch-depth: 0` on the checkout step, as in the workflow above. Without it, `actions/checkout` fetches only the latest commit, and `scan` refuses the shallow clone: `Error: Couldn't upload the scan: this checkout doesn't have the full history. Run git fetch --unshallow and try again.` A partial depth such as `fetch-depth: 50` is still a shallow clone, refused the same way.
