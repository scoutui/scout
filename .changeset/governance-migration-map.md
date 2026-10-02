---
"@scoutui/web-app": minor
---

The governance page now reads as a migration map. Records sit in a Superseded table and a Retired table, grouped by the package they come from, with an arrow to what replaces each one, how many repos still use it, and a group's progress. A group whose records are all complete folds away. Edit opens the record where it is listed, and Delete moves into the form. Tags are a table showing each tag's packages and how many scanned packages it matches, and the tag form has one Packages box with a live preview of what it matches.
