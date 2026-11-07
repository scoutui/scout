---
"@scoutui/cli": minor
---

Angular scans now count components from installed libraries, such as Angular Material, read from the compiled typings every Angular library ships: `<mat-card>` and `<button mat-button>` count as `MatCard` and `MatButton` with their inputs and outputs. A library's directives, such as `<mat-error>`, are no longer counted as web components.
