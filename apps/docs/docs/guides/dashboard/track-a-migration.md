---
description: "Record that a package or component is replaced or retired, see it marked deprecated in every repo, and follow each repo's progress until no one uses it."
sidebar_label: "Migrations and retirements"
---

# Migrations and retirements

When your design system replaces or removes a component, record it once on the **governance** page and the dashboard follows it across every repo. For example, record that `LegacyButton` from `@acme/ui-legacy` is replaced by `Button` from `@acme/ui`. Every use of `LegacyButton` is then marked [deprecated](/docs/reference/glossary#deprecated), and a chart shows repos moving to `Button` scan by scan.

What you add is a [lifecycle record](/docs/reference/glossary#lifecycle-record). A **Replaced** record tracks a [migration](/docs/reference/glossary#migration); a **Retired** one tracks a [retirement](/docs/reference/glossary#retirement), for a component that goes with no replacement.

## Record a migration

1. Select **governance** in the top navigation and press **Add record**. With no records yet, the form is already open.
2. In **Package or component**, type a few words, such as `legacy button`. Every word must match the package name or the component name.
3. Pick what the record covers:
   - `LegacyButton` from `@acme/ui-legacy`, for that component, or
   - every component in `@acme/ui-legacy`: search for `legacy` instead, pick `@acme/ui-legacy`, then pick **All of @acme/ui-legacy**.
4. Leave **Type** on **Replaced**.
5. In **Replaced by**, type `button` and pick `Button` from `@acme/ui`. To make the whole of `@acme/ui` the replacement, search for `@acme/ui` instead, pick it, then pick **All of @acme/ui**.
6. Press **Create**.

![The New record form, filled in to record VxeButton from vxe-pc-ui as replaced by Button from tdesign-vue-next](/img/dashboard/governance-record-form.png)

The pickers only offer packages and components that appear in uploaded scans. If `LegacyButton` is missing, upload a scan of a repo that uses it first.

If `@acme/ui-legacy` is written in the same monorepo as the apps that use it, the pickers offer it too: pick the package to search its components.

A component [defined in the repo](/docs/reference/glossary#local) outside every workspace package is offered under the repo's [root package](/docs/reference/artifact#root-package): the name in the root `package.json`, or the repo id when it has none. In a repo that isn't a monorepo, that's every component the repo defines. Scans uploaded by older CLI versions record no package for these components, so if one is missing, scan the repo with the latest CLI. If the dashboard already has a scan of the commit you're on, run `npx scout scan --rescan` to replace it.

A [web component](/docs/reference/glossary#web-component) such as `<acme-button>` is offered under a package only when a scan links the tag to that package, and a record covers it only in the scans that make that link. [Link web components to your package](/docs/guides/link-web-components-to-your-package) shows how.

Each package or component can have one record, and a package has either one whole-package record or records on single components, not both. If saving is refused, a message in the form says why, and for an existing record usually offers **Go to the existing record** so you can edit that one instead.

## Record a retirement

Retire a component when it is being removed with no replacement, for example `Modal` from `@acme/ui-legacy`.

1. On the **governance** page, press **Add record**.
2. In **Package or component**, pick `Modal` from `@acme/ui-legacy`, or **All of @acme/ui-legacy**.
3. Set **Type** to **Retired**.
4. In **Reason**, say why it is going, for example `Removed in @acme/ui-legacy 4.0; no replacement.`
5. Press **Create**.

## What changes, and when

As soon as you save, every component the record covers shows as deprecated in every repo: warning icons, **deprecated** chips and the **Deprecated** columns. That includes scans already uploaded, so no rescan is needed. A record on `Card` covers it from every import path, such as `@acme/ui` and `@acme/ui/card`, and its parts, such as `Card.Header`.

The **governance** page then shows how much of each record's package or component is still in use, and where. Records are listed by package. Press the arrow beside a package's name to see its records.

Each record's **Uses left** reads one of these:

- A count of [uses](/docs/reference/glossary#use) across every repo's latest scan, such as `17 in acme/storefront`, or `20 in 2 repos` when several repos use it. With only one repo scanned, it's just the number.
- **None left**: it has been used before, and no repo's latest scan uses it now.
- **Not in any scan**: see [Not in any scan](#not-in-any-scan).
- **No data**: it hasn't been counted yet, usually because you've just added or changed the record. Reload the page after a moment to see its count.

![The governance page listing records by package, each with its replacement or reason and its uses left](/img/dashboard/governance-records.png)

## Follow progress

On the **governance** page, select a record's count to open its chart: uses over time of `LegacyButton` and `Button`, added up across the repos that have used `LegacyButton`. Each side counts its component from every import path, together with its parts. Until one of those repos uses `Button`, the `Button` line stays at 0. A retirement's chart shows the retired component alone.

To see where a record's component or package is still used, select the record's name.

The same charts are on the **charts** page, under **Migrations and retirements**, grouped by the package each record moves away from. Select `@acme/ui-legacy` to see its rows: a migration reads how much is **Migrated** and its **Uses left**, and a retirement its **Uses left**, the uses still in the code. Each row also shows how the uses left changed over the last 30 days. Records that name the same replacement, such as one for each part of a compound component, share one row and one chart. That chart draws each old component as its own line beside the replacement's, and the table under it lists each line's uses and how much they changed over the period you picked. See [Charts](/docs/guides/dashboard/charts).

To follow one repo, open it from **repos** and go to its **Adoption** tab. **Migrations and retirements in this repo** counts that repo alone, so its numbers can differ from the charts page, and a migration or retirement opens its chart for that repo. A repo that never used `LegacyButton` has no row for it. See [Follow adoption in a repo](/docs/guides/dashboard/repos#follow-adoption-in-a-repo).

[How a migration's progress is counted](/docs/explanation/dashboard/reading-the-numbers#how-a-migrations-progress-is-counted) explains the percentage.

## When a record reads None left

No button marks a record complete. It reads **None left** once no repo's latest scan uses `LegacyButton`, so finishing a migration means:

1. Remove the last uses of `LegacyButton` from each repo. To find them, open `LegacyButton` from its package page and see [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used).
2. Scan each of those repos and upload the scan. Every repo counts with its latest scan, however old, so a repo not scanned since it last used `LegacyButton` still counts its old uses. [Run in CI](/docs/guides/run-in-ci) keeps scans coming.

Once every record in a package reads **None left**, the **governance** page moves them behind **Show N complete**. On the **charts** page, each complete record moves to **Complete**. If a later scan uses `LegacyButton` again, the record counts it again. Keep the record once it is complete: it still marks any new use as deprecated.

## Not in any scan

A record reads **Not in any scan**, and has no chart, when none of the scans in the dashboard contain the package or component it names. The pickers only offer what scans contain, so this happens when the scans that used it have since been removed from the dashboard. Upload a scan of a repo that still uses it and the count comes back, with no edit needed. If no repo uses it any more, it keeps reading **Not in any scan**, and the record still marks any new use as deprecated.

## Edit or delete a record

To change a record, press its **Edit** button, change the form and press **Save**.

To delete a record, press **Delete** in the same form, then **Delete** again to confirm.

:::warning
Deleting a record removes its deprecated mark straight away, so a new use of `LegacyButton` shows as an ordinary component. Its chart and its rows on the **charts** page and on each repo's **Adoption** tab go too, once the dashboard has recalculated.
:::

## Next step

To compare whole libraries rather than one component, such as `@acme/ui` against `@acme/ui-legacy`, [tag your libraries](/docs/guides/dashboard/tag-your-libraries) and chart them. See [Charts](/docs/guides/dashboard/charts).
