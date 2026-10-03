---
"@scoutui/cli": minor
---

`scout scan` now stops when `include` matches no files, instead of reporting an empty scan as a success. It prints `Error: No files match "include" in ./scout.config.json (<patterns>). Point it at your source files and scan again.` and exits `2`, on a dry run and an upload alike. An upload used to scan first and then exit `1`; it now stops before contacting the dashboard.
