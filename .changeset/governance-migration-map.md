---
"@scoutui/web-app": minor
---

The governance page now lists every record in one table, grouped by the package it comes from. Occurrences left shows how much of each record's package or component is still used in each repo's latest scan and links to its trend, and a record's name links to its component or package page. Packages with nothing left fold behind Show N complete, and following a link to a record marks its row. Edit opens the form in place of the row, with Delete inside it and a line saying who added and last changed the record. Tags are a table showing each tag's colour, its packages (long lists fold behind +N more) and how many scanned packages it matches, and the tag form previews its matches as you type. For a few minutes after upgrading, while the dashboard rebuilds its stored results, counts on the governance page read No data, and the charts page's migration and retirement rows and each repo's Adoption tab show Preparing scan data.
