---
"@scoutui/cli": patch
---

An Angular library component that a package exports under two names, such as `NgIcon` and `NgIcon as NgIconComponent`, is now counted as one component instead of making every element that uses it ambiguous. Scout reports it under the name your file imports, otherwise under the name the library declares the class with. Before, each such element produced an `angular-selector-ambiguous` warning and its uses weren't counted.
