---
"@scoutui/cli": patch
---

`scout scan`'s progress is easier to read:

- In a CI log, the file count prints once as the scan starts and then at most every 10 seconds, instead of a line every 50 files.
- A new line, `Matching occurrences to components…`, shows the part of the scan that used to print nothing.
- In a terminal, the progress line is cut to the terminal's width, so a narrow window no longer leaves a trail of half-rewritten lines, and a warning no longer lands on the end of it.
- An upload ends with `Uploaded the scan of <commit>: <url>` instead of an internal scan ID, and the summary no longer repeats the advice the warning above it already gives.
