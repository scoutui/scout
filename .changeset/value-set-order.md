---
"@scoutui/web-app": patch
---

On a component's **Usage** tab, a prop written as a choice between values, such as `size={open ? "small" : "medium"}`, now lists its values in the same order as the component's totals, so `small | medium` and `medium | small` read as one value and are counted together. Filtering by that value finds every use of it, whichever order its values were written in, and no longer also finds a plain string that lists the same values in another order. After the upgrade, the dashboard rebuilds its stored scans in the background to apply it to earlier scans.
