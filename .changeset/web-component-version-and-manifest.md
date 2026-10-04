---
"@scoutui/cli": patch
---

Web components now get their package's version when the package is installed only inside another package's folder, as npm and pnpm do for a dependency of a dependency. Before, they had no version and the dashboard listed the package as unversioned.

A scan now warns when a package's Custom Elements Manifest is missing or isn't valid JSON, instead of leaving its tags without a package and saying nothing.
