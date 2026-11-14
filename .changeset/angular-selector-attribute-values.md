---
"@scoutui/cli": patch
---

An Angular selector that requires an attribute's value, such as `button[type=submit]` or `input[type=checkbox][required]`, now matches an element written with that value. Before, it never matched, so those components and directives were missed, and a selector that excludes a value (`input:not([type=checkbox])`) matched every value.
