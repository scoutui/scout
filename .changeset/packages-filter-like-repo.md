---
"@scoutui/web-app": patch
---

The Packages page's filter now works like the filter on a repo's page:

- Its counts, the deprecated count included, follow the other filters.
- Tags and version states that no package matches are hidden, and Versions leaves the menu when only one state is left.
- With no library tags, the Tag list links to Governance.
- Tag colours keep their dark-mode shade.
- A long search no longer runs under the clear button.
- Screen readers hear which options are selected.
- The search box no longer stretches across wide screens, and phones show the package count on its own line.
