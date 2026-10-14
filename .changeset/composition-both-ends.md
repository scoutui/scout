---
"@scoutui/web-app": minor
---

A component's Composition tab now lists, in full, the top-level components that end up rendering it (mostly pages and views) beside the components that render it directly. Pick a page to draw its route down to the component, or pick a component in between to see only the routes through it. Every name opens its own page, long names show in full, and the mouse wheel scrolls the page instead of zooming the diagram. Below 1024px wide the tab is a list where each page opens its route beneath it. A saved link to the tab still opens on its picked component, but the lists it had opened (`list=` and `bring=` in the link) are no longer kept.
