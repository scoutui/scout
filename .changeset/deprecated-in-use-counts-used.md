---
"@scoutui/web-app": patch
---

**Deprecated components in use** now counts only deprecated components with at least one use. A deprecated component a scan lists but nothing uses, such as one the repo defines and never renders, keeps its warning icon but is no longer counted. This applies to the repo page's header and its change since the previous scan, the **Deprecated** column on the repos and packages lists, a package page's header, and every **deprecated** chip. The chip now shows only the components it counts.
