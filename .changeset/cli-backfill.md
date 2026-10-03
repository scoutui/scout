---
"@scoutui/cli": minor
---

New `scout backfill` command: scans past commits on the branch the dashboard tracks, one per week for the last six months (`--since` to choose), and uploads them, so a repo's charts show history from the first day. It installs each commit in a temporary checkout and never touches yours.

New optional `install` field in `scout.config.json`: the command `scout backfill` runs to install a commit, for repos where it can't work it out from the lockfile.
