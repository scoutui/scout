---
"@scoutui/cli": patch
---

A copy of a package in a folder your `.gitignore` ignores, such as a build's output in `.output/` or `storybook-static/`, no longer counts when a scan works out which package a web component belongs to. Before, such a copy could give a tag the wrong version, or make it read as claimed by two packages. Setting `gitignore` to `false` in the config reads those folders again.
