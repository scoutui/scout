---
"@scoutui/cli": minor
---

`scout scan --csv <path>` also writes every component the scan found to a CSV file, one row per component, most used first, with its name, where it comes from (its package or the file that declares it), its version, its occurrences and the files they're in. It works on a dry run and an upload, so a CI job can keep the file as a build artifact.
