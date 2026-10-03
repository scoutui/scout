---
"@scoutui/cli": minor
---

In a terminal, the CLI now says when a newer version is available, on the line under the wordmark (or first, for a command without one), with the command that gets it for your repo's package manager, for example `Scout 0.3.0 is available. Update with npm i -D @scoutui/cli@latest.` When the dashboard you last uploaded to can't read the new version's scans yet, the line says so instead, and to keep the current version for now. Scout asks the npm registry at most once a day, in the background, so the line never holds up a command and shows what it heard on the next run. It says nothing when it can't reach the registry. The check is off in CI, when output goes to a file or another command, with `--quiet`, and when `SCOUTUI_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER` is set.
