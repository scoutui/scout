---
"@scoutui/cli": patch
---

A constant written in constant case and imported from a package, then passed to a hook or a wrapper function, such as `useCssVar(CSS_VARIABLE_HEADER_HEIGHT)`, is no longer reported as a React component. Components passed the same way, such as `useModalHolder(ConfirmModal)`, are still counted.
