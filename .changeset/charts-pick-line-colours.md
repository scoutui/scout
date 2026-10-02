---
"@scoutui/web-app": patch
---

Every line and band on a chart now has its own colour. A tag keeps its colour unless an earlier line on the same chart has it or one like it, packages and components never borrow a tag's colour, and every line follows dark mode. Lines no longer dash to tell repeated colours apart; dashes stay only where two lines share a meaning, such as two deprecated lines.
