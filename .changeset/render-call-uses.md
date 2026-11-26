---
"@scoutui/cli": patch
---

A render call in a `.js` or `.ts` file is now counted as a use. `createElement(Card, { size: "sm" })` with `createElement` from `react`, and `h(Card, { size: "sm" })` with `h` from `vue` (or `vue-demi`), pass `size` to `Card` the same way `<Card size="sm" />` does. Before, a prop passed only this way, such as one passed from a Vue composable, showed as never passed. Props passed as anything other than an object literal, such as `h(Card, props)`, are recorded as `...rest`, the same as `v-bind="props"`.
