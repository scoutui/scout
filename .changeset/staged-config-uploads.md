---
"@scoutui/cli": patch
---

`scan` no longer refuses to upload because a new `scout.config.json` or scan file is staged but not committed. A staged new file now counts the same as an untracked one: it blocks the upload only when the scan reads it. When the only uncommitted changes are to `package.json` or its lockfile, as after installing the CLI, the error now names them and says to commit and push them.
