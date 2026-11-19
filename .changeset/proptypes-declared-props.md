---
"@scoutui/cli": minor
---

A React component's `propTypes` and `defaultProps`, assigned at module level or as `static` fields of a class, are now read as its declared props. Its props are the names it destructures plus the keys of `propTypes`, so a component that takes `props` without destructuring now has declared props too. `.isRequired` marks a prop required, and a `defaultProps` value is its default when the destructure doesn't set one. In JavaScript repos that use `propTypes`, more components have declared props, and the unused-props counts change to match.
