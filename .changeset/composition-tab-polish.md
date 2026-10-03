---
"@scoutui/web-app": patch
---

A component's **Composition** tab is easier to read:

- The render tree's caption is larger. Each sentence is on its own line, with the counts and the component's name set apart. On a phone the caption now opens the tab.
- Chips on the render tree widen to fit longer names when there's room.
- **Hide lists** and **Show lists** now sit beside the zoom buttons.
- The lists drop their explanatory line, so each shows more rows, and their button reads **Show all** with the list's total.
- Clicking a row now lists the components on its path under the row, so a long path stays readable, including on a phone.
- The render tree's columns list components in the same order as the lists.
- A long file path in a list is cut from its start, so the file name stays visible.
- Deprecated components in the lists carry the same warning triangle as on the render tree.
- An empty list says "None in this repo."
- The legend lists only what the render tree shows.
- The buttons at the render tree's edges say how many components are off screen.
- A long "defined at" path now wraps, so a component's page fits a phone screen.
