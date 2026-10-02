---
"@scoutui/cli": patch
---

Scan files no longer include `depth` on each occurrence. Nothing read it, and the dashboard reads scans with or without it. `scout scan` also no longer prints a "Walking" progress line, which counted a pass that did no work.
