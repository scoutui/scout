---
"@scoutui/web-app": patch
---

When the dashboard refuses a CLI that's too old, or a rescan from an older CLI, the message now names the CLI version to use and an `npx` command that runs it. A sign-in refused because of the CLI's version now starts "Couldn't sign in" instead of "Couldn't upload the scan".
