---
"@scoutui/cli": minor
---

In a terminal, the CLI's output now has one look. `scan`, `backfill` and `--help` start with the wordmark, `scout <version>`: `scan` adds the repo and commit, and `backfill` the repo. Numbers stand out, Scout's teal marks links and, in help, commands and flags, and a line saying something went well starts with `✓`, a warning with `!` and an error with `✗`. While `scan` reads files a spinner turns beside a progress bar, and the upload shows a spinner until the dashboard has the scan. `backfill` shows one line for the commit it's working on, with what it's doing, a bar of the commits done and the count, in place of a `Scanning` line per commit, and ends with the link on a line of its own. `auth login` turns a spinner while it waits for you to approve the sign-in.

None of this appears in CI, when output goes to a file or another command, or with `NO_COLOR`, so logs read as before, apart from these changes:

- The scan summary lists the most used components only after `scout scan --dry-run` in a terminal. After an upload, and in CI, the summary is the counts, so the dashboard link is the last line.
- `auth login` ends with `✓ Signed in as <email> to <host>.`, naming the dashboard. With `NO_COLOR`, nothing turns while it waits.
- Colour stays off in CI unless `FORCE_COLOR` is set.
- The scan summary groups thousands, as the dashboard does: `1,191 components, 3,925 uses`.
