---
"@scoutui/cli": patch
---

In React, a prop named `on` plus a capital letter with a written value, such as `onLabel="On"`, is now recorded as a prop with that value instead of as an event. Handlers such as `onClick={save}` are still counted as events. In Vue, a handler bound as a prop, such as `:onClick="save"`, is now counted as an event too, as it is in React.
