---
description: "What \"renders\" and \"rendered by\" mean in Scout, how they differ from how tags nest in your markup, which frameworks record them, and how they show on a component's Composition tab."
sidebar_label: "Composition"
---

# Composition: renders and rendered by

Besides where each component is used, a scan records which components render which. If `ProductCard` uses a `Button`, then `ProductCard` *renders* `Button`, and `Button` is *rendered by* `ProductCard`. This page explains what counts, why it isn't the same as how tags nest in your markup, and where you see it.

## Renders means "written in its own code"

Component A renders component B when B is used inside A's own code: the function, or the `.vue` file, that defines A.

That is not the same as nesting in markup. Take this `Page`:

```tsx title="Page.tsx"
export function Page() {
  return (
    <Card>
      <Button>Buy</Button>
    </Card>
  );
}
```

`Button` sits between the `<Card>` tags, but it is `Page`'s code that puts it there. `Card` only receives it as content and shows it wherever `Card` shows its children. So `Page` renders both `Card` and `Button`, and `Card` does not render `Button`. If `Card`'s own function wrote `<Button>`, then `Card` would render it.

This answers the question a migration asks: whose code would I change? If you replace `Button`, the components that render it are the files to edit. Markup nesting would point at `Card`, whose code never mentions `Button`.

A tag inside a helper function that isn't a component, such as a `renderRow()` that returns JSX, counts for every component that calls the helper.

## Which frameworks record it

Composition is recorded for React and Vue, the two frameworks a scan reads.

- **React:** Each component records what its own code renders, so the chain follows your components through as many levels as your code has. A file that defines several components records each one separately.
- **Vue:** Each `.vue` file is one component, and every component tag in its template is rendered by that file's component, however deeply the tag is nested. The chain then continues through the components that file uses.

A [web component](/docs/reference/glossary#web-component) such as `<acme-button>` counts for the component whose code uses it, in either framework. On its **Composition** tab it renders nothing, because what a web component draws inside itself isn't read. The [framework support reference](/docs/reference/framework-support) has the full picture per framework.

## On the Composition tab

In the dashboard, open a component from a repo's **Components** table and choose the **Composition** tab. Everything on it is within that one repo.

The tab draws the component in a diagram, with what renders it to its left and what it renders to its right. Each column is one step further away: on the left, the components that render it directly, then the components that render those, and so on up the chain. A component that can be reached by more than one route is drawn once, in the column nearest the component.

The caption counts both sides, as in `Rendered directly by 200 components, and by 400 in total.` *Directly* is the first column, and *in total* is every component on that side, however many steps away.

Selecting a component draws its route to the component, says how many times each component on the route renders the next, and shows the components one step further out. The selection is kept in the page's link, so a copied link opens with that route drawn. [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used#composition) shows how to use the tab.

:::note
A component can have uses and still have nothing that renders it. That is expected when every use sits outside a component. For example, an `App` that `main.tsx` mounts with `createRoot(root).render(<App />)` is used, but no component renders it. Those uses count on the **Usage** tab.
:::

## In the JSON

Each component's `composition` holds the direct links only: which components it renders and which render it, with how many times each. The dashboard works out the longer chains from these. The [scan file reference](/docs/reference/artifact#composition) lists the fields.

Each use also records how the component was reached, such as through a helper function or a wrapper, in [`trace`](/docs/reference/artifact#trace).
