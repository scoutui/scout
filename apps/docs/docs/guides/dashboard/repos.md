---
description: "See which components each repo uses, what changed since its previous scan, what the scan couldn't see, how to filter, share and look back through a repo's scans, and how Admins remove a scan or delete a repo."
sidebar_label: "Repos"
---

# Repos

The repos area shows every repo the dashboard has a [scan](/docs/reference/glossary#scan) for, and what its latest scan found. Use it to check how a repo uses your design system, spot [deprecated](/docs/reference/glossary#deprecated) components, and see what changed since the previous scan. For example, open `storefront` to see that it still uses `LegacyButton` from `@acme/ui-legacy`, how many files use it, and whether the latest scan used it less than the one before.

## Find a repo

Select **repos** in the top navigation. The dashboard opens here. Each row is one repo, with **Committed** (the date of the commit its numbers come from), how many **Components** its latest scan found, how many are **Deprecated**, and **Changes**: what was added, removed or changed since its previous scan.

![The repos list with four repos, the search box and the since previous scan chip](/img/dashboard/repos-list.png)

Type in the search box to match a repo's id, git remote or branch. Press the **since previous scan** chip to list only repos whose latest scan differs from the one before. Select a row to open the repo page.

If the list reads **No repos scanned yet.**, no scan has been uploaded. [Run in CI](/docs/guides/run-in-ci) sets up uploads from CI.

## Read a repo page

The header line gives the repo's git remote, the **commit** and **branch** the scan ran on, the date of that commit (after **committed**), and how many packages its components come from. When the remote is on GitHub or GitLab, the commit links to it there.

Below it, a status line tells you what needs attention:

- **Deprecated warning.** For example **2 deprecated components in use · 3 fewer than the previous scan**. To list just those components, press the **deprecated** chip above the table.
- **What changed since the previous scan.** For example **3 added · 8 removed · 18 changed since previous scan (3d earlier)**. *Added* components are new in this scan, *removed* ones were in the previous scan but not this one, and *changed* ones have a different number of [uses](/docs/reference/glossary#use). To list just those components, press the **since previous scan** chip above the table.

### Fix what the scan couldn't see

When the scan skipped a file, couldn't match some uses to a component, or couldn't tell where a web component comes from, the repo page says **This scan couldn't see everything**. When some of those problems are yours to fix, it also says how many there are, such as **16 things to fix**. The repo's numbers leave those uses out, or count them without a package.

Open **This scan couldn't see everything** to see each kind of problem: how many there are, the names or files that come up most, what to change, and **Learn more** for the details. For example, **3 uses of components that aren't imported**, with `AppMenu 2 · PromoBanner 1`, says to import each component where it's used. Make the change and scan again. A problem whose fix reads **Nothing to change**, such as components passed in as a prop, needs nothing from you.

## Find components in a repo

The **Components** tab lists every component in the scan, most-used first. Each row shows the component's **Package**, **Version**, how many **Files** use it and its total **Uses**. Select a row to open the component's page for this repo.

![The Components tab of vue-vben-admin filtered to the vue-ui-kits tag, with the deprecated chip and the Filter menu open on Package](/img/dashboard/repo-components-tab.png)

To narrow the table:

- Type part of a component's name into the search box. It also finds a component by a name files render it under, such as `SettingsHeader` after `import SettingsHeader from "./Header"`. A row found that way reads `written as SettingsHeader` under its name.
- Press the **deprecated** chip to show only deprecated components. While other filters are on, it reads, for example, **deprecated 3 of 12**: 3 of the 12 deprecated components in use match the other filters.
- Press the **since previous scan** chip to show what was added, removed or changed. Added and removed rows carry a badge, and **Uses** shows the change, for example `49 (+2)`.
- Press **Filter** to choose by **Origin** ([**External**](/docs/reference/glossary#external) or [**Local**](/docs/reference/glossary#local)), **Type**, **Package**, **Used in**, [**Tag**](/docs/reference/glossary#tag) or **Uses**. Picking two values in **Type**, **Package** or **Tag** shows components matching either; filters in different facets must all match.

**Type** offers **React**, **Vue**, **Web component** and **Undefined element**. **Web component** and **Undefined element** both pick out [web components](/docs/reference/glossary#web-component): **Web component** the ones a manifest or your code defines, [**Undefined element**](/docs/reference/glossary#undefined-element) the ones nothing defines.

In a monorepo, **Used in** lists the repo's packages. **Package** is where a component comes from, and **Used in** is where it's used: **Package** `@acme/ui` with **Used in** `@acme/web` lists the `@acme/ui` components that the `@acme/web` app uses.

Picking a package keeps only the components used in it. **Files** and **Uses** then count that package's files and uses, and the number of components and the **deprecated** chip count its components. You can pick one package at a time, and **since previous scan** isn't available while a package is picked. Scans from older CLI versions don't offer **Used in**: scan again with the latest CLI.

Each active filter shows as a pill you can remove, and **Clear all** removes them all.

The same name can appear on two rows when the repo imports a component through two entry points, such as `@acme/ui` and `@acme/ui/button`. They are two components, and the subpath row shows `button` under the name.

### Share a filtered view

The tab keeps its search and filters in the page URL, so you can copy the address bar and share the filtered table. To write or edit a link by hand, use these parameters:

| Parameter | Example |
| --- | --- |
| `q` | `q=Button`, which searches component names |
| `origin` | `origin=external`, `origin=local` |
| `kind` | `kind=react`, `kind=vue`, `kind=wc`, `kind=undefined-element` |
| `package` | `package=@acme/ui` |
| `tag` | `tag=acme-ui` |
| `deprecated` | `deprecated=true`, `deprecated=false` |
| `uses` | `uses=gte:10` for 10 or more, `uses=lte:10` for 10 or fewer (also `gt:`, `lt:`, or a number alone for exactly that many) |
| `used-in` | `used-in=@acme/web`, which keeps the components used in that package |
| `changed` | `changed=true` |

Different parameters must all match. Repeating `kind`, `package` or `tag` matches any of the values. Write a space as `+`. For example:

```text
/repos/acme-web?package=@acme/ui-legacy&deprecated=true&uses=gte:10
```

## Follow adoption in a repo

The **Adoption** tab follows each [migration](/docs/reference/glossary#migration) and [retirement](/docs/reference/glossary#retirement) that touches this repo, counting this repo alone. **Migrations in this repo** shows each one's progress as a share **migrated**, and **Retirements in this repo** as a count of uses **left**. Complete ones are kept behind **Show N complete**.

Select a row to open its chart: uses over time in this repo, scan by scan.

![The Adoption tab of vue-vben-admin, with the ant-design-vue to antdv-next migration open on its chart and the naive-ui retirement below](/img/dashboard/repo-adoption-tab.png)

If the tab reads **No migrations or retirements tracked yet.**, no [lifecycle record](/docs/reference/glossary#lifecycle-record) covers anything this repo has used. **Open Governance** takes you to the page where you add one; [Track a migration](/docs/guides/dashboard/track-a-migration) walks through it. [Reading the numbers](/docs/explanation/dashboard/reading-the-numbers#how-a-migrations-progress-is-counted) explains how progress is counted.

## Look at an older scan

Press the **scan** button in the header to open **Recent scans**, and pick one. **View all N scans →** opens the repo's **Scan history**, where **View scan** opens the repo page on any scan. The dashboard can't show a scan marked **couldn't be prepared** or **can't be read**. For **couldn't be prepared**, ask your dashboard administrator to retry it. For **can't be read**, scan that commit again to replace it.

On an older scan, the header, status line and **Components** tab describe the older scan, and what changed is compared with the scan before it. A component's page opened from the table still shows the latest scan. A component the latest scan doesn't have has no page, so its row has no link and reads **not in the latest scan**. The **Adoption** tab doesn't change with the scan you pick. Press **View latest scan** to go back.

A link copied while you look at an older scan opens the same scan.

:::note
If a repo's latest scan isn't ready, its pages show its newest scan that is, under a band such as **The latest scan couldn't be prepared · Showing 35e61ed, committed 23h ago.** The **repos** list does the same for each repo, and names any repo it leaves out because none of its scans is ready. See [When a page shows Preparing scan data](/docs/explanation/cli-and-dashboard#scan-preparing) for what to do.

If a page shows **Preparing scan data** instead of its content, the dashboard is still getting that scan's data ready, and the page loads by itself when it's done. See [Preparing scan data](/docs/explanation/cli-and-dashboard#scan-preparing).

**Scan data can't be read** means the dashboard can't read a stored scan the page needs. See [Scan data can't be read](/docs/explanation/cli-and-dashboard#scan-cant-be-read).
:::

## Remove a scan or delete a repo

[Admins](/docs/guides/manage-people-and-roles) can remove a scan that shouldn't count, such as a test run or a scan of the wrong branch, and delete a repo.

- **Remove a scan.** On the repo's **Scan history**, press **⋯** at the end of the scan's row, select **Remove scan**, then press **Remove**. If it was the latest scan, the scan before it becomes the latest. This can't be undone. On a repo's only scan the menu offers **Delete repo…** instead.
- **Delete a repo.** On the repo page, press **⋯** beside the repo's name and select **Delete repo…**. Type the repo's id, then press **Delete repo**. The repo and all its scans are deleted, and the repos list opens. The repo comes back the next time a scan of it is uploaded.

Charts leave out what you removed, earlier points included. A saved chart about a deleted repo stays, and its scope reads **storefront · missing**. **History** on the **Settings** page records who removed or deleted what.

## Next step

Found a component you want to follow across repos? [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used) takes you from its name to every repo and file that uses it.
