---
"@scoutui/web-app": patch
---

The dashboard records which CLI made each scan. `scout scan --rescan` can now replace a scan made by the previous CLI whatever its version, and the dashboard refuses an upload from the previous CLI with a note to install `@scoutui/cli` and scan again.
