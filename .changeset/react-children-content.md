---
"@scoutui/cli": patch
---

Content between a React component's tags now counts as passing its `children` prop, so `<Button>Save</Button>` is a use that sets `children`, just as `<Button children="Save" />` is. Before, only attributes counted, and a component that declares `children` showed it as never passed. The content is recorded as a variable or expression, not as a written value. A custom element's content fills its slots, so it still sets no `children`.
