---
"@scoutui/web-app": minor
---

A component's **Composition** tab is now one diagram you can explore, in place of the two lists and the render tree:

- One line above it says how many components render the component, directly and in total, and how many it renders.
- What renders the component is on its left, and what it renders is on its right, with a column for each number of steps away.
- **+N more** opens a list inside the diagram that you can filter.
- A search box above the diagram finds any component that renders it or that it renders, however far away, and picking one selects it.
- Clicking a box selects it and shows the components one step further out. A bar above the diagram writes its route out as a sentence, such as "ProductGrid renders ProductCard 5 times.", with a link to open that component. Links that open the tab with a route drawn still work.
- On a phone the tab opens on the list of components, with the diagram as a second view.
- The zoom buttons are gone. Scroll or pinch to zoom.
