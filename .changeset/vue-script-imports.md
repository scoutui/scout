---
"@scoutui/cli": patch
---

In a Vue file with both `<script>` and `<script setup>`, a component imported in the plain `<script>` is now counted for that component, written `<LineItem>` or `<line-item>`, as it is when imported in `<script setup>`. Before, `<LineItem>` wasn't counted at all and `<line-item>` was counted as a web component with no package.

A kebab-case tag such as `<lazy-panel>` whose name the file's own script declares (`const LazyPanel = defineAsyncComponent(…)`) is no longer counted as a web component with no package. It isn't counted, the same as `<LazyPanel>`.

A Vue template tag the scan can't follow to a component, such as an imported icon made by a factory function, now adds an `unresolved-reference` or `late-bound-render` entry to the scan file's diagnostics, as a React tag does. These are `info` entries, shown as counts with `--debug`, and no use counts change.
