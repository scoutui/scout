# @scoutui/web-app

## 0.1.1

### Patch Changes

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard's JSON API names a scan's commit date `committedAt` instead of `scannedAt`: in `/api/repos`, `/api/repos/{repoId}` (and its `diff.baselineCommittedAt`), `/api/repos/{repoId}/scans` and the `cells` of `/api/packages/{packageName}`.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard now treats the SSH and HTTPS remotes of one Bitbucket Data Center or Azure DevOps repository as the same repository, so a teammate who cloned the other way can upload. A Bitbucket Data Center repository cloned over HTTPS links to its repository page.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - When the dashboard refuses a CLI that's too old, or a rescan from an older CLI, the message now names the CLI version to use and an `npx` command that runs it. A sign-in refused because of the CLI's version now starts "Couldn't sign in" instead of "Couldn't upload the scan".

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The Scans page now shows when each commit was made and when its scan reached the dashboard, and the banner on an older scan shows both. The **Last scan** columns are now called **Updated**: they show the date of the repo's latest commit, as before. A commit dated in the future no longer stays a repo's latest scan until that date passes: the dashboard places it by when its scan arrived.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Pages with no scans yet show `scout scan` as the command to run, since the CLI now uploads by default.

  - The repo page says what to check when a scan finds no components.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - A scan that fails or is still being prepared no longer blocks pages for other repos. Each page shows a repo's newest ready scan and says when a newer one isn't ready. A repo with no ready scan is left out of the pages that cover every repo and named above them. Charts leave out scans that couldn't be prepared instead of waiting for them. Pages still wait while the dashboard rebuilds its stored scans after an upgrade.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The Packages page's filter now works like the filter on a repo's page:

  - Its counts, the deprecated count included, follow the other filters.
  - Tags and version states that no package matches are hidden, and Versions leaves the menu when only one state is left.
  - With no library tags, the Tag list links to Governance.
  - Tag colours keep their dark-mode shade.
  - A long search no longer runs under the clear button.
  - Screen readers hear which options are selected.
  - The search box no longer stretches across wide screens, and phones show the package count on its own line.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Dashboard messages and labels read in plain words: the governance form's search box, hints, errors and conflict messages, the Charts page's empty states, the device sign-in page, the page-not-found message and the composition canvas's "more" labels. The dot between items in a component's cross-repo header is now visible.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard records which CLI made each scan. `scout scan --rescan` can now replace a scan made by the previous CLI whatever its version, and the dashboard refuses an upload from the previous CLI with a note to install `@scoutui/cli` and scan again.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard now refuses a scan whose repository name it already has from a different git remote, and the message names that remote. A rescan from a release CLI is no longer refused because the commit was scanned with that version's prerelease. Repositories whose SSH remote is an `ssh://` URL or uses a user other than `git` now show their remote and link to their commits.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Pages waiting for scan data now keep their heading, load on their own when the data is ready, and name the repo and commit to fix instead of scan ids.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - A repo's Scan history page marks each scan that couldn't be prepared or can't be read, so you can find older scans to retry or scan again.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Every page now sends a Content-Security-Policy, so browsers only run scripts the dashboard sent.

  Behind more than one proxy, such as a CDN in front of the ingress, set `SCOUTUI_TRUSTED_PROXY_HOPS` to the number of proxies that add an address to `X-Forwarded-For`, so rate limits apply to each client instead of everyone at once. It defaults to 1, and the deploy guide shows how to check it.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Updates Next.js to 15.5.24, which fixes a critical remote code execution flaw in the image optimizer that could be reached without signing in, request forgery through rewrites and Server Actions, and a Server Actions denial of service. The dashboard image also moves to Auth.js core 0.41.3, which fixes a crash on malformed `Authorization` headers.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - When the dashboard can't take a scan you upload, the CLI now says what went wrong and what to do, such as "Couldn't upload the scan: it arrived damaged. Try again.", instead of a short note like "Scan processing failed".

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - When `SCOUTUI_UPLOAD_SLOT_WAIT_MS` plus `SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS` is over 270000 ms, the web server's startup error now shows both values and their total in milliseconds, and the most they can add up to. Before, the message ran its words together and left out a unit.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - A component's page has a rebuilt Usage tab. Filter its calls by folder and by any prop's values, including styling props, events and attributes, each in its own section. Search, filters and sort are kept in the page URL, so a copied link opens the same view. A call made inside a component names the components that render it. **Copy list** copies the calls in view. The Events tab is now part of the Usage tab, and the props line under the component's name is gone.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Tag, chart, and migration and retirement forms now refuse malformed input instead of storing it. Responses no longer name the web framework, and images you build yourself no longer pick up `.env` files from your checkout.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard now declares its `ulid` dependency itself. Before, it only worked because the CLI's copy happened to be installed next to it.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard image is smaller: it no longer includes the sharp image library, which the dashboard never used.

## 0.1.0

First public release. The Scout dashboard collects the scans your repos upload, so your team can see which repos use each component, where, and on which version, compare usage across repos and follow it over time. Tags group packages into libraries, and migration and retirement records follow each repo until a component is no longer used. People sign in through your OpenID Connect provider.
