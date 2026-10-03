---
"@scoutui/web-app": minor
---

The dashboard now has one word for each place a component is used: a **use**. The **Occurrences** columns are now **Uses**, the Usage tab counts uses instead of calls, the Composition tab's tooltips count uses instead of call sites, and the governance table shows **Uses left**.

The repo page's filter in its link changes too: `?occurrences=gte:10` is now `?uses=gte:10`. A saved link with `occurrences=` opens the page without that filter, so change it to `uses=` to keep it.
