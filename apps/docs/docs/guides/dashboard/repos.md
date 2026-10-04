---
description: "See which components each repo uses, what changed since its previous scan, and how to filter, share and look back through a repo's scans."
sidebar_label: "Repos"
---

# Repos

The repos area shows every repo the dashboard has a [scan](/docs/reference/glossary#scan) for, and what its latest scan found. Use it to check how a repo uses your design system, spot [deprecated](/docs/reference/glossary#deprecated) components, and see what changed since the previous scan. For example, open `storefront` to see that it still uses `LegacyButton` from `@acme/ui-legacy`, how many files use it, and whether the latest scan used it less than the one before.

## Find a repo

Select **repos** in the top navigation. The dashboard opens here. Each row is one repo, with **Committed** (the date of the commit its numbers come from), how many **Components** its latest scan found, how many are **Deprecated**, and **Δ components**: what was added, removed or changed since its previous scan.

![The repos list with four repos, the search box and the since previous scan chip](/img/dashboard/repos-list.png)

Type in the search box to match a repo's id, git remote or branch. Press the **since previous scan** chip to list only repos whose latest scan differs from the one before. Select a row to open the repo page.

If the list reads **No repos scanned yet.**, no scan has been uploaded. The page shows the two commands that upload one, and [Run in CI](/docs/guides/run-in-ci) sets up uploads from CI.

## Read a repo page

The header line gives the repo's git remote, the **commit** and **branch** the scan ran on, the date of that commit (after **committed**), and how many packages its components come from. When the remote is on GitHub or GitLab, the commit links to it there. When the repo uses more than one framework, another line counts its components per framework.

When the scan left part of the repo out, a line under the header says what it covered, with paths from the repo root:

- **Scanned: everything except apps/playground.** The config's `exclude` names `apps/playground`.
- **Scanned: apps/web only.** The config is in `apps/web`.
- **Scanned:** `src/**/*.{ts,tsx,jsx,js,vue}` **only.** The config's `include` has the pattern `init` writes.

The line names the folders and files `exclude` leaves out, not its glob patterns. A scan of the whole repo has no line, and neither does a scan uploaded by an older CLI version. To change what's scanned, see [Configure a scan](/docs/guides/configure-a-scan).

Below it, a status line tells you what needs attention:

- **Deprecated warning.** For example **2 deprecated components in use · 3 fewer than the previous scan**. To list just those components, press the **deprecated** chip above the table.
- **What changed since the previous scan.** For example **3 added · 8 removed · 18 changed since previous scan (3d earlier)**. *Added* components are new in this scan, *removed* ones were in the previous scan but not this one, and *changed* ones have a different number of [uses](/docs/reference/glossary#use). To list just those components, press the **since previous scan** chip above the table. A repo with one scan reads **first scan · nothing to compare**.

## Find components in a repo

The **Components** tab lists every component in the scan, most-used first. Each row shows the component's **Package**, **Version**, how many **Files** use it and its total **Uses**. Select a row to open the component's page for this repo.

![The Components tab of vue-vben-admin filtered to the vue-ui-kits tag, with the deprecated chip and the Filter menu open on Package](/img/dashboard/repo-components-tab.png)

To narrow the table:

- Type part of a component's name into the search box. It also finds a component by a name files render it under, such as `SettingsHeader` after `import SettingsHeader from "./Header"`. A row found that way reads `written as SettingsHeader` under its name.
- Press the **deprecated** chip to show only deprecated components. While other filters are on, it reads, for example, **deprecated 3 of 12**: 3 of the 12 deprecated components in use match the other filters.
- Press the **since previous scan** chip to show what was added, removed or changed. Added and removed rows carry a badge, and **Uses** shows the change, for example `49 (+2)`.
- Press **Filter** to choose by **Origin** ([**External**](/docs/reference/glossary#external) or [**Local**](/docs/reference/glossary#local)), **Type**, **Package**, **Used in**, [**Tag**](/docs/reference/glossary#tag) or **Uses**. Picking two values in one facet shows components matching either; filters in different facets must all match.

**Type** offers **React**, **Vue**, **Web component** and **Undefined element**, and shows only when the repo has more than one. **Web component** and **Undefined element** both pick out [web components](/docs/reference/glossary#web-component): **Web component** the ones a manifest or your code defines, [**Undefined element**](/docs/reference/glossary#undefined-element) the ones nothing defines.

**Used in** shows when the scan finds components used in more than one of the repo's packages, as in a monorepo. It lists those packages, each with its folder, or **repo root** for the package at the top of the repo. **Package** is where a component comes from, and **Used in** is where it's used: **Package** `@acme/ui` with **Used in** `@acme/web` lists the `@acme/ui` components that the `@acme/web` app uses.

Picking a package keeps only the components used in it. **Files** and **Uses** then count that package's files and uses, and the number of components and the **deprecated** chip count its components. You can pick one package at a time, and the **since previous scan** chip is hidden while you do. Scans uploaded by older CLI versions don't record where each use sits, so they don't offer **Used in**.

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

Different parameters must all match. Repeating `kind`, `package` or `tag` matches any of the values. A `used-in` package the scan doesn't have, such as one renamed since the link was made, matches no components. Write a space as `+`. For example:

```text
/repos/acme-web?package=@acme/ui-legacy&deprecated=true&uses=gte:10
```

## Follow adoption in a repo

The **Adoption** tab follows each [migration](/docs/reference/glossary#migration) and [retirement](/docs/reference/glossary#retirement) that touches this repo, counting this repo alone. **Migrations in this repo** shows each one's progress as a share **migrated**, and **Retirements in this repo** as a count of uses **left**. Complete ones are kept behind **Show N complete**.

Select a row to open its chart: uses over time in this repo, scan by scan.

![The Adoption tab of vue-vben-admin, with the ant-design-vue to antdv-next migration open on its chart and the naive-ui retirement below](/img/dashboard/repo-adoption-tab.png)

If the tab reads **No migrations or retirements tracked yet.**, no [lifecycle record](/docs/reference/glossary#lifecycle-record) covers anything this repo has used. **Open Governance** takes you to the page where you add one; [Track a migration](/docs/guides/dashboard/track-a-migration) walks through it. [Reading the numbers](/docs/explanation/dashboard/reading-the-numbers#how-a-migrations-progress-is-counted) explains how progress is counted.

## Look at an older scan

Press the **scan** button in the header (it shows the scan's id) to open **Recent scans**, and pick one. **View all N scans →** opens the repo's **Scan history**, one row per scan, newest first. **Committed** is the date of the scanned commit and **Scanned** is when the scan reached the dashboard. **Scanned by** is the person who uploaded it, or **—** for a scan uploaded with a [CI upload token](/docs/guides/run-in-ci). **view scan** opens the repo page on that scan. The dashboard can't show a scan marked **couldn't be prepared** or **can't be read**. For **couldn't be prepared**, ask your dashboard administrator to retry it. For **can't be read**, scan that commit again to replace it.

An older scan shows a banner: **Viewing an older scan: committed 3mo ago, scanned 2d ago. Component pages show the latest scan.** The header, status line and **Components** tab describe the older scan, and what changed is compared with the scan before it. A component's page opened from the table still shows the latest scan. A component the latest scan doesn't have has no page, so its row has no link and reads **not in the latest scan**. The **Adoption** tab doesn't change with the scan you pick. Press **view latest →** to go back.

The page URL carries `?scan=` while an older scan is shown, so a shared link opens the same scan.

:::note
If a repo's latest scan isn't ready, its pages show its newest scan that is, under a band such as **The latest scan couldn't be prepared · Showing 35e61ed, committed 23h ago.** The **repos** list does the same for each repo, and names any repo it leaves out because none of its scans is ready. See [When a page shows Preparing scan data](/docs/explanation/cli-and-dashboard#scan-preparing) for what to do.

If a page shows **Preparing scan data** instead of its content, the dashboard is still getting that scan's data ready, and the page loads by itself when it's done. See [Preparing scan data](/docs/explanation/cli-and-dashboard#scan-preparing).

**Scan data can't be read** means the dashboard can't read a stored scan the page needs. See [Scan data can't be read](/docs/explanation/cli-and-dashboard#scan-cant-be-read).
:::

## Next step

Found a component you want to follow across repos? [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used) takes you from its name to every repo and file that uses it.
