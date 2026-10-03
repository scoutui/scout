---
"@scoutui/web-app": minor
---

The dashboard now has one word for each place a component is used: a **use**. The **Occurrences** columns are now **Uses**, the Usage tab counts uses instead of calls, the Composition tab's tooltips count uses instead of call sites, and the governance table shows **Uses left**.

Three keys in links and queries change with it, and the old ones no longer work:

- The repo page's filter: `?occurrences=gte:10` is now `?uses=gte:10`. A saved link with `occurrences=` opens the page without that filter.
- The Usage tab's sort: `sort=calls~asc` is now `sort=uses~asc`. A saved link with `calls~` opens the tab in its default order.
- The `q` query on `/api/repos/<repo>/components`: `occurrences:>10` is now `uses:>10`. A query with `occurrences:` matches no components.
