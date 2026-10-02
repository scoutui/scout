---
"@scoutui/web-app": patch
---

The dashboard now refuses a scan whose repository name it already has from a different git remote, and the message names that remote. A rescan from a release CLI is no longer refused because the commit was scanned with that version's prerelease. Repositories whose SSH remote is an `ssh://` URL or uses a user other than `git` now show their remote and link to their commits.
