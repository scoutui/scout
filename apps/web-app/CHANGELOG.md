# @scoutui/web-app

## 0.5.0

### Minor Changes

- [#151](https://github.com/scoutui/scout/pull/151) [`2441a01`](https://github.com/scoutui/scout/commit/2441a018903c59706e00e8ba595a456990fc6301) Thanks [@siggerzz](https://github.com/siggerzz)! - Lines past the seventh in a trend or stacked chart now take all five line colours in turn, instead of only two. The first seven keep theirs.

  Hovering a line, or hovering or focusing its row or its name, lights that line and dims the rest. With up to four lines, each line's full name sits at its end. Press a line's name, or anywhere in its row in the table, to see it on its own, and press it again to see every line. The time axis labels the chart's first day.

  The CSV, the copied table and the image take only the lines drawn: the ones your search finds, or the one line shown on its own. A chart's image names its ten largest lines, or a stacked chart's legend its ten largest bands, and no longer says how many more there are.

  On a phone, the table under a trend chart shows each line's change under its uses, so component and package names fit without breaking mid-word, and the names under a chart are easier to tap. In a narrow chart, such as the builder's preview, the table puts each package under its component's name.

## 0.4.0

### Minor Changes

- [#129](https://github.com/scoutui/scout/pull/129) [`5080e42`](https://github.com/scoutui/scout/commit/5080e425d6aff95dc16d3701f6efff2ece6361f0) Thanks [@siggerzz](https://github.com/siggerzz)! - The chart builder's **Add a series** box now offers components and packages your repos no longer use, after the ones in use, most recently used first. You can chart a component your teams have moved off and watch its uses fall to zero. With one repo picked, the box offers what that repo uses or has used. A package's count now includes the components it no longer uses, so it matches the list you see when you pick the package.

- [#125](https://github.com/scoutui/scout/pull/125) [`08b3773`](https://github.com/scoutui/scout/commit/08b37734c0de46d88d891e8e59234fffe6011468) Thanks [@siggerzz](https://github.com/siggerzz)! - In the chart builder, one **Add a series** box replaces the Tags, Packages and Components tabs. It searches the way Governance's boxes do: the best match comes first, tags and packages before components, and picking a package narrows the search to it, with a row that adds the whole package. The list stays open while you add series. In both places, a long package name shortens its scope rather than losing its end.

- [#135](https://github.com/scoutui/scout/pull/135) [`9707870`](https://github.com/scoutui/scout/commit/97078709808b7187cfc04c1e5b288733bb59ba21) Thanks [@siggerzz](https://github.com/siggerzz)! - A chart's tooltip lists every line, scrolling past 11, with the line under the pointer in bold, instead of stopping at 10 with "N more series". Click or tap a chart, or press Enter on it, to pin its tooltip so the list can be scrolled; Escape or a click elsewhere unpins it. The pointer turns into a hand where a click pins, and clicking or tapping a chart no longer leaves a ring around it or its dots. A stacked chart's tooltip names the repos that join, bars are solid on screen, a bar chart's image grows to fit its bars, and the previews on the Charts page follow dates and each chart's saved range. The versions bar on a package or component page reads the latest version and "other" instead of "+N more".

- [#132](https://github.com/scoutui/scout/pull/132) [`eaacfc8`](https://github.com/scoutui/scout/commit/eaacfc8adefadd1d98ef9bf1d4ded97f335a039c) Thanks [@siggerzz](https://github.com/siggerzz)! - The Charts page lists migrations and retirements together, grouped by the package each one moves away from. Each package shows its uses left, how they changed over the last 30 days and its trend, and opens onto every migration and retirement in it. **In progress** and **Complete** switch between unfinished and finished work, and with more than 10 a search finds a component or package. A migration or retirement of several components now names every one of them instead of four and "+N more". While you scroll, the column headings and an open package stay in view, and so do the headings of the table of lines under a saved trend chart. The dashboard recalculates its migration and retirement results after the upgrade.

- [#127](https://github.com/scoutui/scout/pull/127) [`c9d98b3`](https://github.com/scoutui/scout/commit/c9d98b30662e94f1ef95d066986264fba69f8e29) Thanks [@siggerzz](https://github.com/siggerzz)! - A migration's **% migrated** and its chart count the replacement only in repos that have used the component or package it replaces, so repos that never needed to migrate no longer raise them. A repo that finished migrating before its first scan isn't counted until scans of older commits that still use the old one are uploaded. A migration whose old component no repo has used shows no percentage and says there's nothing to migrate. The dashboard recalculates its migration charts after the upgrade.

- [#137](https://github.com/scoutui/scout/pull/137) [`2fb32e5`](https://github.com/scoutui/scout/commit/2fb32e50af522fd95954035db9ac682d1134554c) Thanks [@siggerzz](https://github.com/siggerzz)! - The chart of a migration of several components draws each old component as its own line beside the replacement's, so you can see which one still has the most uses. A table under the chart lists each line's uses and how much they changed over the period you picked: green when an old component's uses went down or the replacement's went up, red the other way. Its row on the Charts page still shows the migration as a whole. The dashboard recalculates its migration and retirement results after the upgrade.

- [#141](https://github.com/scoutui/scout/pull/141) [`ddf5d79`](https://github.com/scoutui/scout/commit/ddf5d797ed682c1aa5162b40fc22ea12dbe29667) Thanks [@siggerzz](https://github.com/siggerzz)! - A repo's **Adoption** tab now lists its migrations and retirements the way the **Charts** page does: grouped by the package they move away from, split into **In progress** and **Complete**, with a search once there are more than 10. Each row opens its chart for that repo alone, and the chart page names the repo where it shows the chart's scope.

- [#128](https://github.com/scoutui/scout/pull/128) [`7eff26e`](https://github.com/scoutui/scout/commit/7eff26eb7ee7c8163a5cf6727f6a8adf62a92f2f) Thanks [@siggerzz](https://github.com/siggerzz)! - On a saved chart's page, a Trend chart with two or more lines lists them in a table under the chart, with each line's latest uses or share and its change over the period picked above the chart, under a heading such as "Change since 2 Jul". With more than 10 lines, the table lists the first 10, with Show all and a search by component or package name; while you search, the chart and its export show only the matching lines. When two components on the chart have the same name, each row shows the folder or file that tells them apart.

### Patch Changes

- [#133](https://github.com/scoutui/scout/pull/133) [`47147e1`](https://github.com/scoutui/scout/commit/47147e1c1fdfd111b0806ebd4b50daf94c0c78b8) Thanks [@siggerzz](https://github.com/siggerzz)! - A Trend chart's image (**Download PNG** and **Copy image**) now names every line in full. When a package is too long to fit beside its component's name, every package goes on the line beneath its name, so the names read as one list. Two named lines with the same name show the folder that tells them apart. A name is joined to its line only when it had to move clear of another name, and then in that line's colour. The time axis labels the chart's first and last day, on a Stacked chart's image too, and the dot at a line's end no longer cuts a gap in the lines around it.

- [#140](https://github.com/scoutui/scout/pull/140) [`805787f`](https://github.com/scoutui/scout/commit/805787f792059254307d90942ef018a412f2782b) Thanks [@siggerzz](https://github.com/siggerzz)! - A chart's image (**Download PNG** and **Copy image**) shows its whole title, wrapping a long one onto more lines instead of cutting it short, and the image grows taller to fit. When a chart's data covers one repo, the image names that repo instead of saying "1 repo".

- [#122](https://github.com/scoutui/scout/pull/122) [`f607183`](https://github.com/scoutui/scout/commit/f607183ff84abea755b659dffac69b1df41da966) Thanks [@siggerzz](https://github.com/siggerzz)! - Charts with many series are easier to read. Hovering a chart, the tooltip stays with the pointer and lists the ten largest values at that scan, then how many series it leaves out. A chart's exported image keeps its plot readable however many series it has: a trend names its ten largest lines at their ends with their latest values, a stacked chart's legend lists its eight largest series, and both say how many more there are. When every series comes from one package, the image names that package once under the title.

- [#121](https://github.com/scoutui/scout/pull/121) [`05776ae`](https://github.com/scoutui/scout/commit/05776ae97cf7dd92544357497c9b1199b568aee6) Thanks [@siggerzz](https://github.com/siggerzz)! - On a component's Usage tab, a component whose uses all sit in one package of a monorepo now names that package above its folders, as in **Used in** `@acme/web`. In the **Used in** list, a package name too long for the column keeps the part that tells it apart: its scope reads `@…`, as in `@…/purchase-status`, so two long names that share a scope no longer look the same. On the Composition tab, the component's own box shows its name in full, with no package or path after it.

- [#130](https://github.com/scoutui/scout/pull/130) [`8493eb5`](https://github.com/scoutui/scout/commit/8493eb5a5d31367fe3ead1b93bc0765fdb23d274) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard fits a phone better: a component's **Used in** list, a repo's **Scan history** and a package's repos no longer scroll sideways, column headers and the scan switcher are easier to tap, tabs, toggles and filter chips respond when pressed, the sign-in pages fit the screen, and a count of one reads "1 use".

- [#142](https://github.com/scoutui/scout/pull/142) [`bc4b85a`](https://github.com/scoutui/scout/commit/bc4b85a537f64e986e9cd965da26f5a5a494fa26) Thanks [@siggerzz](https://github.com/siggerzz)! - **Deprecated components in use** now counts only deprecated components with at least one use. A deprecated component a scan lists but nothing uses, such as one the repo defines and never renders, keeps its warning icon but is no longer counted. This applies to the repo page's header and its change since the previous scan, the **Deprecated** column on the repos and packages lists, a package page's header, and every **deprecated** chip. The chip now shows only the components it counts.

- [#123](https://github.com/scoutui/scout/pull/123) [`98aee60`](https://github.com/scoutui/scout/commit/98aee60797ee01cdffe99bf2f9eb716f810f725e) Thanks [@siggerzz](https://github.com/siggerzz)! - The Governance page now opens with each package's records folded, one line per package. Open a package to see its records. A search still shows every record that matches, a record you add or follow a link to opens its package, and packages under **Show N complete** open with that section.

- [#141](https://github.com/scoutui/scout/pull/141) [`ddf5d79`](https://github.com/scoutui/scout/commit/ddf5d797ed682c1aa5162b40fc22ea12dbe29667) Thanks [@siggerzz](https://github.com/siggerzz)! - The keyboard focus ring now shows on the **Charts** page's saved charts and on the Scout link in the header.

- [#143](https://github.com/scoutui/scout/pull/143) [`cb6a8d4`](https://github.com/scoutui/scout/commit/cb6a8d45370fa502ee8b337fa5b570d03a5694c9) Thanks [@siggerzz](https://github.com/siggerzz)! - The chart of a migration of more than two components says how many in its heading, such as "Migration: 8 components · @acme/ui-legacy → @acme/ui", instead of naming every one. The table under the chart still names each component. The chart's image and the page's breadcrumb use the same shorter title, and the breadcrumb of a migration of two components from different packages now names both. On a phone, a package name in the heading moves to the next line whole instead of breaking after its scope. The dashboard recalculates its migration and retirement results after the upgrade.

- [#139](https://github.com/scoutui/scout/pull/139) [`f3d75d3`](https://github.com/scoutui/scout/commit/f3d75d344ffed7eb63dace17c03f3c49a35a5da4) Thanks [@siggerzz](https://github.com/siggerzz)! - On a phone, the header shows a Menu button, the Scout logo and your account. Menu opens a list of the pages you can see, with the one you're on marked. The theme moves from its own button into the account menu, on every screen size. The account menu shows your full name and email, with your role under them. A component's page now marks packages as the current page.

- [#134](https://github.com/scoutui/scout/pull/134) [`1a2de59`](https://github.com/scoutui/scout/commit/1a2de598911c4903118603dd8b907a1766f1c7f1) Thanks [@siggerzz](https://github.com/siggerzz)! - On a phone, the header now shows one button named after the page you're on, such as **packages**, which opens a menu of every page, so no page is cut off at the edge of the screen. Screen readers name the logo Scout, the keyboard focus ring on a tab is no longer cut off, and menus, popovers and dialogs only fade in when your device asks for reduced motion.

- [#124](https://github.com/scoutui/scout/pull/124) [`6b6bd9c`](https://github.com/scoutui/scout/commit/6b6bd9c86b72fc56c08ba341fd092d289c9c09cb) Thanks [@siggerzz](https://github.com/siggerzz)! - On a component's Usage tab, a component that declares no props and whose uses set none no longer shows an empty **Prop values** heading, and on a narrow window the button that shows the filters reads **Where it’s used**. On the Composition tab, boxes show component names in full up to 48 characters, where names longer than about 25 were cut short.

- [#126](https://github.com/scoutui/scout/pull/126) [`7d48cf7`](https://github.com/scoutui/scout/commit/7d48cf7246bcef0c31b64531e213ab3b8188468e) Thanks [@siggerzz](https://github.com/siggerzz)! - On a repo's page, **This scan couldn't see everything** now adds up the problems you can fix, such as **16 things to fix** above rows of 15 and 1, instead of counting how many kinds there are. The row for components passed in as a prop or argument now says it counts uses, as in **41 uses of components passed in as a prop or argument weren't counted**.

- [#144](https://github.com/scoutui/scout/pull/144) [`a876633`](https://github.com/scoutui/scout/commit/a876633fb710483c016a8a41c3ef7adcb2800c80) Thanks [@siggerzz](https://github.com/siggerzz)! - A chart's tooltip no longer draws its scrollbar over the values when its list scrolls, on a Mac or a phone where scrollbars show only while scrolling. A tooltip whose rows all fit no longer scrolls by a few pixels or dims its last row.

## 0.3.0

### Minor Changes

- [#80](https://github.com/scoutui/scout/pull/80) [`6d68031`](https://github.com/scoutui/scout/commit/6d68031582347f122dfd805e1e3b2ffab1efce18) Thanks [@siggerzz](https://github.com/siggerzz)! - Charts over time offer a date range (3 months, 6 months, 1 year or All) once their scans span more than 3 months. The range you pick stays in the chart's link, and a saved chart opens at the range picked in the builder when it was saved. Clicking a name in a Trend chart's legend shows only that line. A Trend chart with six or more lines now shows them all on one chart, with a sortable table of each line's latest value in place of the separate small charts.

- [#102](https://github.com/scoutui/scout/pull/102) [`d4b78e4`](https://github.com/scoutui/scout/commit/d4b78e4d8564ba87bbe0563d0f3bbf44e600aa5d) Thanks [@siggerzz](https://github.com/siggerzz)! - A saved chart's **⋯** menu has a new **Export** submenu: **Download PNG** and **Copy image** for a slide or a document, and **Download CSV** and **Copy table** for a spreadsheet. The image is always light, and shows the chart's name, the repos and period it covers, and each series with its latest value. Exports cover the period picked above the chart. Migration and retirement charts list the same items in their **⋯** menu, and everyone who can open a chart can export it.

- [#78](https://github.com/scoutui/scout/pull/78) [`6e621b8`](https://github.com/scoutui/scout/commit/6e621b81d25390a1cf6d57c761616bb1fe31bb9c) Thanks [@siggerzz](https://github.com/siggerzz)! - Charts now belong to the person who made them. Only they or an Admin can change or delete a chart, and its page shows who created it.

  A new chart is private: only its creator and Admins can open it, and it's listed under **Private** on the charts page. **Share with everyone** in the chart's **⋯** menu lists it under **Shared charts** for everyone; **Make private** takes it back. The same menu has **Duplicate**, which opens a copy in the chart builder to save as your own. Admins see everyone else's private charts under **Other people's charts**.

  Charts saved before this release are shared with everyone, so the charts page lists the same charts as before.

- [#110](https://github.com/scoutui/scout/pull/110) [`779a800`](https://github.com/scoutui/scout/commit/779a800b7015502c04c7a6452eec68b203a5a8a8) Thanks [@siggerzz](https://github.com/siggerzz)! - The chart builder has a **Visibility** choice, **Private** or **Shared**, so you can share a chart as you create it. A new chart and a copy start as **Private**; editing a chart shows who can see it now and lets its creator or an Admin change it. A saved chart's page now always says **Private** or **Shared** under its name.

- [#73](https://github.com/scoutui/scout/pull/73) [`034fe05`](https://github.com/scoutui/scout/commit/034fe054e18af326428cde72a67698b1946f6045) Thanks [@siggerzz](https://github.com/siggerzz)! - Migration and retirement rows now say whether the work moved:

  - Each row shows how many uses of the old component are left, such as **24 left**, and how that number changed, such as **6 fewer** in green or **2 more** in red. Deleting uses of the replacement no longer reads as a step back.
  - On the **charts** page the change covers the last 30 days, comparing each repo with itself, so a repo scanned for the first time is not counted as a change. The row says when one joined, as in **3 fewer · 1 repo added**. A repo's **Adoption** tab shows the change since its previous scan.
  - Records that name the same replacement, such as one for each part of a compound component, are one migration with one row and one chart. Links to either record's chart open it.
  - A migration or retirement's chart page shows the row's numbers above the chart.

  Charts over time also start each line at the first scan of a repo that uses it instead of rising from 0, and a small ring marks where another repo joins a line, with the repo named in the tooltip. For a few minutes after upgrading, while the dashboard works out the stored figures again, these pages read **Preparing scan data**.

- [#63](https://github.com/scoutui/scout/pull/63) [`c12db47`](https://github.com/scoutui/scout/commit/c12db478a75de725779f4ab945ad55a9960e3ab8) Thanks [@siggerzz](https://github.com/siggerzz)! - A component's **Composition** tab is now one diagram you can explore, in place of the two lists and the render tree:

  - One line above it says how many components render the component, directly and in total, and how many it renders.
  - What renders the component is on its left, and what it renders is on its right, with a column for each number of steps away.
  - **+N more** opens a list inside the diagram that you can filter.
  - A search box above the diagram finds any component that renders it or that it renders, however far away, and picking one selects it.
  - Clicking a box selects it and shows the components one step further out. A bar above the diagram writes its route out as a sentence, such as "ProductGrid renders ProductCard 5 times.", with a link to open that component. Links that open the tab with a route drawn still work.
  - On a phone the tab opens on the list of components, with the diagram as a second view.
  - The zoom buttons are gone. Scroll or pinch to zoom.

- [#62](https://github.com/scoutui/scout/pull/62) [`1078322`](https://github.com/scoutui/scout/commit/1078322615b83dbb6858fa061462bb7cf33c12c1) Thanks [@siggerzz](https://github.com/siggerzz)! - Adds roles. Viewers can look around; Editors can also upload scans and change charts, governance and tags; Admins can also set people's roles on Settings → People, where they can remove someone too. Everyone who has already signed in becomes an Editor; people who sign in for the first time are Viewers.

  Before upgrading, set `SCOUTUI_ADMINS` (chart `auth.admins`) to your admins' email addresses, or `SCOUTUI_ADMIN_GROUP` (chart `auth.adminGroup`) to a group in your sign-in provider. The dashboard won't start without one of them. An email counts only when your sign-in provider marks it verified. Named admins become Admins at their next browser sign-in, so after upgrading, have them sign out and sign in again: until one of them does, nobody is an Admin.

- [#97](https://github.com/scoutui/scout/pull/97) [`9fca488`](https://github.com/scoutui/scout/commit/9fca4882850c852bf421f52716f46d33d3ca2d90) Thanks [@siggerzz](https://github.com/siggerzz)! - A migration counts only the replacement its record names. Before, when no repo used a replacement component yet, the migration counted every component of the replacement's package instead and read as partly migrated; now it reads **0% migrated** and names the component, such as `Table · tdesign-vue-next`, until a repo uses it.

- [#68](https://github.com/scoutui/scout/pull/68) [`b9a9e40`](https://github.com/scoutui/scout/commit/b9a9e40f8da57739ac255511b080497545c86ef9) Thanks [@siggerzz](https://github.com/siggerzz)! - Removes `SCOUTUI_REQUIRED_GROUP` (chart `auth.requiredGroup`), the group people had to be in to sign in. To limit who can sign in, assign people to the dashboard's application in your sign-in provider, or set `OIDC_ALLOWED_DOMAINS` (chart `auth.oidc.allowedDomains`). People who sign in for the first time are Viewers until an Admin gives them another role on Settings → People.

- [#75](https://github.com/scoutui/scout/pull/75) [`283d7b6`](https://github.com/scoutui/scout/commit/283d7b6b2aeb00da78d200773bc3205ad6c6ab96) Thanks [@siggerzz](https://github.com/siggerzz)! - Admins can now remove a scan, such as a test run or a scan of the wrong branch, from a repo's **Scan history**, and delete a repo from its page. Charts leave out what was removed, and **History** on the **Settings** page records who removed or deleted what. A deleted repo comes back the next time a scan of it is uploaded.

- [#66](https://github.com/scoutui/scout/pull/66) [`2db8119`](https://github.com/scoutui/scout/commit/2db81199abee67562eff5010ccc454ff84ae602a) Thanks [@siggerzz](https://github.com/siggerzz)! - In a monorepo, the dashboard now shows which package each use sits in:

  - The Components table's **Used in** filter shows only the components used in one package, with that package's uses and files. Its link keeps the package in `used-in=`; after a package is renamed, a saved link matches nothing until you pick the new name. Opening a component while a package is picked keeps it picked on the component's Usage tab.
  - A component's Usage tab lists its uses by package when they sit in more than one.

  Scans uploaded by older CLI versions show none of these. A component's page now also names its package after **From**, as in **From** `@acme/ui`. For a few minutes after upgrading, while the dashboard prepares every stored scan again, pages read **Preparing scan data**.

- [#74](https://github.com/scoutui/scout/pull/74) [`8900f2b`](https://github.com/scoutui/scout/commit/8900f2b8f3027b563a84cc66477e55a4850f9685) Thanks [@siggerzz](https://github.com/siggerzz)! - Tags take one of five colours: teal, violet, blue, berry and orchid. Every pair stays easy to tell apart, including for colour-blind readers, in light and dark mode.

  - Teal, violet and blue tags keep their colour, though violet and blue are now deeper.
  - Grey tags, and tags with a colour from outside the set, change to a colour no other tag uses, or to the one fewest tags use.
  - Chart lines without a tag's colour, such as packages and components, take the same five, so a chart repeats a colour only from its sixth line.
  - In dark mode, Local's ring on the **Composition** tab and the dots for older versions are easier to see.

- [#59](https://github.com/scoutui/scout/pull/59) [`4b825f6`](https://github.com/scoutui/scout/commit/4b825f6141b60e4da57ff3c6502cdf3803db9fe8) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard now uses one word for each thing, the same on every page:

  - **Uses.** Each place a component is used is a **use**. The **Occurrences** columns are now **Uses**, the Usage tab counts uses instead of calls, the Composition tab's tooltips count uses instead of call sites, the governance table shows **Uses left**, and the charts' **Count** toggle is now **Uses**.
  - **Type.** On a repo page, the **Framework** filter is now **Type**, and its pill reads `type`. Its **Tag** value is now **Undefined element**: a web component that nothing in the scan defines. **Tag** now means only your library tags.
  - **Replaced.** On Governance, the record type **Superseded** is now **Replaced**, rows read **Replaced by**, and the warning reads **Replacement deprecated**. Migrations and retirements read **in progress** instead of **active**, and a retirement counts the uses **left** instead of **remaining**.
  - **External and Local.** The **Origin** filter says what each value means: **From outside this repo** or **Defined in this repo**. A component's **External** or **Local** badge says the same on hover, and badges are capitalised.
  - **Smaller changes.** Commit dates are under **Committed** instead of **Updated**, a package's components count **Repos** instead of **Consumers**, the repo page's changed view counts **changes** instead of **moved**, and the change since the previous scan reads `±0 since previous scan` or `up from 34.8% previously`.

  Four keys in links and queries change with it, and the old ones no longer work:

  - The repo page's uses filter: `?occurrences=gte:10` is now `?uses=gte:10`. A saved link with `occurrences=` opens the page without that filter.
  - The repo page's type filter: `?kind=tag` is now `?kind=undefined-element`. A saved link with `kind=tag` opens the page without that filter.
  - The Usage tab's sort: `sort=calls~asc` is now `sort=uses~asc`. A saved link with `calls~` opens the tab in its default order.
  - The `q` query on `/api/repos/<repo>/components`: `occurrences:>10` is now `uses:>10`, and `kind:tag` is now `kind:undefined-element`. A query with the old ones matches no components.

- [#108](https://github.com/scoutui/scout/pull/108) [`1a9254e`](https://github.com/scoutui/scout/commit/1a9254ee87a435e2a57b2d5fb74f30ea5f747e8f) Thanks [@siggerzz](https://github.com/siggerzz)! - A repo's page now says when its scan couldn't see everything, such as uses of components that aren't imported or web components that no package defines, and what to change for each. For a few minutes after upgrading, while the dashboard prepares every stored scan again, pages read **Preparing scan data**.

- [#50](https://github.com/scoutui/scout/pull/50) [`cbe9174`](https://github.com/scoutui/scout/commit/cbe91740c55b7e46394f00dfd6be804051312986) Thanks [@siggerzz](https://github.com/siggerzz)! - Lifecycle records now cover packages written in the same monorepo as the apps that use them. The record pickers list these packages after the installed ones, and their components once you search in one. Typing a component name lists the packages that have it after the results. A record on such a package marks its components deprecated in that monorepo too, back to the first scan, with no rescan. After upgrading, the governance page reads Preparing scan data until the dashboard has recalculated, and monorepo components show as deprecated once each repo's scans have been rebuilt.

### Patch Changes

- [#68](https://github.com/scoutui/scout/pull/68) [`b9a9e40`](https://github.com/scoutui/scout/commit/b9a9e40f8da57739ac255511b080497545c86ef9) Thanks [@siggerzz](https://github.com/siggerzz)! - The allowed email domains rule (`OIDC_ALLOWED_DOMAINS`, chart `auth.oidc.allowedDomains`) now counts your sign-in provider's verified mark only when the provider's email is the one the dashboard has on record for that person, ignoring letter case. Admin emails already worked this way.

- [#109](https://github.com/scoutui/scout/pull/109) [`759cd6c`](https://github.com/scoutui/scout/commit/759cd6caf32a63d903f5fbdefd1fcbceb710df08) Thanks [@siggerzz](https://github.com/siggerzz)! - A repo's **Adoption** tab and a table chart of one repo now show the change over the last 30 days, as the **charts** page does, instead of the change since the previous scan.

- [#70](https://github.com/scoutui/scout/pull/70) [`536d36a`](https://github.com/scoutui/scout/commit/536d36a77c77beeaa103a5f2c89012c03b247eb6) Thanks [@siggerzz](https://github.com/siggerzz)! - Text fields, menus and checkboxes have a clearer border, the top bar is solid, the labels on red buttons are easier to read, warnings stay readable on a selected Governance record, and the chart builder's example chart follows dark mode.

- [#72](https://github.com/scoutui/scout/pull/72) [`ca846d4`](https://github.com/scoutui/scout/commit/ca846d429716419b29135db3f78874beef772ed5) Thanks [@siggerzz](https://github.com/siggerzz)! - On the **Composition** tab:

  - The selected box now shows a focus ring when it has keyboard focus.
  - **Find**'s results close when you tab away.
  - In **Find**, the result the arrow keys are on is outlined and scrolls into view.
  - Clearing a route keeps keyboard focus on the diagram instead of losing it.
  - Long names show in full when you hover them.
  - File paths in lists and **Find** are easier to read.
  - On a phone, tapping a search box no longer zooms the page.
  - A filter with no results says what you searched for.
  - Box and button animations stop when your system asks for reduced motion.

  On **Governance**, the record picker outlines the result the arrow keys are on.

- [#67](https://github.com/scoutui/scout/pull/67) [`2545036`](https://github.com/scoutui/scout/commit/2545036f08b74f5fae8650dc2ebcf8bf544a31c6) Thanks [@siggerzz](https://github.com/siggerzz)! - On the **Composition** tab, a list opened from **+N more** is no longer greyed out while a route is selected, and lists open in neighbouring columns no longer overlap: the next column moves out to make room. Boxes off a selected route now show their names in grey instead of fading, so they stay readable. A list opened while a route is selected is shown in full, and tabbing through a list keeps it in view.

- [#49](https://github.com/scoutui/scout/pull/49) [`24fb33c`](https://github.com/scoutui/scout/commit/24fb33c3ad2c381cd2146dca3619eb6aa23ad186) Thanks [@siggerzz](https://github.com/siggerzz)! - A long "defined at" path now wraps, so a component's page fits a phone screen.

- [#69](https://github.com/scoutui/scout/pull/69) [`cb445f3`](https://github.com/scoutui/scout/commit/cb445f3f0bf1ae4b4b9b9030754cd4f02ef046b9) Thanks [@siggerzz](https://github.com/siggerzz)! - Clearer wording across the dashboard:

  - The commands shown on an empty Repos or Packages page start with `scout init`.
  - Error pages say what couldn't load, such as "Couldn't load charts.", and to try again or reload the page.
  - The Repos table's **Δ components** column is now **Changes**.
  - Lines that explained how numbers are counted are gone from Governance, trend charts, the chart builder and the older-scan banner.
  - Pages that need another role say to ask an Admin, including Settings and role changes. Settings says what each role can see.
  - Clearer empty states on package pages and charts, and no hover text on the Charts list's small previews.

- [#96](https://github.com/scoutui/scout/pull/96) [`7024e52`](https://github.com/scoutui/scout/commit/7024e52f4a89727c3a66cccb218de93c80f81308) Thanks [@siggerzz](https://github.com/siggerzz)! - A web component your repo registers in two places now counts as Local, as one registered once does, instead of External. After the upgrade, the dashboard rebuilds its stored scans in the background to apply it to earlier scans.

- [#100](https://github.com/scoutui/scout/pull/100) [`394ab44`](https://github.com/scoutui/scout/commit/394ab4457ebc4239f04d1d17007c145c178f4a4c) Thanks [@siggerzz](https://github.com/siggerzz)! - A scan whose repository address has an unusually long run of slashes no longer slows the dashboard.

- [#64](https://github.com/scoutui/scout/pull/64) [`a05f7c2`](https://github.com/scoutui/scout/commit/a05f7c26d06062ef1fb6feed6fd9afe570273b3b) Thanks [@siggerzz](https://github.com/siggerzz)! - A component with no package shows a dash under its name, as the components table does, in place of `<no package>`. A search box over a single repo, package or component says so in the singular, such as `Search 1 repo…` or `Search 1 component by name…`.

- [#81](https://github.com/scoutui/scout/pull/81) [`7c2086e`](https://github.com/scoutui/scout/commit/7c2086ebfdaf4a2d84197ac47fec191e0284c260) Thanks [@siggerzz](https://github.com/siggerzz)! - Keyboard focus looks the same on every control: a solid 2px line around it, in the text colour. It shows only when you move with the keyboard; a text field also shows it, on its own edge, when you click into it. A row in the Packages tables is now one Tab stop instead of one per column, and a chart shows focus when you tab to it.

- [#86](https://github.com/scoutui/scout/pull/86) [`44ffa7f`](https://github.com/scoutui/scout/commit/44ffa7f70b437f8399365a154791e2f18df54025) Thanks [@siggerzz](https://github.com/siggerzz)! - The **Deprecated** column on the Packages page and the **deprecated components in use** line on a package page count each deprecated component once, as the package's **deprecated** chip does. Before, a component used in three repos counted three times. Components that share a name, such as `Button` from `@acme/ui` and from `@acme/ui/button`, show their entry point under the name on a package page's **Components** table and beside the package in the chart picker, as a repo's **Components** tab already does.

- [#105](https://github.com/scoutui/scout/pull/105) [`3e23173`](https://github.com/scoutui/scout/commit/3e23173e9103d69c0aabe75ec49e030f1b159a2b) Thanks [@siggerzz](https://github.com/siggerzz)! - A chart's **Share** metric is now called **% of uses**, so the switch reads **Uses | % of uses** and no longer looks like a button that shares the chart. Its table column and the exported CSV and copied table use the same name.

- [#89](https://github.com/scoutui/scout/pull/89) [`a89e192`](https://github.com/scoutui/scout/commit/a89e192789f2c1a77173c56e412be30878211b99) Thanks [@siggerzz](https://github.com/siggerzz)! - A release now counts as newer than its prereleases. Before, `5.0.0-beta.1` took the colour in a version bar as the highest version and `5.0.0` showed as older; the **Version** column on a repo's **Components** tab sorts the same way.

- [#52](https://github.com/scoutui/scout/pull/52) [`b4d0984`](https://github.com/scoutui/scout/commit/b4d09845c957927843aec4e9c7024c9caf9ce88b) Thanks [@siggerzz](https://github.com/siggerzz)! - In the lifecycle record form, **Package or component** and **Superseded by** now show a package only while you search in it or once you've picked it. After you create a record, both start blank for the next one. Selecting a package to search in it and then clicking away also leaves the field blank, instead of keeping the package as a chip that looked like a pick. Before, Create could refuse with "Choose what supersedes it." while a package still showed in the field.

- [#57](https://github.com/scoutui/scout/pull/57) [`b31629d`](https://github.com/scoutui/scout/commit/b31629d5fd3e65a6a2d8ded8cb9c7dc1fb34b475) Thanks [@siggerzz](https://github.com/siggerzz)! - The dashboard now tells the CLI which scan formats it reads when the CLI checks a scan before uploading it, so the CLI can tell people not to update to a version whose scans the dashboard can't read yet.

- [#82](https://github.com/scoutui/scout/pull/82) [`82423f4`](https://github.com/scoutui/scout/commit/82423f48fb35182f4dcd6103783bfbd0fee6c87a) Thanks [@siggerzz](https://github.com/siggerzz)! - When the database refuses the connection, the web server and the worker log why they couldn't start, such as `[worker] couldn't start: connect ECONNREFUSED 127.0.0.1:5432`. Before, a database at `localhost` left the reason empty.

- [#106](https://github.com/scoutui/scout/pull/106) [`5143e39`](https://github.com/scoutui/scout/commit/5143e39630414731b840d15f666f17ca04ca4b8e) Thanks [@siggerzz](https://github.com/siggerzz)! - A table chart's **Change** column no longer reads 0 just because another repo was scanned last. For a chart of all repos it now shows the change over the last 30 days, each repo compared with itself, as the migration and retirement rows do; for a chart of one repo it is still the change since that repo's previous scan. A repo's first scan no longer reads **repo added**, and a series with nothing to compare yet reads **—**.

- [#71](https://github.com/scoutui/scout/pull/71) [`8789cfb`](https://github.com/scoutui/scout/commit/8789cfbdd9569167748829311d6b639e402527a6) Thanks [@siggerzz](https://github.com/siggerzz)! - On a phone, tapping into a search box, the **Repos** menu in the chart builder or a role menu on **People** no longer zooms the page. Small text is easier to read: hints, counts and details that were 11px are now 12px, and chart axis labels are 11px. On a phone, a chart's title is smaller and breaks a scoped package name after its scope, and the names in a migration or retirement row wrap instead of being cut off. The separators in a repo's details line no longer start or end a line when it wraps.

- [#99](https://github.com/scoutui/scout/pull/99) [`e41168c`](https://github.com/scoutui/scout/commit/e41168c0094c073f3b3cb1098fa029b7bc694f3a) Thanks [@siggerzz](https://github.com/siggerzz)! - After you save or delete a lifecycle record, tag or chart, or a new scan arrives, the **governance** page, the **charts** page, a migration's chart and a repo's **Adoption** tab show **Preparing scan data** above their numbers until the new ones are worked out, then update by themselves. Before, they kept the old numbers with no sign they were out of date until you reloaded. A deleted record's chart now says the page isn't found.

- [#90](https://github.com/scoutui/scout/pull/90) [`6667e6c`](https://github.com/scoutui/scout/commit/6667e6c6ee47cacf43904092a20204fee1c0960d) Thanks [@siggerzz](https://github.com/siggerzz)! - The Usage tab lists a prop under **Events** only when the scan counted it as an event. A prop such as `onLabel="On"` from a newer CLI now shows its values with the other props, and can be a value column.

- [#85](https://github.com/scoutui/scout/pull/85) [`9fb9982`](https://github.com/scoutui/scout/commit/9fb9982b2ab8edfac38e74e18984174d29baab70) Thanks [@siggerzz](https://github.com/siggerzz)! - A web component that more than one package or file defines now names each of them on its page, such as `From @acme/ui or @other/ui`, instead of showing a dash.

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
