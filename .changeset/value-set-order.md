---
"@scoutui/web-app": patch
---

On a component's **Usage** tab, a prop set to one of several values, such as `size={open ? "small" : "medium"}`, now reads the same on every row, whichever order its values were written in. After the upgrade, the dashboard rebuilds its stored scans in the background.
