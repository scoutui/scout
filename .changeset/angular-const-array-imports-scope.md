---
"@scoutui/cli": patch
---

An Angular component's `imports` can now name a constant that holds a list of imports, such as `imports: [HlmButtonImports]` or `imports: [...SHARED_IMPORTS]`, where `export const HlmButtonImports = [HlmButton] as const` is declared in another file. The scan follows the constant (through spreads, nested arrays and files that re-export it) to what it holds, so the template only matches the components that list brings in. Before, such an entry made the scan treat every component in the repo as in scope, which reported elements as matching more than one component (`angular-selector-ambiguous`) and left their uses out. When part of a list still can't be read, the components it names are matched first, and the rest of the repo is only searched for an element none of them match.
