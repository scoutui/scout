---
"@scoutui/web-app": minor
---

A migration's **% migrated** and its chart count the replacement only in repos that have used the component or package it replaces, so repos that never needed to migrate no longer raise them. A repo that finished migrating before its first scan isn't counted until scans of older commits that still use the old one are uploaded. A migration whose old component no repo has used shows no percentage and says there's nothing to migrate. The dashboard recalculates its migration charts after the upgrade.
