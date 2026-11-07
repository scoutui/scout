---
"@scoutui/web-app": minor
---

New: the components table on a repo page shows **Unused props** for a component whose declared props the scan could read — how many of them it never saw passed, for example `2 of 5`. Blank for a component whose declaration isn't readable. Sort the column, or press **Filter** to find components with at least one unused declared prop; it's also in the page URL as `unused-props=true`.
