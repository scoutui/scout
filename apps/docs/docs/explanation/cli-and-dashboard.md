---
description: "How the CLI and the dashboard divide the work, what happens to a scan after you upload it, and what \"Preparing scan data\" means."
sidebar_label: "CLI and dashboard"
---

# How the CLI and the dashboard fit together

Scout has two parts. The **CLI** scans one repository and uploads the result as a JSON [scan file](/docs/reference/glossary#scan-file). The **dashboard** is a site you host yourself, where your team reads many of those scans side by side and over time.

## The CLI collects, the dashboard keeps

Each run of the CLI makes one scan: a snapshot of how the repo uses its components at the commit you have checked out.

The dashboard keeps the scans it receives from every repo in one place for the whole team, with at most one scan per commit of each repo. Uploading a scan of a commit the dashboard already has changes nothing, unless you scan with `--rescan`, which replaces that commit's scan. The CLI calls a running dashboard its *host*: the address it uploads to, given with `--host` or the config file's `host` field.

The scan file is useful on its own. You can read it with `jq`, feed it to your own scripts, or keep it as a build output. It also keeps the [uses the scan couldn't match](/docs/reference/glossary#unmatched-use) to a component, which the dashboard leaves out of every number.

Questions that span repos or time need the dashboard: how `Button` from `@acme/ui` is used in `storefront` and `checkout` together, or whether `LegacyButton` is still falling as teams move to `Button`. It also keeps decisions such as "`LegacyButton` is replaced by `Button`" next to the numbers: see [Migrations and retirements](/docs/guides/dashboard/track-a-migration).

## How a scan gets in

The CLI sends scans to the dashboard; the dashboard never reaches into your repos. `scout scan` scans and sends the scan file, and writes nothing to disk. To keep the scan file, run `scout scan --dry-run`: it writes `scout-scan.json` and doesn't contact the dashboard.

`scout scan` sends the commit you have checked out. Past commits come in through `scout backfill`, which scans one commit a week of the tracked branch's history and uploads them, so a repo's charts can show its history straight away. See [Fill in a repo's history](/docs/guides/fill-in-a-repos-history).

Before it scans, `scout scan` checks that the dashboard will take the scan: the commit is on the branch the dashboard tracks with no uncommitted changes, you're signed in as an Editor or Admin, and the repo's dependencies are installed. [Upload flags](/docs/reference/cli#upload-flags) lists every check.

Uploads come from one of two places:

- **An Editor or Admin who has signed in** with `scout auth login`. See [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads).
- **A CI job with a token**, so no one has to sign in. See [Run a scan and upload in CI](/docs/guides/run-in-ci).

## What happens after you upload {#after-upload}

The dashboard stores the upload, then a background process, the *worker*, checks the scan and publishes it. Only then does it show on the dashboard's pages. The CLI waits for that to finish:

```text
Waiting for the dashboard to process the scan…
Uploaded the scan of a1c9e04: https://scout.example.com/repos/storefront
```

If the CLI prints `Commit a1c9e04 is already on the dashboard`, the dashboard already has a scan of this commit, for example because a teammate scanned it first or a CI job ran twice. Nothing changes, and it is not an error. To replace that scan, for example after upgrading the CLI, run `scout scan --rescan`.

Only a published scan or an existing one counts as success. Anything else makes the CLI fail, so a CI job fails when its scan didn't make it in.

:::note
If every upload ends with `The dashboard is still processing the scan`, the worker is probably not running. [Deploy the dashboard](/docs/guides/deploy-the-dashboard) covers running it.
:::

## When a page shows Preparing scan data {#scan-preparing}

When a repo's latest scan isn't ready, pages show that repo's newest scan that is, and a band above the content says so, for example **storefront's latest scan couldn't be prepared · Showing 35e61ed, committed 23h ago.** A repo with no ready scan at all is left out of the pages that cover every repo, and the band names it. A chart over time leaves out the scans that aren't ready and lists them.

A page shows one of these in place of its content only when it has nothing else to show:

- **Preparing scan data**: the dashboard is still getting the scan ready, usually after an upgrade. The page loads by itself once it's done.
- **[Scan data couldn't be prepared](#scan-preparation-failed)**: the dashboard gave up on the scan.
- **[Scan data can't be read](#scan-cant-be-read)**: the dashboard can't read the stored scan.

Some numbers catch up a moment after each new scan, and after each change to a record, tag or chart: the uses left on the **governance** page, the migration and retirement charts, the rows on a repo's **Adoption** tab, and chart previews on the **charts** page. Until then, a **Preparing scan data** line shows above the old numbers. **Numbers may be out of date** means they couldn't be worked out again; ask your dashboard administrator to retry it.

All of this needs the worker running. Without it, **Preparing scan data** never clears.

### Scan data couldn't be prepared {#scan-preparation-failed}

**Scan data couldn't be prepared** means the dashboard tried and gave up, so waiting won't help. The page names the repo and commit of each scan that failed. Ask your dashboard administrator to retry it ([Retry scans that failed to rebuild](/docs/guides/deploy-the-dashboard#retry-scans-that-failed-to-rebuild) shows how), or check out that commit and run `scout scan`: the new scan replaces it.

### Scan data can't be read {#scan-cant-be-read}

**Scan data can't be read** means the dashboard can't read a stored scan the page needs, so retrying won't help. The page names the repo and commit. Check out that commit and run `scout scan`, or rerun the CI job that scanned it: the new scan replaces the one that can't be read.

## Which scan a page shows

Most pages show each repo's *latest scan*: the scan of its newest commit, by the commit's date. The CLI uploads only commits on the branch the dashboard tracks, the config's [`branch`](/docs/reference/config#upload-fields) or else the remote's default branch, so a scan of a feature branch never becomes the repo's latest. A scan of an older commit uploaded later joins the repo's history without becoming its latest.

A repo page can show an older scan instead; see [Look at an older scan](/docs/guides/dashboard/repos#look-at-an-older-scan). [Reading the numbers](/docs/explanation/dashboard/reading-the-numbers) explains how the latest scans add up across repos.

## Self-hosted

There is no central Scout service to sign up for. You run your own dashboard: on your machine while you try it out ([Run the dashboard locally](/docs/guides/run-the-dashboard-locally)), or deployed for your team ([Deploy the dashboard](/docs/guides/deploy-the-dashboard)).
