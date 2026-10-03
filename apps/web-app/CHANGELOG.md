# @scoutui/web-app

## 0.2.0

### Minor Changes

- [#47](https://github.com/scoutui/scout/pull/47) [`bde4a34`](https://github.com/scoutui/scout/commit/bde4a3490ea55d924e7874a5a2f302780959f5e6) Thanks [@siggerzz](https://github.com/siggerzz)! - **Only deprecated components** replaces **deprecated only** in the chart builder. It's in the options of a tag or package series, and only when some, but not all, of the series' components are deprecated. It says how many are. A series with it on reads **deprecated only** on every chart type and in its tooltip.

  Also:

  - A chart can have a **Description**, shown under its name on its page.
  - The chart builder has **Cancel**, and says the chart needs a name before you press **Save chart**.
  - **Metric** shows **Share** while **Stacked** is picked, instead of disappearing.
  - With one repo picked, the **Tags** tab lists only the libraries that repo uses.
  - The note that series share components shows only when they can.

- [#33](https://github.com/scoutui/scout/pull/33) [`334c184`](https://github.com/scoutui/scout/commit/334c184564259a3408cc1eb1fd3af36ddc190fe8) Thanks [@siggerzz](https://github.com/siggerzz)! - CLI sign-ins now end after 30 days without use or 90 days after signing in, so sign-ins already older than 90 days stop working on upgrade, and a back-channel logout from the identity provider ends them too.

- [#44](https://github.com/scoutui/scout/pull/44) [`d165a0b`](https://github.com/scoutui/scout/commit/d165a0b021c8b9d6fdc9a2716c80b6b7eac06162) Thanks [@siggerzz](https://github.com/siggerzz)! - The governance page now lists every record in one table, grouped by the package it comes from. Occurrences left shows how much of each record's package or component is still used in each repo's latest scan and links to its trend, and a record's name links to its component or package page. Packages with nothing left fold behind Show N complete, and following a link to a record marks its row. Edit opens the form in place of the row, with Delete inside it and a line saying who added and last changed the record. Tags are a table showing each tag's colour, its packages (long lists fold behind +N more) and how many scanned packages it matches, and the tag form previews its matches as you type. For a few minutes after upgrading, while the dashboard rebuilds its stored results, counts on the governance page read No data, and the charts page's migration and retirement rows and each repo's Adoption tab show Preparing scan data.

- [#45](https://github.com/scoutui/scout/pull/45) [`5855dc5`](https://github.com/scoutui/scout/commit/5855dc50274f1934a6f23b4064963818f572dafe) Thanks [@siggerzz](https://github.com/siggerzz)! - In the governance form, Package or component and Superseded by are now search boxes that name each component's package. Pick a package to search only in it or to record all of it, and Create keeps the form open so you can add one record after another. For a few minutes after upgrading, the governance page reads Preparing scan data.

- [#32](https://github.com/scoutui/scout/pull/32) [`390833f`](https://github.com/scoutui/scout/commit/390833f63d7bacfafb428d6c024e0c0fa0ed8feb) Thanks [@siggerzz](https://github.com/siggerzz)! - Filtered pages keep each filter in its own readable URL parameter, such as `/repos/acme-web?package=@acme/ui&deprecated=true&occurrences=gte:10`, and `q` is only ever the search text. Links shared in the old `?q=` form open the page without their filters.

- [#35](https://github.com/scoutui/scout/pull/35) [`787c4f9`](https://github.com/scoutui/scout/commit/787c4f9b174dc925d8fb16d141d4ba9fff0ac0e8) Thanks [@siggerzz](https://github.com/siggerzz)! - A repo's Scan history page shows who uploaded each scan in a new **Scanned by** column: the person's name, or their email if their account has no name, and **—** for a scan uploaded with a CI upload token. Column headers are now in capitals on every table; sortable ones used to show in normal case.

### Patch Changes

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard's JSON API names a scan's commit date `committedAt` instead of `scannedAt`: in `/api/repos`, `/api/repos/{repoId}` (and its `diff.baselineCommittedAt`), `/api/repos/{repoId}/scans` and the `cells` of `/api/packages/{packageName}`.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard now treats the SSH and HTTPS remotes of one Bitbucket Data Center or Azure DevOps repository as the same repository, so a teammate who cloned the other way can upload. A Bitbucket Data Center repository cloned over HTTPS links to its repository page.

- [#37](https://github.com/scoutui/scout/pull/37) [`a5ed1bb`](https://github.com/scoutui/scout/commit/a5ed1bb54d621e18cc1be4eeaa8fa53d2a6a82d8) Thanks [@siggerzz](https://github.com/siggerzz)! - Charts now pick each line's colour, and every line follows dark mode. A tag keeps its colour unless a deprecated, successor or Local line, or a tag earlier on the chart, already has it or one like it. Other lines take the next chart colour that looks unlike those already drawn, and once those run out, neighbouring bands still differ. Lines no longer dash: their colour, end label and legend entry tell them apart.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - When the dashboard refuses a CLI that's too old, or a rescan from an older CLI, the message now names the CLI version to use and an `npx` command that runs it. A sign-in refused because of the CLI's version now starts "Couldn't sign in" instead of "Couldn't upload the scan".

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The Scans page now shows when each commit was made and when its scan reached the dashboard, and the banner on an older scan shows both. The **Last scan** columns are now called **Updated**: they show the date of the repo's latest commit, as before. A commit dated in the future no longer stays a repo's latest scan until that date passes: the dashboard places it by when its scan arrived.

- [#4](https://github.com/scoutui/scout/pull/4) [`43e0078`](https://github.com/scoutui/scout/commit/43e0078bdfa33659e325cebb9ac4840e9b25952b) Thanks [@siggerzz](https://github.com/siggerzz)! - Scrollbars and native controls, such as the chart builder's repo list, now match the dashboard's theme, including when you pick a theme different from your system's. Every scrolling area uses the same quiet scrollbar, so dark mode no longer shows white scrollbar tracks.

- [#6](https://github.com/scoutui/scout/pull/6) [`9149a9f`](https://github.com/scoutui/scout/commit/9149a9f1215566eaa3cfb989e969fa06ca5d5dbd) Thanks [@siggerzz](https://github.com/siggerzz)! - The **deprecated** chip on a repo's Components tab and the Packages page now agrees with the warning line above the table: with other filters on it reads, for example, **deprecated 11 of 12**. When the filters leave nothing to show, the **deprecated** and **since previous scan** chips stay in place, dimmed, instead of disappearing and moving the Filter button. A filter pill's remove button now tells screen readers which filter it removes, and the Packages count reads **162 packages**.

- [#39](https://github.com/scoutui/scout/pull/39) [`d8e76a4`](https://github.com/scoutui/scout/commit/d8e76a4cbe3d311af5070d8c6079b73120aaa5ff) Thanks [@siggerzz](https://github.com/siggerzz)! - Every chart type now marks a deprecated series with the warning triangle next to its name, as the trend chart's legend already did: the share bar above a share-over-time chart, the table, the bar chart and the chart builder's series list. Screen readers hear "deprecated" with the name, so colour is no longer the only sign.

- [#42](https://github.com/scoutui/scout/pull/42) [`b078916`](https://github.com/scoutui/scout/commit/b078916f64d2c988d0722fc1529bc65f859860e5) Thanks [@siggerzz](https://github.com/siggerzz)! - Charts over time no longer pass off a repo's first scan as a change. A chart across several repos says in its tooltip how many of them each point covers, for example **3 of 4 repos**. When the latest change comes from a repo's first scan, a table chart's **Change** column and the migration and retirement rows read **repo added** instead of a change that only reflects the new repo. Every total stays as it was. Right after the upgrade, the migration and retirement rows show **Preparing scan data** until the dashboard has rebuilt them.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Pages with no scans yet show `scout scan` as the command to run, since the CLI now uploads by default.

  - The repo page says what to check when a scan finds no components.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Times less than a minute old read "just now" everywhere, instead of "0m ago" between 45 and 59 seconds. A scan diff against a scan from the same minute says "same time" instead of "0m earlier".

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - A scan that fails or is still being prepared no longer blocks pages for other repos. Each page shows a repo's newest ready scan and says when a newer one isn't ready. A repo with no ready scan is left out of the pages that cover every repo and named above them. Charts leave out scans that couldn't be prepared instead of waiting for them. Pages still wait while the dashboard rebuilds its stored scans after an upgrade.

- [#40](https://github.com/scoutui/scout/pull/40) [`b61a3dd`](https://github.com/scoutui/scout/commit/b61a3dd2e5c93a663c07ceca3198cdbc9fe52843) Thanks [@siggerzz](https://github.com/siggerzz)! - On a repo page showing an older scan, a component that the latest scan doesn't have no longer links to a page that says it can't be found. Its row has no link and reads **not in the latest scan**.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The Packages page's filter now works like the filter on a repo's page:

  - Its counts, the deprecated count included, follow the other filters.
  - Tags and version states that no package matches are hidden, and Versions leaves the menu when only one state is left.
  - With no library tags, the Tag list links to Governance.
  - Tag colours keep their dark-mode shade.
  - A long search no longer runs under the clear button.
  - Screen readers hear which options are selected.
  - The search box no longer stretches across wide screens, and phones show the package count on its own line.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Dashboard messages and labels read in plain words: the governance form's search box, hints, errors and conflict messages, the Charts page's empty states, the device sign-in page, the page-not-found message and the composition canvas's "more" labels. The dot between items in a component's cross-repo header is now visible.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard records which CLI made each scan. `scout scan --rescan` can now replace a scan made by the previous CLI whatever its version, and the dashboard refuses an upload from the previous CLI with a note to install `@scoutui/cli` and scan again.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard now refuses a scan whose repository name it already has from a different git remote, and the message names that remote. A rescan from a release CLI is no longer refused because the commit was scanned with that version's prerelease. Repositories whose SSH remote is an `ssh://` URL or uses a user other than `git` now show their remote and link to their commits.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Pages waiting for scan data now keep their heading, load on their own when the data is ready, and name the repo and commit to fix instead of scan ids.

- [#38](https://github.com/scoutui/scout/pull/38) [`5daa39b`](https://github.com/scoutui/scout/commit/5daa39b0390dadc582cacc4463d64213e1e66b0d) Thanks [@siggerzz](https://github.com/siggerzz)! - The Scan history page shows each scan ID in its short form, as the scan switcher does. Hover over it to see the full ID.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - A repo's Scan history page marks each scan that couldn't be prepared or can't be read, so you can find older scans to retry or scan again.

- [#12](https://github.com/scoutui/scout/pull/12) [`d6323da`](https://github.com/scoutui/scout/commit/d6323dad8c9d5683a85b1adfdcf6f5af1eb5292c) Thanks [@siggerzz](https://github.com/siggerzz)! - The name "Scout" on the sign-in pages is now set in Geologica, like the header.

- [#36](https://github.com/scoutui/scout/pull/36) [`4cf7ada`](https://github.com/scoutui/scout/commit/4cf7ada24caaff8bd57203faf6cf9bcffd57b4a5) Thanks [@siggerzz](https://github.com/siggerzz)! - Charts draw Local in a lighter grey, so a colour-blind reader can tell it apart from a teal line, and teal is a little brighter in light mode so it stands apart from blue. Dark mode is unchanged.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Every page now sends a Content-Security-Policy, so browsers only run scripts the dashboard sent.

  Behind more than one proxy, such as a CDN in front of the ingress, set `SCOUTUI_TRUSTED_PROXY_HOPS` to the number of proxies that add an address to `X-Forwarded-For`, so rate limits apply to each client instead of everyone at once. It defaults to 1, and the deploy guide shows how to check it.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Updates Next.js to 15.5.24, which fixes a critical remote code execution flaw in the image optimizer that could be reached without signing in, request forgery through rewrites and Server Actions, and a Server Actions denial of service. The dashboard image also moves to Auth.js core 0.41.3, which fixes a crash on malformed `Authorization` headers.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - When the dashboard can't take a scan you upload, the CLI now says what went wrong and what to do, such as "Couldn't upload the scan: it arrived damaged. Try again.", instead of a short note like "Scan processing failed".

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - When `SCOUTUI_UPLOAD_SLOT_WAIT_MS` plus `SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS` is over 270000 ms, the web server's startup error now shows both values and their total in milliseconds, and the most they can add up to. Before, the message ran its words together and left out a unit.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - A component's page has a rebuilt Usage tab. Filter its calls by folder and by any prop's values, including styling props, events and attributes, each in its own section. Search, filters and sort are kept in the page URL, so a copied link opens the same view. A call made inside a component names the components that render it. **Copy list** copies the calls in view. The Events tab is now part of the Usage tab, and the props line under the component's name is gone.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - Tag, chart, and migration and retirement forms now refuse malformed input instead of storing it. Responses no longer name the web framework, and images you build yourself no longer pick up `.env` files from your checkout.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard now declares its `ulid` dependency itself. Before, it only worked because the CLI's copy happened to be installed next to it.

- [#29](https://github.com/scoutui/scout/pull/29) [`156c6a9`](https://github.com/scoutui/scout/commit/156c6a91cb905807999f51116628977fb56e990f) Thanks [@siggerzz](https://github.com/siggerzz)! - Includes security fixes in its dependencies.

- [#30](https://github.com/scoutui/scout/pull/30) [`8d99305`](https://github.com/scoutui/scout/commit/8d99305f75f67c630c1502db86810c83207811ed) Thanks [@dependabot](https://github.com/apps/dependabot)! - The dashboard image now runs on Node 24.21.0.

- [`e808e58`](https://github.com/scoutui/scout/commit/e808e588f2675c7019f6e1d569e41fde4a42eba1) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard image is smaller: it no longer includes the sharp image library, which the dashboard never used.

- [#5](https://github.com/scoutui/scout/pull/5) [`e2eaceb`](https://github.com/scoutui/scout/commit/e2eaceb23b14855365fb7de66223fe569c6f5e37) Thanks [@siggerzz](https://github.com/siggerzz)! - The name "Scout" in the header is now set in Geologica.

## 0.1.0

First public release. The Scout dashboard collects the scans your repos upload, so your team can see which repos use each component, where, and on which version, compare usage across repos and follow it over time. Tags group packages into libraries, and migration and retirement records follow each repo until a component is no longer used. People sign in through your OpenID Connect provider.
