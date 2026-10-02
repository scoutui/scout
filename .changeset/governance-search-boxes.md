---
"@scoutui/web-app": minor
---

In the governance form, Package or component and Superseded by are now search boxes. Each component is listed with its package beside it, best match first, then the most used across each repo's latest scan. Selecting a package searches only that package, and the package stays for the next record; All of <package> marks the whole package, and the line under the field says how many components that is. Rows that already have a record are dimmed and say why. Create now keeps the form open for the next record and says what was added, and Cancel becomes Close. For a few minutes after upgrading, while the dashboard rebuilds its stored results, the search boxes have nothing to offer.
