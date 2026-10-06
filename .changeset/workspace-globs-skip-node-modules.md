---
"@scoutui/cli": patch
---

A workspace glob such as `packages/**` no longer takes the packages installed in `node_modules` as workspace members. Before, `scout init` offered them as packages to leave out, and a scan read their published files as your own source, so it could count uses inside your dependencies or stop on their build output.
