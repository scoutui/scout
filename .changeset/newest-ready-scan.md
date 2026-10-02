---
"@scoutui/web-app": patch
---

A scan that fails or is still being prepared no longer blocks pages for other repos. Each page shows a repo's newest ready scan and says when a newer one isn't ready. A repo with no ready scan is left out of the pages that cover every repo and named above them. Charts leave out scans that couldn't be prepared instead of waiting for them. Pages still wait while the dashboard rebuilds its stored scans after an upgrade.
