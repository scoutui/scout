---
description: "Follow every migration and retirement across your repos, and build saved charts that compare libraries, packages or components scan by scan."
sidebar_label: "Charts"
---

# Charts

The charts area shows how usage changes across your repos over time. It holds the running status of every [migration](/docs/reference/glossary#migration) and [retirement](/docs/reference/glossary#retirement), and the charts you save to compare libraries, packages or components across [scans](/docs/reference/glossary#scan).

For example, with the tags `acme-ui` and `acme-ui-legacy` in place, one saved chart shows the new library's usage rising while the old one falls, scan by scan, across every repo.

## Read the charts list

Select **charts** in the top navigation. The page has these parts:

- **Migrations**: one row per migration, such as `LegacyButton · @acme/ui-legacy` to `Button · @acme/ui`, reading **N% migrated** and **N left**, the [uses](/docs/reference/glossary#use) of the deprecated side still in the code. Records that name the same replacement share one row.
- **Retirements**: one row per retirement, reading **N left**, the uses still in the code.
- **Saved charts**: one row per chart [shared with everyone](#share-a-chart), with its name, chart type, scope and a small preview. A row marked **Some components can't be found** needs [fixing](#fix-a-chart-with-missing-components).
- **Private**: your own charts that aren't shared.
- **Other people's charts**: for Admins only, everyone else's private charts and who created them.

Beside each row is the change in uses left over the last 30 days, such as **6 fewer** in green or **2 more** in red. [How the change is counted](/docs/explanation/dashboard/reading-the-numbers#how-the-change-is-counted) explains what it compares. Rows in progress come first, with the most uses left at the top. Complete ones sit behind **Show N complete**.

![The charts list with eight migrations and four retirements in progress, and four saved charts with their previews](/img/dashboard/charts-list.png)

Select any row to open its chart.

## Chart types

| Chart type | What it shows |
| --- | --- |
| **Trend** | One line per series over time. |
| **Bars** | One bar per series, counted from each repo's latest scan. |
| **Stacked** | Each series' share of the chart, as one bar for the latest scans and as bands over time. |
| **Table** | One row per series, with its latest value, the change since the previous scan and how many components it holds. |

A *series* is one line, bar or row on the chart. Over time, a chart gains a point for each new commit scanned in a repo in its scope.

## Build a chart

To compare libraries you need a [tag](/docs/reference/glossary#tag) for each. [Tags](/docs/guides/dashboard/tag-your-libraries) shows how to create `acme-ui` and `acme-ui-legacy`, the two used here. Package and component series need no tag.

1. On the charts page, press **New chart**.
2. Type a name into **Name**, for example `acme-ui vs acme-ui-legacy`. You can also add a **Description**, which shows under the chart's name on its page.
3. Under **Repos**, keep **All repos**, or pick one repo such as `storefront`.
4. Under **Chart type**, pick **Trend**.
5. Under **Metric**, keep **Uses** to chart uses, or pick **Share** for each series' share of the chart's total. **Stacked** always shows share, so **Metric** stays on **Share** when you pick it.
6. In the **Series** panel, on the **Tags** tab, press `acme-ui`, then `acme-ui-legacy`. Each gets a `✓` and appears in the list at the top of the panel with its colour. The preview on the right redraws as you go.
7. Press **Save chart**. The chart opens on its own page and appears under **Private** on the charts page.

![The new chart builder with All repos, Trend, the vben and payload-ui tags as series, and the live preview](/img/dashboard/chart-builder.png)

If the preview reads **Trends appear once these repos have been scanned more than once.**, the repos in scope have only been scanned once. Save the chart anyway: it fills in as new scans arrive.

### Add other kinds of series

The picker's other entries chart more than tags:

- **Local components**, at the end of the **Tags** tab, counts every component [defined in the repo](/docs/reference/glossary#local) rather than imported from a package.
- The **Packages** tab adds one package, such as `@acme/icons`.
- The **Components** tab adds one component, such as `Button` from `@acme/ui`. When two components share a name, the subpath one shows its entry point beside the package, such as `@acme/ui · button`.

With one repo picked under **Repos**, the **Tags**, **Packages** and **Components** tabs list only what that repo's latest scan contains. A tab shows at most 50 entries, so type into the search box to find the rest. To remove a series, press its **×** in the list, or press its entry in the picker again.

### Count only deprecated components

To see how much [deprecated](/docs/reference/glossary#deprecated) code a library still has, open the options of a tag or package series in the list at the top of the **Series** panel and choose **Only deprecated components**. The series then counts only the components a [lifecycle record](/docs/reference/glossary#lifecycle-record) marks as replaced or retired. If no record covers any of them, the series drops to zero.

A series has this option only when some, but not all, of its components are deprecated. With it on, the series reads **deprecated** after its name in the list, and **deprecated only** on the chart.

## Share a chart

A new chart is private: only you and Admins can open it. To share it, open it, press **⋯**, then **Share with everyone**. It moves to **Saved charts**, and anyone signed in to the dashboard can open it. **Make private** in the same menu takes it back.

To send someone a chart, send them its page's address. Someone who can't open a private chart sees **This chart is private.** and who to ask instead.

A chart's page shows who created it under its name.

## Copy a chart

To start from a chart someone else made, open it, press **⋯**, then **Duplicate**. The chart builder opens with the chart's series and settings, named **Copy of** and the chart's name. Change what you need and press **Save chart** to save it as a new private chart of your own.

## Look at a shorter period or one line

On a **Trend** or **Stacked** chart whose scans span more than 3 months, pick **3 months**, **6 months**, **1 year** or **All** above the chart. The period ends at the chart's latest scan, and the chart's scale fits the period. The link keeps your pick, so whoever you send it to sees the same period.

To see one line of a **Trend** chart on its own, press its name under the chart. Press it again to see every line. A chart with six or more lines lists them in a table under the chart, with each line's latest uses or share. Press a column heading to sort it, and press a name to see that line on its own.

## Change or delete a chart

On a chart's page, except for a **Stacked** chart, the **Uses** and **Share** toggle switches the view without changing the saved chart.

Only the person who created a chart, or an Admin, can change or delete it, so only they see **Edit** and **Delete**.

To change the chart itself, press **Edit**. The chart builder opens with the chart's name, repos, chart type, metric and series. Make your changes and press **Save chart** to update the same chart, or **Cancel** to leave without saving. The period picked above the preview when you save is the one the chart opens at.

To delete a chart, open it, press **Delete**, then **Delete chart**. Deleting can't be undone.

### Fix a chart with missing components

A chart leaves off any series the dashboard can no longer find, and its row on the charts list reads **Some components can't be found**. That happens when a tag has been deleted, or when none of the chart's scans holds a component.

1. Open the chart and press **Edit**.
2. In the list at the top of the **Series** panel, find the greyed-out series. It reads **Unknown component**, or **Deleted tag** for a tag, when the dashboard has no name left for it.
3. Press its **×** to remove it. To keep charting that component, add it again from the **Components** tab. A chart needs at least one series before you can save it.
4. Press **Save chart**.

## Migration and retirement charts

You don't build these. Each comes from a lifecycle record on the **governance** page, and shows uses over time across every repo: the deprecated side and its replacement for a migration, the retired side alone for a retirement. A record only gets a row once a scan has used what it names.

These charts have no **Edit** or **Delete**. One goes away when its record is deleted. See [Migrations and retirements](/docs/guides/dashboard/track-a-migration).

## Good to know

- With **Share** or **Stacked**, series can share components, for example a tag and a package under that tag, or **Local components** with a package. A component in two series counts in both. See [Why shares can overlap](/docs/explanation/dashboard/reading-the-numbers#why-shares-can-overlap).
- The **Migrations** and **Retirements** rows and the saved-chart previews on the charts list catch up a moment after a scan is uploaded or a record, tag or chart is saved. A chart you've just saved shows a flat preview until then.
- A chart over time leaves out scans that aren't ready and lists them above the chart, for example **1 scan is left out**. A chart of the latest scans uses each repo's newest ready scan and says which repos it shows at an older scan.
- If the new chart builder or a chart's page shows **Preparing scan data** instead of its content, the dashboard is still getting scan data ready, and the chart loads by itself when it's done. **Scan data can't be read** means the dashboard can't read a stored scan the chart needs. See [When a page shows Preparing scan data](/docs/explanation/cli-and-dashboard#scan-preparing).

## Next step

Record a migration so its progress charts itself: see [Migrations and retirements](/docs/guides/dashboard/track-a-migration).
