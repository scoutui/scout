---
"@scoutui/web-app": patch
---

The dashboard now declares its `ulid` dependency itself. Before, it only worked because the CLI's copy happened to be installed next to it.
