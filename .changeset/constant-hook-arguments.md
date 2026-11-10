---
"@scoutui/cli": patch
---

A constant written in constant case and passed to a hook, such as `useCssVar(CSS_VARIABLE_HEADER_HEIGHT)`, is no longer reported as a React component when it comes from a package. Components passed to hooks, such as `useModalHolder(ConfirmModal)`, are still counted.
