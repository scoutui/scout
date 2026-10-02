# @scoutui/reference-graph

Follows imports across a repository for the [Scout](https://scoutui.dev) CLI, through path aliases, workspace packages, re-exports and wrappers, so each usage is traced back to the component it refers to.

This package is internal and isn't published. The CLI bundles it, so a change needs a `@scoutui/cli` changeset. Before you change how components are identified, read [CODING_STANDARDS.md](../../CODING_STANDARDS.md#changing-what-the-scanner-reports-or-stores).
