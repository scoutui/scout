---
"@scoutui/cli": patch
---

When the config is in a folder below the repository root, the scan file's `cycle-detected` and `chain-too-deep` paths and an `auto-import-stale-entry`'s `target` are now relative to the repository root, like every other path in it. Before, they were relative to the config's folder or the monorepo root.
