<div align="center">
  <img src="./apps/docs/static/img/favicon.svg" width="96" alt="">

# Scout

**See how your design system is used across every repo.**

_An open-source dashboard and CLI that track which components your teams use, where, and on which version._

[Documentation](https://scoutui.dev/docs/overview) • [Scan a repo](https://scoutui.dev/docs/tutorials/scan-your-first-repo) • [Deploy the dashboard](https://scoutui.dev/docs/guides/deploy-the-dashboard) • [Discussions](https://github.com/scoutui/scout/discussions)

[![npm](https://img.shields.io/npm/v/@scoutui/cli)](https://www.npmjs.com/package/@scoutui/cli)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/scoutui/scout/badge)](https://scorecard.dev/viewer/?uri=github.com/scoutui/scout)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

## What is Scout?

Scout is an adoption dashboard for design-system teams. Its CLI scans a React or Vue repository, web components included, and records every component the code uses, where it's used and with which props. The dashboard collects those scans from all your repos, so you can see adoption at a glance, plan migrations and track each one until it's done.

## Features

- **Adoption across repos**: see which repos use each component, and on which version.
- **Every usage**: open a component to see each file and line that uses it, and the props passed.
- **Migrations and retirements**: mark a package or component as replaced or retired, and track each repo until it moves off.
- **History**: Scout keeps a scan for each commit, so charts show how adoption changes over time.
- **Scans from CI**: upload a fresh scan on every merge, so the dashboard stays current.

## Get started

Install the CLI in the repo you want to scan (Node 24 or later):

```bash
npm i -D @scoutui/cli
npx scout init
npx scout scan --dry-run
```

The dry run writes `scout-scan.json` next to the config without uploading it. [Scan your first repo](https://scoutui.dev/docs/tutorials/scan-your-first-repo) walks through the result.

To share scans with your team, [deploy the dashboard](https://scoutui.dev/docs/guides/deploy-the-dashboard) on Kubernetes with the [Helm chart](charts/scout), then [upload scans from CI](https://scoutui.dev/docs/guides/run-in-ci). To try the dashboard first, [run it locally](https://scoutui.dev/docs/guides/run-the-dashboard-locally).

## Contributing

Bug reports, ideas and fixes are welcome in [GitHub Issues](https://github.com/scoutui/scout/issues), and questions in [GitHub Discussions](https://github.com/scoutui/scout/discussions). The [contributing guide](CONTRIBUTING.md) explains how to set up the repository. To report a security issue, follow [SECURITY.md](SECURITY.md).

## License

Scout is open-source software under the [MIT License](LICENSE).
