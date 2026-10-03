---
"@scoutui/cli": patch
---

Clearer `--help` text. `scout --help` now ends with how to get started (`scout init`, then `scout scan --dry-run`) and where the docs are. Each option says what it does: `scan --quiet` hides progress and most warnings as well as the summary, and `--host` lists where the address comes from when you don't pass one. `scan`, `init` and `auth` now list `--debug` too.
