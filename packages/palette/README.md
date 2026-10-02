# @scoutui/palette

The colours of the [Scout dashboard](../../apps/web-app) and the [documentation site](../../apps/docs), as CSS custom properties for light and dark mode in [`palette.css`](palette.css). [`chart-colors.json`](chart-colors.json) holds the order in which charts hand out colours, the other chart colours a line can wear, and the pairs of chart colours some readers can't tell apart, which the palette test checks.

This package is internal and isn't published. The tests (`yarn turbo run test --filter=@scoutui/palette`) check contrast and that colours stay distinguishable for colour-blind readers.
