---
"@scoutui/web-app": minor
---

Migration and retirement rows now say whether the work moved:

- Each row shows how many uses of the old component are left, such as **24 left**, and how that number changed, such as **6 fewer** in green or **2 more** in red. Deleting uses of the replacement no longer reads as a step back.
- On the **charts** page the change covers the last 30 days, comparing each repo with itself, so a repo scanned for the first time is not counted as a change. The row says when one joined, as in **3 fewer · 1 repo added**. A repo's **Adoption** tab shows the change since its previous scan.
- Records that name the same replacement, such as one for each part of a compound component, are one migration with one row and one chart. Links to either record's chart open it.
- A migration or retirement's chart page shows the row's numbers above the chart.

Charts over time also start each line at the first scan of a repo that uses it instead of rising from 0, and a small ring marks where another repo joins a line, with the repo named in the tooltip. For a few minutes after upgrading, while the dashboard works out the stored figures again, these pages read **Preparing scan data**.
