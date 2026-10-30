---
"@scoutui/cli": minor
---

The CLI now scans Angular repos, alongside React and Vue. It reads `@Component` classes and their templates (inline or `templateUrl`), matching elements and attribute selectors to standalone `imports` or `NgModule` declarations, and reads inputs and outputs from both the decorator and signal APIs. It uses the scanned repo's own `@angular/compiler`, so install your dependencies before scanning an Angular repo running Angular 19 or later.
