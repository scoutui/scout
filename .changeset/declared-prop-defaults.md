---
"@scoutui/cli": minor
---

The scan file now says whether each declared prop has a default. A default that isn't a literal, such as `icon = defaultIcon` or `items = () => []`, is written as `hasDefault: true`, with `defaultRef: "defaultIcon"` when it names a variable or a dotted path. A prop with no default is written as `hasDefault: false`. Before, both looked the same. A literal default is still written as `default`. A default the scan can't read, such as an Angular setter input or Vue `withDefaults` with a variable, has none of the three fields. The scan also reads Angular input defaults (`@Input() size = "md"`, `input("md")` and `model(0)`) for the first time. The scan format version doesn't change, and older dashboards ignore the new fields.
