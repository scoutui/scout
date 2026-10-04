---
"@scoutui/web-app": patch
---

A table chart's **Change** column no longer reads 0 just because another repo was scanned last. For a chart of all repos it now shows the change over the last 30 days, each repo compared with itself, as the migration and retirement rows do; for a chart of one repo it is still the change since that repo's previous scan. A repo's first scan no longer reads **repo added**, and a series with nothing to compare yet reads **—**.
