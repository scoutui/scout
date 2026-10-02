---
"@scoutui/web-app": patch
---

Charts over time no longer pass off a repo's first scan as a change. A chart across several repos says in its tooltip how many of them each point covers, for example **3 of 4 repos**. When the latest change comes from a repo's first scan, a table chart's **Change** column and the migration and retirement rows read **repo added** instead of a change that only reflects the new repo. Every total stays as it was. Right after the upgrade, the migration and retirement rows show **Preparing scan data** until the dashboard has rebuilt them.
