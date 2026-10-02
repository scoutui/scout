---
"@scoutui/web-app": minor
---

Filtered pages keep each filter in its own readable URL parameter, such as `/repos/acme-web?package=@acme/ui&deprecated=true&occurrences=gte:10`, and `q` is only ever the search text. Links shared in the old `?q=` form open the page without their filters.
