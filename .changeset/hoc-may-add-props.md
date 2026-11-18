---
"@scoutui/cli": minor
---

A use through a wrapper that may pass the component props the use doesn't write, such as `connect(mapState)(Counter)` or a wrapper the scan can't read, now marks its `hoc` trace step with `mayAddProps: true`. A wrapper that passes props through unchanged, such as `memo` or `forwardRef`, doesn't get the mark. The dashboard doesn't read it yet; it's what will let it say "can't tell" instead of "never passed" for the props such a wrapper supplies.
