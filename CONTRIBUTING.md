# Contributing to Scout

Thanks for your interest in contributing! Bug reports, documentation fixes, scanner improvements and new features are all welcome.

This guide covers how to take part. Before you write code, read [CODING_STANDARDS.md](CODING_STANDARDS.md), which says what review checks in code, tests and scanner changes.

## Ways to contribute

- **Report a bug.** Check [GitHub Issues](https://github.com/scoutui/scout/issues) first, then open one with the bug report template. A minimal reproduction helps most.
- **Suggest a feature.** Open an issue with the feature request template, starting from the problem you want solved.
- **Improve the docs.** Typos, unclear steps and missing examples are always welcome. See [Documentation](#documentation).
- **Contribute code.** For anything bigger than a small fix, find or open an issue first and agree on the approach there, so your time goes into a change that can merge. Then fork the repository and work on a branch.

Questions and ideas that aren't ready for an issue go in [GitHub Discussions](https://github.com/scoutui/scout/discussions).

## Set up the repository

You need Node 24 (`.mise.toml` pins the exact version) and Corepack for Yarn 4. Docker is only needed for the dashboard's local Postgres.

```bash
corepack enable
yarn install
```

Then run [the check](#the-check) once to confirm everything builds. To work on the dashboard, see [Run the dashboard locally](https://scoutui.dev/docs/guides/run-the-dashboard-locally).

### Repository layout

| Path | What it is |
| --- | --- |
| `packages/cli` | The CLI, published as `@scoutui/cli`. It bundles the parsers, the reference graph and `scan-format`. |
| `packages/scan-format` | The scan file's format: its types, schema and checks. Used by the CLI and the dashboard. |
| `packages/parser-react`, `packages/parser-vue` | The framework parsers. |
| `packages/reference-graph` | Import resolution across modules. |
| `packages/web-shared` | Read models for the dashboard. |
| `packages/palette` | Colours for the dashboard and the docs site. |
| `apps/web-app` | The dashboard (Next.js). |
| `apps/docs` | The documentation site (Docusaurus). |
| `charts/scout` | The Helm chart for the dashboard. |
| `test/fixtures` | Fixture repos for scanner tests. |
| `consumer-ci` | Scans of real public repos that catch scanner regressions. |

Only the CLI is published to npm. The other packages are internal.

## Commits and pull request titles

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit subjects and pull request titles: `<type>(scope): <message>`. Pull requests are squash-merged, so the title becomes the commit on `main`.

## Changesets

A changeset is a release note for a package. Add one with `yarn changeset`: pick the packages, choose the bump and write a short summary.

- **When you need one:** someone who uses the CLI, or uses or runs the dashboard, would notice the change: new behaviour, a fix, a changed message or a changed scan file. Refactors, tests and anything else they wouldn't notice need none.
- **Which bump:** Scout follows semantic versioning: patch for a fix, minor for new behaviour. Until 1.0, a breaking change is minor too, because major would release 1.0.
- **Which package:** the CLI bundles the parsers, `reference-graph` and `scan-format`, so a noticeable change there is a `@scoutui/cli` changeset. A `scan-format` change the dashboard shows also needs a `@scoutui/web-app` one.
- **The summary** goes word for word into the package's `CHANGELOG.md`, so write it for that package's users: what changed for them, not how you built it.

Maintainers release by merging the version pull request that collects the changesets: the CLI goes to npm, and the dashboard's image and Helm chart are published with a GitHub Release. [`.changeset/README.md`](.changeset/README.md#releasing) has the details.

### The Helm chart

The chart takes no changeset. A pull request that changes it releases a new chart version when it merges, so:

1. Raise `version` in `charts/scout/Chart.yaml` following semantic versioning: patch for a fix (for example from `0.1.0` to `0.1.1`), minor for a new value or behaviour.
2. Add a section for that version at the top of `charts/scout/CHANGELOG.md`, saying what changed for people who deploy the chart.

CI fails a pull request that changes the chart without raising its version. Changes to `tests/` and `ci/` alone don't need one, because they aren't part of the published chart. A dashboard release updates the chart for you.

## Before you open a pull request

Check your change against the [coding standards](CODING_STANDARDS.md), then run the check.

### The check

Run the full check:

```bash
yarn turbo run lint typecheck test build smoke
```

It lints, type-checks, tests and builds every package, builds the docs site (which fails on broken links), and smoke-tests the packed CLI.

The database tests (the dashboard and `web-shared`) skip unless `DATABASE_URL` is set. If you changed either, start Postgres with `docker compose up -d db`, set `DATABASE_URL=postgres://scout:scout@localhost:5432/scout` and run the check again. The tests create their own databases on that server and drop them afterwards, so the user in the URL needs permission to create databases.

If a check fails, even one that looks unrelated, find the cause before you move on. Two common ones:

- A fixture's `node_modules/` or `dist/` is hidden by the root `.gitignore`, so it passes locally but fails in CI. Add a `!` exception next to the existing ones.
- `yarn.lock` lost workspace entries after a package moved. Run `yarn install` and commit the result.

### In the pull request

- Fill in the template and link the issue.
- Update the user docs under `apps/docs/docs/` if behaviour changed.
- For scanner changes, say [which kind of change](CODING_STANDARDS.md#changing-what-the-scanner-reports-or-stores) it is and include the [real-repo check](CODING_STANDARDS.md#check-against-a-real-repo).
- If you deleted or loosened an assertion, say why.

## Documentation

User docs live in `apps/docs/docs/` and are published at [scoutui.dev/docs](https://scoutui.dev/docs). [`apps/docs/CONTRIBUTING.md`](apps/docs/CONTRIBUTING.md) explains how to write a page. Preview the site with `yarn workspace @scoutui/docs dev`.

## Code review

A maintainer reviews every pull request before it merges, starting with the template's checklist. This is a small project, so a review can take a few days.

## Questions?

- Ask in [GitHub Discussions](https://github.com/scoutui/scout/discussions).
- Check the [documentation](https://scoutui.dev/docs).
- Open an issue if you're stuck.

To report a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing to Scout, you agree that your contributions will be licensed under the [MIT License](LICENSE).
