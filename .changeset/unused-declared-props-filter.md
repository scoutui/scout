---
"@scoutui/web-app": minor
---

New: on a repo page's components table, pick **Filter** > **Props** > **Has unused props** to show only components with a declared prop the scan never saw passed. Each row then reads, for example, `3 unused props` beside its name. It's also in the page URL as `unused-props=true`. A component's details also list its unused props by name, under **Unused props**, in place of the count of props never set.
