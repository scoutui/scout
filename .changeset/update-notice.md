---
"@scoutui/cli": minor
---

In a terminal, the CLI now says at the end of a command when a newer version is available, with the command that gets it for your repo's package manager, for example `Scout 0.3.0 is available. Update with npm i -D @scoutui/cli@latest.` When `scan` or `backfill` uploads to a dashboard that can't read the new version's scans yet, the line says so instead, and to keep the current version for now. Scout checks the npm registry at most once a day, waits a second at most, and says nothing when it can't reach it. The check is off in CI, when output goes to a file or another command, with `--quiet`, and when `SCOUTUI_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER` is set.
