---
"@scoutui/web-app": patch
---

Charts now pick each line's colour, and every line follows dark mode. A tag keeps its colour unless a deprecated, successor or Local line, or a tag earlier on the chart, already has it or one like it. Other lines take the next chart colour that looks unlike those already drawn, and once those run out, neighbouring bands still differ. Lines no longer dash: their colour, end label and legend entry tell them apart.
