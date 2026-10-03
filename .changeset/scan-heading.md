---
"@scoutui/cli": minor
---

In a terminal, the CLI's output now has one look. `scan`, `backfill` and `--help` start with the wordmark, `scout <version>`, and `scan` adds the repo and commit. Numbers stand out, Scout's teal marks names and links, and a line saying something went well starts with `✓`. While `scan` reads files a spinner turns beside a progress bar, the upload shows a spinner until the dashboard has the scan, and `backfill` shows one with a bar of the commits done while it installs, scans and uploads each commit.

None of this appears in CI, when output goes to a file or another command, or with `NO_COLOR`, so logs read as before. Colour now also stays off in CI unless `FORCE_COLOR` is set. The scan summary groups thousands, as the dashboard does: `1,191 components, 3,925 occurrences`.
