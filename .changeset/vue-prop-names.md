---
"@scoutui/cli": patch
---

A Vue prop written in kebab case now counts as the camelCase prop the component declares: `<Card is-preview />` passes `isPreview`, and is recorded under that name. Before, `isPreview` showed as never passed and `is-preview` as undeclared. An attribute the component doesn't declare keeps its written name. `v-model` on a component now counts as passing `modelValue`, and `v-model:open` as passing `open`. Props declared with `defineModel()` are now read as declared props.
