---
description: "How the CLI and the dashboard divide the work, what happens to a scan after you upload it, and what \"Preparing scan data\" means."
sidebar_label: "CLI and dashboard"
---

# How the CLI and the dashboard fit together

Scout has two parts. The **CLI** scans one repository and uploads the scan, a JSON [artifact](/docs/reference/glossary#artifact). The **dashboard** is a site you host yourself, where your team reads many of those scans side by side and over time.

Most people meet the CLI first, because it is the part you install and run. Most of the looking and deciding happens in the dashboard.

## The CLI collects, the dashboard keeps

The CLI is a collector. Point it at a repo and it makes one scan: a snapshot of how that repo uses its components at that commit. It keeps nothing between runs.

The dashboard keeps the scans it receives from every repo in one place for the whole team, with at most one scan per commit of each repo. Uploading a scan of a commit the dashboard already has changes nothing, unless you scan with `--rescan`, which replaces that commit's scan. Either way, a chart never counts one commit twice. The CLI calls a running dashboard its *host*: the address it uploads to, given with `--host` or the config file's `host` field.

The artifact is useful on its own. You can read it with `jq`, feed it to your own scripts, or keep it as a build output. It also keeps [unresolved occurrences](/docs/reference/glossary#unresolved-occurrence), which the dashboard leaves out of every number. The scan's summary leaves them out of its totals too, and counts them on a line of their own: `Scout couldn't match … more occurrences to a component.`

What one file can't answer are questions that span repos or time, and those are the dashboard's job:

- **Across repos.** How is `Button` from `@acme/ui` used in `storefront` and `checkout` together?
- **Over time.** Is `LegacyButton` still falling as teams move to `Button`? That needs a series of scans, kept and compared.
- **Decisions next to usage.** A record such as "`LegacyButton` is superseded by `Button`" sits beside the numbers, so you can see policy and practice together. See [Migrations and retirements](/docs/guides/dashboard/track-a-migration).

## How a scan gets in

The CLI sends scans to the dashboard; the dashboard never reaches into your repos. `scout scan` scans and sends the artifact, and writes no file. To keep the artifact as a file, run `scout scan --dry-run`: it writes `scout-scan.json` and doesn't contact the dashboard.

Before it scans, `scout scan` checks everything that would stop the upload, so nobody waits for a scan the dashboard won't take:

- The commit is on the branch the dashboard tracks, with no uncommitted changes and the clone's full history.
- The CLI is signed in.
- The dashboard accepts this CLI and this repository, and doesn't already have a scan of the commit.
- The repo's dependencies are installed.

A scan of a feature branch or of uncommitted work would put a point on the chart that the branch never had. Without the dependencies, the scan can't find the components your packages provide, so the dashboard would get a scan with those components missing. See [Dependencies aren't installed](/docs/guides/troubleshoot-a-scan#dependencies-arent-installed).

Uploads come from one of two places:

- **A person who has signed in** with `scout auth login`. See [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads).
- **A CI job with a token**, so no one has to sign in. See [Run a scan and upload in CI](/docs/guides/run-in-ci).

## What happens after you upload {#after-upload}

Receiving a scan and showing it are two steps. The dashboard stores the upload and answers straight away. A background process, the *worker*, then checks the scan and publishes it. Only then does it show on the dashboard's pages.

The CLI says once that it's waiting, then waits for that to finish. A typical run ends like this:

```text
Waiting for the dashboard to process the scan…
Uploaded scan 01K5Z8Q3M7T2V9XH4C6N1BRDWE → https://scout.example.com/repos/storefront
```

The last line links to the repo's page. The other endings you might see:

- **`Commit a1c9e04 is already on the dashboard`.** The dashboard already has a scan of this commit, for example because a teammate scanned it first or a CI job ran twice. The CLI asks before it scans, so it stops without scanning. Nothing changes, and it is not an error. To replace that scan, for example after upgrading the CLI, run `scout scan --rescan`.
- **`Uploaded scan for a1c9e04 → <url>, replacing the earlier scan of this commit`.** A `--rescan` replaced the commit's scan. A plain upload replaces it too when the dashboard couldn't prepare the stored scan, for example one that pages show as **Scan data couldn't be prepared** or **Scan data can't be read**.
- **`Error: Couldn't upload the scan: a1c9e04 was scanned with a newer CLI`.** A `--rescan` can't replace a scan made by a newer version of the CLI. The CLI asks before it scans, so it stops without scanning. Run the `npx` command the line names.
- **`Error: Couldn't upload the scan:` and another reason.** The dashboard refused the scan, either as it arrived (for example `it's larger than the dashboard accepts`) or while processing it (for example `this CLI is newer than the dashboard`). The line says what to do next. A refused scan never shows on any page. Add `--debug` to see the detail behind the line.
- **`Error: The dashboard is still processing the scan after 5 minutes.`** The CLI stopped waiting before the worker finished. The dashboard keeps working on the upload, and the scan appears if it succeeds.

Only a published scan or an existing one counts as success. Anything else makes the CLI exit with an error, so a CI job fails when its scan didn't make it in.

:::note
If every upload ends with `The dashboard is still processing the scan`, the worker is probably not running. [Deploy the dashboard](/docs/guides/deploy-the-dashboard) covers running it.
:::

## When a page shows Preparing scan data {#scan-preparing}

A scan that isn't ready affects only its own repo. When a repo's latest scan is still being prepared, couldn't be prepared or can't be read, pages show that repo's newest scan that is ready, and a band above the content says so, for example **storefront's latest scan couldn't be prepared · Showing 35e61ed, committed 23h ago.** A repo with no ready scan at all is left out of the pages that cover every repo, and the band names it. A chart over time leaves out the scans that aren't ready and lists them.

A page shows **Preparing scan data**, **Scan data couldn't be prepared** or **Scan data can't be read** instead of its content only when it has nothing to show: a repo's own pages before any of its scans is ready, an older scan you picked that isn't ready, and pages whose scans the dashboard is still rebuilding after an upgrade. These states are about data the dashboard has already stored, not about an upload: a failed upload never reaches the pages, and the CLI reports it.

The dashboard doesn't reread the raw artifact every time you open a page. When it publishes a scan, it also stores that scan in the shape its pages read. A new upload is prepared before it shows, so pages keep showing the previous scan until the new one is ready.

**Preparing scan data** in place of a page means it needs a scan whose stored data isn't ready for this version of the dashboard. The usual cause is an upgrade. The worker prepares those scans again on its own, starting with each repo's latest scan. The page checks again every few seconds and loads by itself once the worker has caught up.

Most pages read only each repo's latest scans, so they come back first. A chart over time needs every scan in its range, so it comes back last.

Some numbers are worked out by the worker ahead of time rather than when you open the page: the occurrences left on the **governance** page, the migration and retirement charts, the rows on a repo's **Adoption** tab, and chart previews on the **charts** page. The worker updates them after each new scan and after each change to a record, tag or chart, so they catch up a moment later and a reload shows the new numbers. Until the worker has worked them out for the first time, for example straight after an upgrade, they show **Preparing scan data**.

When a repo's latest scan couldn't be prepared or can't be read, they use its newest ready scan and name the repo above the numbers. **Numbers may be out of date** means the worker couldn't work them out again; ask your dashboard administrator to retry it.

All of this needs the worker running. Without it, **Preparing scan data** never clears.

### Scan data couldn't be prepared {#scan-preparation-failed}

**Scan data couldn't be prepared** means the worker tried and gave up, so waiting won't help. The page names the repo and commit of each scan that failed, and asks you to have your dashboard administrator retry it. In a band, the same failure reads **The latest scan couldn't be prepared**, with a **How to retry** link. Operators will find how in [Retry scans that failed to rebuild](/docs/guides/deploy-the-dashboard#retry-scans-that-failed-to-rebuild).

### Scan data can't be read {#scan-cant-be-read}

**Scan data can't be read** means the dashboard can't read a stored scan the page needs, so retrying won't help. The page names the repo and commit. Check out that commit and run `scout scan`, or rerun the CI job that scanned it: the new scan replaces the one that can't be read.

## Which scan a page shows

Most pages show each repo's *latest scan*: the scan of its newest commit. The dashboard dates each scan by its commit's date, not by when the scan ran or when the upload arrived. The CLI uploads only commits on the branch the dashboard tracks: the config's [`branch`](/docs/reference/config#upload-fields), else the remote's default branch. So a scan of a feature branch never becomes the repo's latest. A scan of an older commit uploaded later joins the repo's history without becoming its latest. The one exception is a commit dated after its scan reached the dashboard, for example one made on a computer whose clock runs fast: the dashboard places that scan by when it arrived.

Until the latest scan is ready, pages show the repo's newest scan that is, and say so above the content. If the latest scan couldn't be prepared, they keep showing the older one until someone retries it, uploads a new scan of that commit, or a scan of a newer commit arrives.

A repo page can show an older scan instead; see [Look at an older scan](/docs/guides/dashboard/repos#look-at-an-older-scan). [Reading the numbers](/docs/explanation/dashboard/reading-the-numbers) explains how the latest scans add up across repos.

## Self-hosted

There is no central Scout service to sign up for. You run your own dashboard: on your machine while you try it out ([Run the dashboard locally](/docs/guides/run-the-dashboard-locally)), or deployed for your team ([Deploy the dashboard](/docs/guides/deploy-the-dashboard)).

The main reason is the data. A scan is a detailed map of how your code uses its components, and most teams would rather keep that on infrastructure they control.
