---
"@scoutui/cli": patch
---

`scout scan` now calls each place a component is used a use, as the dashboard does: in its summary (`260 components, 831 uses`), in its warnings and in the line about uses it couldn't match. The scan file and `--json` output don't change.
