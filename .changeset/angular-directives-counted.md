---
"@scoutui/cli": minor
---

Angular directives are now counted wherever a template writes their selector, your repo's own and installed libraries' alike (Angular Material and Angular's own included), so Angular usage numbers go up. A directive that only rides along on a name another class owns, such as `NgControlStatus` on `ngModel`, isn't counted.
