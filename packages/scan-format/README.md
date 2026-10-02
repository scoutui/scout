# @scoutui/scan-format

The format of the JSON file a [Scout](https://scoutui.dev) scan writes: its types, its schema and the checks that validate it, plus the small helpers that read it. The CLI uses it to write scans, and the dashboard uses it to read them.

This package is internal and isn't published. The CLI bundles it and the dashboard depends on it, so a change needs a changeset for whichever of the two it changes. Before you change an id or the file's shape, read [CODING_STANDARDS.md](../../CODING_STANDARDS.md#changing-what-the-scanner-reports-or-stores).

It runs in the browser as well as in Node, so it can't import Node built-ins.
