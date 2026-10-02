---
description: "Record that a package or component is superseded or retired, see it marked deprecated in every repo, and follow each repo's progress until no one uses it."
sidebar_label: "Migrations and retirements"
---

# Migrations and retirements

When your design system replaces or removes a component, record it once on the **governance** page and the dashboard follows it across every repo. For example, record that `LegacyButton` from `@acme/ui-legacy` is superseded by `Button` from `@acme/ui`. Every use of `LegacyButton` is then marked [deprecated](/docs/reference/glossary#deprecated), and a chart shows repos moving to `Button` scan by scan.

What you add is a [lifecycle record](/docs/reference/glossary#lifecycle-record). A superseded record tracks a [migration](/docs/reference/glossary#migration); a retired one tracks a [retirement](/docs/reference/glossary#retirement), for a component that goes with no replacement.

## Record a migration

1. Select **governance** in the top navigation and press **Add record**. With no records yet, the form is already open.
2. Open **Package or component** and type a few words, such as `legacy button`. Every word must match the package name or the component name.
3. Pick what the record covers:
   - the `LegacyButton` row under `@acme/ui-legacy`, for that component, or
   - the **whole package** row for `@acme/ui-legacy`, for every component in it.

   The hint under the field confirms which one you picked.
4. Leave **Type** on **Superseded**.
5. Open **Superseded by** and pick the `Button` row under `@acme/ui`. If you pick the package row instead, the whole of `@acme/ui` counts as the replacement.
6. Press **Create**.

![The New record form with react-date-picker as the source, Superseded selected, and react-datepicker as the replacement](/img/dashboard/governance-record-form.png)

The pickers only offer packages and components that appear in uploaded scans. If `LegacyButton` is missing, upload a scan of a repo that uses it first. Components [defined in the repo](/docs/reference/glossary#defined-in-the-repo) are never offered.

A [web component](/docs/reference/glossary#web-component) such as `<acme-button>` is offered under a package only when a scan links the tag to that package, and a record covers it only in the scans that make that link. [Link web components to your package](/docs/guides/link-web-components-to-your-package) shows how.

Each package or component can have one record, and a package has either one whole-package record or records on single components, not both. If saving is refused, a message in the form says why, and for an existing record usually offers **Go to the existing record** so you can edit that one instead.

## Record a retirement

Retire a component when it is being removed with no replacement, for example `Modal` from `@acme/ui-legacy`.

1. On the **governance** page, press **Add record**.
2. In **Package or component**, pick the `Modal` row under `@acme/ui-legacy`, or the package's **whole package** row.
3. Set **Type** to **Retired**.
4. In **Reason**, say why it is going, for example `Removed in @acme/ui-legacy 4.0; no replacement.`
5. Press **Create**.

## What changes, and when

As soon as you save, every component the record covers shows as deprecated in every repo: warning icons, **deprecated** chips and the **Deprecated** columns. That includes scans already uploaded, so no rescan is needed. A record on `Card` covers it from every import path, such as `@acme/ui` and `@acme/ui/card`, and its parts, such as `Card.Header`.

The **governance** page lists every record in one **Records** table, grouped by the package each record comes from. Records on single components sit under a row with their package's name and total. A record on a whole package is a row of its own, with **Whole package · N components** under its name. Each row says what was decided: **Superseded by** and the replacement, or **Retired** and the reason.

**Occurrences left** counts how many [occurrences](/docs/reference/glossary#occurrence) of the record's package or component are still in each repo's latest scan. It reads one of these:

- A count, such as `17 in acme/storefront` when one repo still uses it, or `20 in 2 repos` when several do. When only one repo has been scanned, it reads just the number, such as `17`.
- **None left**: it has been used before, and no repo's latest scan uses it now. See [When a record reads None left](#when-a-record-reads-none-left).
- **Not in any scan**: see [Not in any scan](#not-in-any-scan).
- **No data**: the dashboard hasn't counted it yet. A new or changed record reads **No data** for a moment after you save, and so can every record for a few minutes after the dashboard is upgraded. Reload the page to see the count.

Packages with the most occurrences left come first, and so do the records inside each package.

![The governance page listing lifecycle records, each with its replacement or reason and its status](/img/dashboard/governance-records.png)

## Follow progress

On the **governance** page, select a record's count under **Occurrences left** to open its chart: occurrences over time of `LegacyButton` and `Button`, added up across every repo. Each side counts its component from every import path, together with its parts. If no scan the chart covers has `Button` yet, the successor side counts all of `@acme/ui` instead and is labelled with the package name. A retirement's chart shows the retired component alone.

To see where a record's package or component is still used, select its name. A record on a component opens that component's page, or its package's page filtered to it when the record covers more than one component, such as `Card` and `Card.Header`. A record on a whole package, and a package's name on its row, open the package's page. A name isn't a link when nothing it covers is in any repo's latest scan.

The same charts are on the **charts** page. Each migration has a row under **Migrations** reading **N% migrated**, and each retirement a row under **Retirements** reading **N remaining**, the occurrences still in use. See [Charts](/docs/guides/dashboard/charts).

To follow one repo, open it from **repos** and go to its **Adoption** tab. **Migrations in this repo** and **Retirements in this repo** count that repo alone, so their numbers can differ from the charts page. A repo that never used `LegacyButton` has no row for it. See [Follow adoption in a repo](/docs/guides/dashboard/repos#follow-adoption-in-a-repo).

[How a migration's progress is counted](/docs/explanation/dashboard/reading-the-numbers#how-a-migrations-progress-is-counted) explains the percentage.

## When a record reads None left

No button marks a record complete. It reads **None left** once no repo's latest scan uses `LegacyButton`, so finishing a migration means:

1. Remove the last uses of `LegacyButton` from each repo. To find them, select `LegacyButton` on the **governance** page to open its page, and see [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used).
2. Scan each of those repos and upload the scan. Every repo counts with its latest scan, however old, so a repo not scanned since it last used `LegacyButton` keeps the record from reading **None left**. [Run in CI](/docs/guides/run-in-ci) keeps scans coming.

On the **governance** page, once every record in a package reads **None left**, the package moves behind **Show N complete** at the end of the table; press it to show them. On the **charts** page, complete records move behind **Show N complete** too. If a later scan uses `LegacyButton` again, the record counts it again. Keep the record once it is complete: it still marks any new use as deprecated.

## Not in any scan

A record reads **Not in any scan**, and has no chart, when none of the scans in the dashboard contain the package or component it names. The pickers only offer what scans contain, so this happens when the scans that used it have since been removed from the dashboard. Upload a scan of a repo that still uses it and the count comes back, with no edit needed. If no repo uses it any more, it keeps reading **Not in any scan**, and the record still marks any new use as deprecated.

## Edit or delete a record

To reach a record from a component or package page, select its **Superseded by** or **Retired** line. From a record's chart, select **Manage records**. The **governance** page opens with the record's row marked.

To change a record, press **Edit** (the pencil) on its row. The form opens in place of the row and says who added the record and who last changed it, such as `Added by Ana on 2 Oct · changed by Sam on 3 Oct`. Change it and press **Save**.

To delete a record, press **Edit** on its row, then **Delete** in the form. The form asks before it deletes: press **Delete** again to confirm.

:::warning
Deleting a record removes its deprecated mark straight away, so a new use of `LegacyButton` shows as an ordinary component. Its chart and its rows on the **charts** page and on each repo's **Adoption** tab go too, once the dashboard has recalculated.
:::

## Next step

To compare whole libraries rather than one component, such as `@acme/ui` against `@acme/ui-legacy`, [tag your libraries](/docs/guides/dashboard/tag-your-libraries) and chart them. See [Charts](/docs/guides/dashboard/charts).
