# @scoutui/web-shared

The read models behind the [Scout dashboard](../../apps/web-app). They turn stored scans into what each page shows, such as a repo's components, a package's users or a migration's progress.

This package is internal and isn't published. The dashboard is its only user, so a change needs a `@scoutui/web-app` changeset. Its database tests run only when `DATABASE_URL` is set; [CONTRIBUTING.md](../../CONTRIBUTING.md#the-check) shows how to start a throwaway database.
