---
"@scoutui/cli": patch
---

A React prop named `on` plus a capital letter with a written value, such as `onLabel="On"`, is now recorded as a prop with that value instead of as an event with no value. Handlers such as `onClick={save}` are still counted as events.
