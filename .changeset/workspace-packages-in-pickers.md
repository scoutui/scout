---
"@scoutui/web-app": minor
---

Lifecycle records now cover packages written in the same monorepo as the apps that use them. The record pickers list these packages after the installed ones, and their components once you search in one. Typing a component name lists the packages that have it after the results. A record on such a package marks its components deprecated in that monorepo too, back to the first scan, with no rescan. For a few minutes after upgrading, the governance page reads Preparing scan data.
