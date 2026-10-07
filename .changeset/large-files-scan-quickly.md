---
"@scoutui/cli": patch
---

A scan no longer stops on a large file, such as a minified bundle of several megabytes. Before, the time to read a file grew with the square of its size, so "Reading files" could stay on one file for hours.
