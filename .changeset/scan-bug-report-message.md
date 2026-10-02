---
"@scoutui/cli": patch
---

If `scout scan` ever builds a scan file that fails its own format check, it now says in one line that this is a bug in Scout and where to report it, instead of printing a stack trace. It still exits with code `1` and writes no scan file. Scans are otherwise byte for byte the same.
