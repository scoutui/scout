---
"@scoutui/web-app": minor
---

A migration counts only the replacement its record names. Before, when no repo used a replacement component yet, the migration counted every component of the replacement's package instead and read as partly migrated; now it reads **0% migrated** and names the component, such as `Table · tdesign-vue-next`, until a repo uses it.
