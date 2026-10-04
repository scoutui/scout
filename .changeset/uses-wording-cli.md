---
"@scoutui/cli": patch
---

`scout scan` now calls each place a component is used a use, as the dashboard does: in its summary (`260 components, 831 uses`), in its warnings and in the line about uses it couldn't match. The scan file and `--json` output don't change.

Two lines now say what they count:

- With `--debug`, the count of renders Scout couldn't follow reads `5 renders couldn't be followed to a component and weren't counted as uses.` It used to read like the summary's unmatched uses, which are a different count.
- `scan --upload` refuses a scan with no uses with `Couldn't upload the scan: no uses were found.`, in place of `no components were found`.
