---
"@scoutui/web-app": patch
---

The chart of a migration of more than two components says how many in its heading, such as "Migration: 8 components · @acme/ui-legacy → @acme/ui", instead of naming every one. The table under the chart still names each component. The chart's image and the page's breadcrumb use the same shorter title, and the breadcrumb of a migration of two components from different packages now names both. On a phone, a package name in the heading moves to the next line whole instead of breaking after its scope. The dashboard recalculates its migration and retirement results after the upgrade.
