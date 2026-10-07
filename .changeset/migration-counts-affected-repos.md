---
"@scoutui/web-app": minor
---

A migration's **% migrated** counts the replacement only in repos that have used the component it replaces, so repos that never needed to migrate no longer raise it. A migration whose old component no repo has used shows no percentage and says there's nothing to migrate. The dashboard recalculates its migration charts after the upgrade.
