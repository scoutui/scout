---
description: "Open a component to see every repo that uses it and which version each is on, then the props, values, files and lines that use it in one repo."
sidebar_label: "Find where a component is used"
---

# Find where a component is used

Every [component](/docs/reference/glossary#component) has a page that shows where it is used: across every repo, and inside one repo down to the file and line. For example, open `Button` from `@acme/ui` to see that `storefront` and `checkout` both use it and which version each is on, then which files in `storefront` still set `variant="secondary"`.

This page assumes the dashboard already has scans uploaded. If it has none, start with [Explore the dashboard](/docs/tutorials/explore-the-dashboard).

## Open a component across repos

1. Select **packages** in the top navigation.
2. Type `@acme/ui` into the search box and open the package's row.
3. In the package page's **Components** table, search for `Button` and select its name.

![The page for components.Option from react-select across repos, with the version bar, deprecated in 2 of 2 repos, the Retired line and the Used in table](/img/dashboard/component-across-repos.png)

The header gives the component's type, how many repos use it and its total [uses](/docs/reference/glossary#use). If the component is [deprecated](/docs/reference/glossary#deprecated), the header says so, for example **deprecated in 5 of 5 repos**, with a line naming its replacement or reading **Retired**.

The version bar splits the component's uses by [version](/docs/reference/glossary#version), summed across repos. The highest version is teal and every lower one is grey. "Highest" means the highest version found in these scans, not the newest one published.

The **Used in** table has one row per repo whose latest scan includes the component, heaviest users first:

- **Version**: a teal dot marks repos on the highest version, so a grey dot is a repo that is behind.
- **Deprecated**: whether a [lifecycle record](/docs/reference/glossary#lifecycle-record) covers the component.
- **Committed**: the date of the commit that repo's numbers come from.

Select a row to open the component's page for that repo.

A component [defined in the repo](/docs/reference/glossary#local) is listed under its workspace package, or under the repo's [root package](/docs/reference/artifact#root-package) when it is outside every workspace package. A scan from an older CLI version records no package for a component outside every workspace package, so it isn't listed under any package. Open it from the repo instead.

## Open a component in one repo

1. Select **repos** in the top navigation and open the repo.
2. On the **Components** tab, search for `Button` and select its row. See [Find components in a repo](/docs/guides/dashboard/repos#find-components-in-a-repo) for the filters.

Badges beside the name show its origin (**External** or **Local**), its type (**React**, **Vue**, **Web component** or **Undefined element**), and **Deprecated** when a lifecycle record covers it. The line below gives its package, or a dash when it has none, the entry point when it was imported from a subpath (`button` for `@acme/ui/button`), the installed version, and, for a component defined in the repo, the file and line where it is defined.

The page always shows the repo's latest scan, even when the repo page is showing an [older scan](/docs/guides/dashboard/repos#look-at-an-older-scan).

It has two tabs: **Usage** (the default) and **Composition**. The tab you pick, and the search, filters and sort on **Usage**, are kept in the page URL, so a copied link opens the same view.

## See how it is used

![The Usage tab for Button in payloadcms/payload, with secondary picked under buttonStyle, its pill above the file list, and one file open to its uses with Rendered by](/img/dashboard/component-usage-tab.png)

The **Usage** tab has a column of filters beside the list of files that use the component. On a narrow window the filters fold away above the list: press **Filter**, or **Where it’s used and prop values**, to show them.

### Filter by folder

**Where it’s used** lists the folders the uses are in, with how many uses each holds. When every use sits under one folder, the heading says so, as in **under** `src/`, and the list starts one level below it.

Press a folder to keep only its uses, and press it again to remove the filter. For a [deprecated](/docs/reference/glossary#deprecated) component the heading reads **Where it’s still used**.

### Filter by prop value

**Prop values** lists each prop the uses set, most set first, with how many uses set it. Press a prop to open its values, each with how many uses set it:

- `primary`: a value written in the code, as in `variant="primary"`.
- `{…}`: a variable or an expression, as in `variant={tone}` or `label={t("save")}`.
- **Not set**: the uses that don't set the prop.

Press a value to keep only its uses, and press it again to remove the filter. Pick two values of one prop, such as `primary` and `secondary`, to keep the uses that set either. Filters on two props, or on a prop and a folder, keep only the uses that match both.

A prop that no use in view sets is folded into a **Not set** group at the end of **Prop values**. **Undeclared** after a prop's name means the component's declaration doesn't list it. When the component has many props, type part of a name into **Find a prop** to narrow the list.

Three more groups below **Prop values** filter the same way. Press a group's heading to open it:

- **Styling**: `className`, `class`, `style`, `sx` and `css`.
- **Events**: handlers such as `onClick` in React, and listeners such as `click` for a Vue `@click`.
- **Attributes**: `data-` and `aria-` attributes, `key`, `ref`, test ids such as `testId`, and some HTML attributes. When the scan knows the component's props, HTML attributes such as `id`, `role` and `title` are listed here unless the component declares them. When it doesn't know them, only `id`, `role` and `tabIndex` (`tabindex` in Vue) are, and other HTML attributes such as `title` stay under **Prop values**.

### Search and remove filters

Type into **Search files and props** to keep the uses whose file path or props hold the text, such as `checkout/` or `size=large`. A component with only a few uses has no search box.

Each filter shows as a pill above the list, such as `variant = secondary`. Press a pill's × to remove it, or **Clear filters** to remove them all and keep the search. The count at the top of the list says how many uses are in view, as in `12 of 40 uses · 5 files`.

### Read the file list

The list has one row per file, the file with most uses first. Each row shows the file's name. A parent folder shows before it, faint, only when two files share a name or the name says little on its own, such as `index.tsx`.

A long list that spans several folders is grouped under a heading for each folder, the folder with most uses first. Sorting by another column, or filtering by a folder, shows one list again.

Press a file's row to open it. It lists one line per use, in line order, with the props written there, such as `:42 variant="secondary" size="sm"`. A line can also show:

- **Rendered by** and the component whose code renders it, or each one when several do. Select a name to draw its path on **Composition**.
- **Imported as** and the name the file gives the component, as in `import { Button as ShopButton } from "@acme/ui"`.
- **via** and a name, when the code doesn't render the component by its own name: the function it's passed to, as `makeControl` in `makeControl(Input)`, or a wrapper such as `memo`. The [scan file reference](/docs/reference/artifact#trace) describes each.

Select a line number such as `:42` to open that line in the repo's git host, at the commit that was scanned. A file's name opens the file at its first use. When the scan recorded no git remote, or one the dashboard can't read, both are plain text.

On a wider window, the props most uses set get a column each, showing each file's most used value, and a count such as `+2` when the file's uses differ. Press a column heading (**File**, **Uses** or a prop's name) to sort by it, and press it again to reverse the order.

### Copy the list

**Copy list** copies the uses in view as text: the component and repo, the filters, each file with its line numbers and a link to its first use, and a link back to this view. When a long list is grouped by folder, each folder's heading has its own **Copy**.

## Composition

**Composition** shows what renders this component and what it renders, anywhere in the repo, as two lists and a render tree. Press a row in a list to draw its path on the tree. [Composition and ownership](/docs/explanation/composition-and-ownership) explains how this is worked out.

A **Rendered by** link on **Usage** opens **Composition** with that component's path drawn. Your browser's Back button then returns to **Usage** with the same search, filters and sort, the same files and props open, and the list scrolled to where you left it.

## Good to know

- **`{…}` is not missing data.** It's a variable or an expression, whose value is worked out when the app runs, so the scan can't know it. Event handlers such as `onClick={save}` always read `{…}` under **Events**. On a file's lines, a variable keeps its name, as in `variant={tone}`, and a spread such as `{...props}` reads `{...rest}`.
- **One tag can count as more than one use.** A tag inside a helper function, such as a `renderRow()` that returns JSX, counts once for every component that calls the helper. It shows as one line, with each of those components after **Rendered by**.
- **The import path is part of the component.** `Button` from `@acme/ui` and `Button` from `@acme/ui/button` are two components, each with its own page. A [lifecycle record](/docs/reference/glossary#lifecycle-record) on `Button` covers both.

[Reading the numbers](/docs/explanation/dashboard/reading-the-numbers) explains what each count includes.

## Next step

Found repos still using a component you want to replace? [Track a migration](/docs/guides/dashboard/track-a-migration) follows each repo's progress to its replacement.
