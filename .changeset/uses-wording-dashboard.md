---
"@scoutui/web-app": minor
---

The dashboard now uses one word for each thing, the same on every page:

- **Uses.** Each place a component is used is a **use**. The **Occurrences** columns are now **Uses**, the Usage tab counts uses instead of calls, the Composition tab's tooltips count uses instead of call sites, the governance table shows **Uses left**, and the charts' **Count** toggle is now **Uses**.
- **Type.** On a repo page, the **Framework** filter is now **Type**, and its pill reads `type`. Its **Tag** value is now **Undefined element**: a web component that nothing in the scan defines. **Tag** now means only your library tags.
- **Replaced.** On Governance, the record type **Superseded** is now **Replaced**, rows read **Replaced by**, and the warning reads **Replacement deprecated**. Migrations and retirements read **in progress** instead of **active**, and a retirement counts the uses **left** instead of **remaining**.
- **External and Local.** The **Origin** filter says what each value means: **Installed from a package** or **Defined in this repo**. A component's **External** or **Local** badge says the same on hover, and badges are capitalised.
- **Smaller changes.** Commit dates are under **Committed** instead of **Updated**, a package's components count **Repos** instead of **Consumers**, the repo page's changed view counts **changes** instead of **moved**, and the change since the previous scan reads `±0 since previous scan` or `up from 34.8% previously`.

Four keys in links and queries change with it, and the old ones no longer work:

- The repo page's uses filter: `?occurrences=gte:10` is now `?uses=gte:10`. A saved link with `occurrences=` opens the page without that filter.
- The repo page's type filter: `?kind=tag` is now `?kind=undefined-element`. A saved link with `kind=tag` opens the page without that filter.
- The Usage tab's sort: `sort=calls~asc` is now `sort=uses~asc`. A saved link with `calls~` opens the tab in its default order.
- The `q` query on `/api/repos/<repo>/components`: `occurrences:>10` is now `uses:>10`, and `kind:tag` is now `kind:undefined-element`. A query with the old ones matches no components.
