---
description: "Why the dashboard's counts, versions, deprecated marks, migration percentages and shares are shaped the way they are."
sidebar_label: "Reading the numbers"
---

# Reading the numbers

Almost every number in the dashboard counts one of two things: [components](/docs/reference/glossary#component) or [uses](/docs/reference/glossary#use). This page explains the choices behind those counts, so you know what a number can and can't tell you. For where each number sits on screen, see [Repos](/docs/guides/dashboard/repos), [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used), [Packages](/docs/guides/dashboard/packages), [Charts](/docs/guides/dashboard/charts) and [Migrations and retirements](/docs/guides/dashboard/track-a-migration).

## Every number starts from each repo's latest scan

The dashboard keeps each repo's history of scans, but most pages read only each repo's latest scan, and numbers across repos add those latest scans together. A repo last scanned three months ago still counts, as it looked three months ago.

*Latest* means the scan of the newest commit: the dashboard dates each scan by its commit's date. The time of upload doesn't matter: uploading a scan of an older commit adds it to the repo's history without becoming its latest scan. The CLI uploads only commits on the branch the dashboard tracks, so a scan of a feature branch never becomes the repo's latest. A commit dated after its scan reached the dashboard, for example one made on a computer whose clock runs fast, is placed in the repo's history by when its scan arrived instead.

When a repo's latest scan isn't ready, its numbers come from its newest scan that is, and the page says so. A repo with no ready scan is left out of the totals until one is ready, and the page names it. See [When a page shows Preparing scan data](/docs/explanation/cli-and-dashboard#scan-preparing).

Two places read more than the latest scan:

- A repo page opened on an older scan shows that scan.
- Charts over time, including the charts on a repo page's **Adoption** tab, read the whole history. Each point in time uses every repo's most recent ready scan as of that moment.

A repo joins a chart over time at its first scan, so a line can jump when a repo is scanned for the first time, though no code changed. A chart across several repos says in its tooltip how many of them each point covers, for example **3 of 4 repos**. When the latest change comes from a repo's first scan, a table chart and the migration and retirement rows read **repo added** instead of the change.

## Components, uses and files

These three counts answer different questions about the same code:

- A *component* is one distinct thing that gets used, such as `Button` from `@acme/ui`.
- A *use* is one place in the code where it appears.
- *Files* counts the files that hold at least one use.

If `storefront` uses `Button` in 40 places across 12 files, that is 1 component, 40 uses and 12 files.

Most tables sort by uses and every chart counts them, because a component used 500 times matters more to a migration than one used twice. Component counts tell you how far a library reaches. File counts tell you how spread out the work of changing a component would be.

Only uses the scan tied to a component are counted. [Uses it couldn't match](/docs/reference/glossary#unmatched-use) stay in the scan's JSON, but the dashboard leaves them out of every number.

Tables list every component the scan recorded, including ones with no uses, such as a page component that only your router loads, so you can find them. A repo's **Components** count includes them. A package's component count leaves them out, so a package page's **Components** table can have more rows than its header's count.

## Which components add up across repos

Whether a component counts once across all your repos, or once per repo, depends on its kind, as [How components are found](/docs/explanation/mental-model) explains:

- **A component [from a package](/docs/reference/glossary#external), or a [web component](/docs/reference/glossary#web-component), is the same component in every repo.** `Button` from `@acme/ui` used in `storefront` and `checkout` counts as one component across both, and so does `<acme-button>`.
- **A component [defined in the repo](/docs/reference/glossary#local) belongs to that repo.** A `Card` in `storefront` and a `Card` in `checkout` are separate code, even when their files look alike, so they count as two.

## Versions

The [version](/docs/reference/glossary#version) shown for a package is the one installed in the repo when the scan ran, not the version range your `package.json` asks for. Components defined in the repo, and web components that belong to no package, have no version and show as unversioned.

The version bar on a package page and on a component's page across repos splits uses by version. It colours the highest version found in your scans and greys out the rest, so the grey share is the code still on an older version.

The dashboard doesn't check what is published on npm, so "highest" can be behind the newest release. If every repo is on `4.2.0` and `5.0.0` is out, `4.2.0` still takes the colour.

## Where "deprecated" comes from

A component is [deprecated](/docs/reference/glossary#deprecated) in the dashboard only when a [lifecycle record](/docs/reference/glossary#lifecycle-record) marks it replaced or retired: a record on the component itself, on the component it is part of (a record on `Card` covers `Card.Header`), or on its whole package.

A record names a package, so it covers that package wherever a scan finds it: components imported from the package, web components the scan links to it, and components defined in a monorepo's workspace package of that name. A record on `@acme/ui` covers `Button` in the repos that install `@acme/ui` and in the monorepo where `@acme/ui` is written. Two repos whose workspace packages share a name, such as `@repo/ui`, share its records too.

A component defined in the repo outside every workspace package belongs to the repo's [root package](/docs/reference/artifact#root-package): the name in the root `package.json`, or the repo id when it has none. A record on that name covers it. In a repo that isn't a monorepo, that's every component the repo defines. Scans uploaded by older CLI versions record no package for these components, so in those scans a record can't cover them.

Deprecation is a decision your team records once, on the **governance** page, rather than something each scan reports. That has two effects:

- A record applies to every repo at once, and to every scan already uploaded. No rescan is needed, and a migration chart can show the full history from the first scan that used the deprecated component.
- Nothing in your code or your packages marks a component deprecated, not even a `@deprecated` comment. Every deprecated mark in the dashboard traces back to one list you can read and edit.

Deprecated counts differ by page. A repo page counts each deprecated component once. The packages list and a package page add up across repos, so a deprecated component used in three repos counts three times, and the number falls as each repo moves off it. A component's page across repos says how many repos it is deprecated in.

## How a migration's progress is counted

A **Replaced** record names a deprecated side and its replacement, each a component or a whole package. A side that names a component counts it from every entry point, such as `@acme/ui` and `@acme/ui/card`, together with its parts, such as `Card.Header` for `Card`, unless a part has a record of its own. Progress reads **N% migrated**:

```text
N% migrated = replacement uses ÷ (deprecated-side uses + replacement uses)
```

If `checkout` has 30 uses of `LegacyButton` and 90 of its replacement `Button`, it reads **75% migrated**.

The denominator is the pair, not every use in the repo. A migration asks how much of the old one is left and how much of the new one has arrived, so the rest of the repo doesn't dilute it. A repo that also uses a charting library and a router shows the same progress as a repo that uses nothing else.

The replacement side counts every use of the replacement within the scope, including uses that never replaced anything. On a repo's **Adoption** tab the scope is that repo; on the **charts** page it is every repo. If `storefront` uses `Button` 400 times and never used `LegacyButton`, the **charts** page reads **94.2% migrated** (490 ÷ 520), while `checkout`'s **Adoption** tab still reads 75%.

If no scan within the scope has the replacement component yet, the replacement side counts every component of its package instead, and the row names the package rather than the component.

A retirement has no replacement, so there is nothing to divide. It reads **N left**, the uses still in the code.

A record is complete when the deprecated side has no uses in any latest scan within the scope. So a migration can be complete on one repo's **Adoption** tab and still in progress on the **charts** page. A repo that never used `LegacyButton` has no row for it on its **Adoption** tab.

## Why there is no single adoption percentage

The dashboard doesn't show one percentage for "how much of our code uses the design system". Such a number needs a denominator, and every candidate misleads. Divided by all uses, a repo that rightly uses other libraries reads as behind. Added up across repos, it blends teams with different needs into one figure that describes none of them.

Instead, each share has a denominator you chose:

- A migration's progress, measured against its own pair.
- A chart's share, measured against the series you put on it, such as your library [tags](/docs/reference/glossary#tag) and **local**.

## Why shares can overlap

A chart's share divides each series by the total of every series on the same chart. So a share is always a share of something smaller than the whole codebase: a package that no series covers, such as a third-party router, is left out, and adding or removing a series changes every other series' share.

Each series counts its own uses without checking the others. When one component falls into two series, it counts in both. The shares still add up to 100%, but the parts are not separate slices of the code. That happens when:

- Two tags match the same package.
- A chart holds a tag and a package under it, or a package and a component from it.
- A component defined in the repo lives in a workspace package that a tag or a package series matches. It counts there and under **local**.
- A tag or a package series matches the repo's [root package](/docs/reference/artifact#root-package). The repo's components outside every workspace package count there and under **local**.

On a share chart, where series can overlap, read their shares as a comparison between series, not a breakdown of the code. For a clean breakdown, pick series that can't contain each other, such as library tags whose patterns match different packages.
