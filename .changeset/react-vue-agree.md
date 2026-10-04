---
"@scoutui/cli": patch
---

React and Vue scans now agree in two places:

- A file that isn't code is never a component. In a Vue file, a tag bound to an import such as `import Logo from "./logo.svg"` is no longer counted as a component defined in `logo.svg`, the same as in a React file.
- A column counts from 1 in React files, as it already did in Vue files and as it does in your editor. This moves the `column` of every use in a React file by one, along with its `occurrenceId`, which is computed from the column. A React component's `definition`, and the `path:line:column` in a scan warning, move by one too.
