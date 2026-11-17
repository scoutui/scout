---
"@scoutui/web-app": minor
---

The chart builder lists series as checkboxes in the **Series** column, under **Tags**, **Your code** and **Packages**, instead of in a list that opened over the page. Check a row to add its series and uncheck it to remove it; pressing Enter in **Add a series** no longer adds the first match. Typing in **Add a series** lists the tags that match, and each matching component under its package, whose count reads, for example, **4 of 126**. A component defined in your code reads **Local** and its repo instead of its workspace package. A package's component count, such as **52 components**, now opens the package in place, with its five most used components under it and **Show all 52** for the rest, instead of narrowing the search to that package. To find a component in one package, type a word from each name, such as `icons arrow`. The **Series** column scrolls on its own beside the chart.

The series you've added are listed in a table under the preview instead of at the top of the **Series** column, in the order you added them, with each one's latest uses or share and its **×** and **Only deprecated components** controls. On a **Table** chart, that table is the preview. Past about ten series, the table scrolls on its own.

**Cancel** and **Save chart** now sit beside the page's title, and pressing Enter in **Name** saves the chart. **Save chart** no longer greys out: saving without a name or a series says what's missing beside it. Screen readers now hear **Chart type**, **Metric** and **Visibility** as groups of options to choose one from.
