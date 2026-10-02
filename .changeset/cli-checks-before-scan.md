---
"@scoutui/cli": patch
---

`scout scan` now checks everything that would stop the upload before it scans, and stops with one line saying what to fix:
- The commit must be on the branch the dashboard tracks, with no uncommitted changes and the clone's full history.
- A commit the dashboard already has is skipped without scanning.

Also:
- `scout auth login` checks the CLI version before you sign in.
- The upload and skip lines and the dashboard's warnings print under `--quiet`, and some errors link to a page that explains them.
- A remote that uses an SSH host alias or a git `insteadOf` rewrite is recorded under its real address.
- A package listed only in `peerDependencies` or `optionalDependencies` no longer stops the upload when it isn't installed.
- An uploaded scan records the branch the dashboard tracks and where the commit sits on it (`repo.branch`, `repo.branchPosition`).
- A CI job needs to know which branch the dashboard tracks: set `branch` in `scout.config.json`, or run `git remote set-head origin --auto` after checkout.
