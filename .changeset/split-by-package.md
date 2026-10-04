---
"@scoutui/web-app": minor
---

Repo pages show what a scan covered and which package each use sits in:

- A repo page says what the scan covered when it left something out, such as **Scanned: everything except apps/playground.** or **Scanned: apps/web only.**
- The Components table's **Used in** filter shows only the components used in one package, with that package's uses and files. Its link keeps the package in `used-in=`; after a package is renamed, a saved link matches nothing until you pick the new name.
- A component's Usage tab lists its uses by package when they sit in more than one.

Scans uploaded by older CLI versions show none of these. A component's page now also names its package after **From**, as in **From** `@acme/ui`. For a few minutes after upgrading, while the dashboard prepares every stored scan again, pages read **Preparing scan data**.
