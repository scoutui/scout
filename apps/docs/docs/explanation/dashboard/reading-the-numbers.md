---
description: "What the dashboard's counts, versions, deprecated marks, migration percentages and shares include, so you know what each number can tell you."
sidebar_label: "Reading the numbers"
---

# Reading the numbers

Almost every number in the dashboard counts one of two things: [components](/docs/reference/glossary#component) or [uses](/docs/reference/glossary#use). This page explains what each count includes, so you know what a number can and can't tell you. For where each number sits on screen, see [Repos](/docs/guides/dashboard/repos), [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used), [Packages](/docs/guides/dashboard/packages), [Charts](/docs/guides/dashboard/charts) and [Migrations and retirements](/docs/guides/dashboard/track-a-migration).

## Every number starts from each repo's latest scan

The dashboard keeps each repo's history of scans, but most pages read only each repo's latest scan, and numbers across repos add those latest scans together. A repo last scanned three months ago still counts, as it looked three months ago.

*Latest* means the scan of the newest commit: the dashboard dates each scan by its commit's date. The time of upload doesn't matter: uploading a scan of an older commit adds it to the repo's history without becoming its latest scan. The CLI uploads only commits on the branch the dashboard tracks, so a scan of a feature branch never becomes the repo's latest.

When a repo's latest scan isn't ready, its numbers come from its newest scan that is, and the page says so. A repo with no ready scan is left out of the totals until one is ready, and the page names it. See [When a page shows Preparing scan data](/docs/explanation/cli-and-dashboard#scan-preparing).

Two places read more than the latest scan:

- A repo page opened on an older scan shows that scan.
- Charts over time, including the charts on a repo page's **Adoption** tab, read the whole history. Each point in time uses every repo's most recent ready scan as of that moment.

A repo joins a chart over time at its first scan. A line starts at the first scan of a repo that uses it, and when another repo that uses it is scanned for the first time, the line can jump though no code changed. A small ring marks that point.

## Components, uses and files

These three counts answer different questions about the same code:

- A *component* is one distinct thing that gets used, such as `Button` from `@acme/ui`.
- A *use* is one place in the code where it appears.
- *Files* counts the files that hold at least one use.

If `storefront` uses `Button` in 40 places across 12 files, that is 1 component, 40 uses and 12 files.

Most tables sort by uses, and every chart counts them. Component counts tell you how far a library reaches. File counts tell you how spread out the work of changing a component would be.

Only uses the scan tied to a component are counted. [Uses it couldn't match](/docs/reference/glossary#unmatched-use) stay in the scan's JSON, but the dashboard leaves them out of every number.

Tables list every component the scan recorded, including ones with no uses, such as a page component that only your router loads, so you can find them. A repo's **Components** count includes them. A package's component count leaves them out, so a package page's **Components** table can have more rows than its header's count.

## Which components add up across repos

Whether a component counts once across all your repos, or once per repo, depends on its kind, as [How components are found](/docs/explanation/mental-model) explains:

- **A component [from a package](/docs/reference/glossary#external), or any [web component](/docs/reference/glossary#web-component), is the same component in every repo.** `Button` from `@acme/ui` used in `storefront` and `checkout` counts as one component across both, and so does `<acme-button>`.
- **A component [defined in the repo](/docs/reference/glossary#local) belongs to that repo.** A `Card` in `storefront` and a `Card` in `checkout` are separate code, even when their files look alike, so they count as two.

## Versions

The [version](/docs/reference/glossary#version) shown for a package is the one installed in the repo when the scan ran, not the version range your `package.json` asks for. Components defined in the repo, and web components that belong to no package, have no version and show as unversioned.

The version bar on a package page and on a component's page across repos splits uses by version. It colours the highest version found in your scans and greys out the rest, so the grey share is the code still on an older version.

The dashboard doesn't check what is published on npm, so "highest" can be behind the newest release. If every repo is on `4.2.0` and `5.0.0` is out, `4.2.0` still takes the colour.

## Where "deprecated" comes from

A component is [deprecated](/docs/reference/glossary#deprecated) in the dashboard only when a [lifecycle record](/docs/reference/glossary#lifecycle-record) marks it replaced or retired: a record on the component itself, on the component it is part of (a record on `Card` covers `Card.Header`), or on its whole package.

A record names a package, so it covers that package wherever a scan finds it: components imported from the package, web components the scan links to it, and components defined in a monorepo's workspace package of that name. A record on `@acme/ui` covers `Button` in the repos that install `@acme/ui` and in the monorepo where `@acme/ui` is written. Two repos whose workspace packages share a name, such as `@repo/ui`, share its records too.

A component defined in the repo outside every workspace package belongs to the repo's [root package](/docs/reference/artifact#root-package): the name in the root `package.json`, or the repo id when it has none. A record on that name covers it. In a repo that isn't a monorepo, that's every component the repo defines.

Deprecation is recorded once, on the **governance** page, not reported by each scan:

- A record applies to every repo at once, and to every scan already uploaded. No rescan is needed, and a migration chart can show the full history from the first scan that used the deprecated component.
- Nothing in your code or your packages marks a component deprecated, not even a `@deprecated` comment.

On every page, a deprecated count counts each component once, however many repos use it, and only while it has at least one use. A deprecated component a scan lists without using it, such as one the repo defines but never renders, keeps its warning icon but isn't counted. A component's page across repos says how many repos it is deprecated in.

## How a migration's progress is counted

A **Replaced** record names a deprecated side and its replacement, each a component or a whole package. A side that names a component counts it from every entry point, such as `@acme/ui` and `@acme/ui/card`, together with its parts, such as `Card.Header` for `Card`, unless a part has a record of its own. Progress reads **N% migrated**:

```text
N% migrated = replacement uses ÷ (deprecated-side uses + replacement uses)
```

If `checkout` has 30 uses of `LegacyButton` and 90 of its replacement `Button`, it reads **75% migrated**.

The denominator is the pair, not every use in the repo, so the other libraries a repo uses don't change its progress.

The replacement side counts only in repos that have used the deprecated side in any of their scans, so a repo that never needed to migrate doesn't raise the figure. If `storefront` uses `Button` 400 times and never used `LegacyButton`, the **charts** page still reads **75% migrated**, the same as `checkout`'s **Adoption** tab.

A repo that has finished still counts its uses of `Button`, because an earlier scan of it used `LegacyButton`. A repo first scanned after it finished has no uses of `LegacyButton` on record, so it isn't counted until you [fill in its history](/docs/guides/fill-in-a-repos-history) back to a commit that used it.

The replacement side counts only the component or package the record names. Until a repo that has used the deprecated side uses it, the row reads **0% migrated**.

A retirement has no replacement, so there is nothing to divide. It reads **N left**, the uses still in the code.

Records that name the same replacement, such as one record for each part of a compound component, are one migration: one row and one chart that count the uses of all their components together. The **governance** page still lists each record with its own uses left.

### How the change is counted

Each migration and retirement row shows **N left**, the deprecated side's uses in each repo's latest scan, and how that number changed: **6 fewer**, **2 more** or **no change**. Fewer is progress on every row. Uses of the replacement don't move it, so deleting code that uses the new component never reads as a step back.

The change covers the last 30 days, on the **charts** page and on a repo's **Adoption** tab alike, and each repo is compared with itself. A repo scanned for the first time in those 30 days counts from that first scan, so joining isn't a change, and the row on the **charts** page says it joined, for example **3 fewer · 1 repo added**.

A table chart's **Change** column counts the same way, whether the chart covers all repos or one. With **% of uses**, the change compares the same repos at both ends, so a repo joining doesn't move it.

A record is complete when the deprecated side has no uses in any latest scan: on a repo's **Adoption** tab, that repo's; on the **charts** page, every repo's. So a migration can be complete on one repo's **Adoption** tab and still in progress on the **charts** page. A repo that never used `LegacyButton` has no row for it on its **Adoption** tab.

## Why shares can overlap

A chart's share divides each series by the total of every series on the same chart. So a share is always a share of something smaller than the whole codebase: a package that no series covers, such as a third-party router, is left out, and adding or removing a series changes every other series' share.

Each series counts its own uses without checking the others. When one component falls into two series, it counts in both. The shares still add up to 100%, but the parts are not separate slices of the code. That happens when:

- Two tags match the same package.
- A chart holds a tag and a package under it, or a package and a component from it.
- A component defined in the repo lives in a workspace package that a tag or a package series matches. It counts there and under **local**.
- A tag or a package series matches the repo's [root package](/docs/reference/artifact#root-package). The repo's components outside every workspace package count there and under **local**.

On a share chart, where series can overlap, read their shares as a comparison between series, not a breakdown of the code. For a clean breakdown, pick series that can't contain each other, such as library tags whose patterns match different packages.
