---
description: "What \"renders\" and \"rendered by\" mean in Scout, how they differ from how tags nest in your markup, and how they show on a component's Composition tab."
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

So if you replace `Button`, the components that render it are the files to edit.

A tag inside a helper function that isn't a component, such as a `renderRow()` that returns JSX, counts for every component that calls the helper.

A [web component](/docs/reference/glossary#web-component) such as `<acme-button>` counts for the component whose code uses it. On its own **Composition** tab it renders nothing: what a web component draws inside itself isn't read.

## On the Composition tab

In the dashboard, a component's **Composition** tab shows what renders it and what it renders, within one repo. Its caption counts both sides, as in `Rendered directly by 200 components, and by 400 in total.` *Directly* counts the components that render it themselves, and *in total* every component on that side, however many steps away. [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used#composition) shows how to use the tab.

:::note
A component can have uses and still have nothing that renders it. That is expected when every use sits outside a component. For example, an `App` that `main.tsx` mounts with `createRoot(root).render(<App />)` is used, but no component renders it. Those uses count on the **Usage** tab.
:::

## In the JSON

Each component's `composition` holds the direct links only: which components it renders and which render it, with how many times each. The [scan file reference](/docs/reference/artifact#composition) lists the fields.

Each use also records how the component was reached, such as through a helper function or a wrapper, in [`trace`](/docs/reference/artifact#trace).
