---
"@scoutui/cli": minor
---

In a terminal, `scout scan` now starts with a heading, `▲ Scout <version> · <repo id> at <commit>`, and a compass needle turns on the progress line while it reads files. Neither appears with `--quiet`, when the output goes to a file or another command, or in CI, so logs read as before.
