---
"@scoutui/cli": patch
---

Errors now print one line under `Error:`, without a stack trace, and warnings print under `Warning:` in plain words. Add `--debug`, or set `SCOUTUI_DEBUG=1`, to see the detail behind an error, such as the dashboard's reply, and the counts of usages the scan couldn't match. `scout scan` outside a git repository, in a repository with no commits, and `scout init` over an existing config now say what to do. A failed upload prints one line, and the CLI says once that it's waiting for the dashboard. In a shallow clone, the scan now warns and records no first commit, instead of recording the oldest fetched commit as the first.
