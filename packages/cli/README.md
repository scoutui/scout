# @scoutui/cli

The CLI for [Scout](https://scoutui.dev), the design-system adoption dashboard.

It scans a React or Vue repository, web components included, and records every component the code uses, where it's used and with which props. `scout scan` uploads that scan to a [Scout dashboard](https://scoutui.dev/docs/tutorials/explore-the-dashboard), where you compare repos, track migrations and follow adoption over time.

## Get started

You need Node 24 or later. Install the repo's dependencies first: the scan reads your files without running or building them, and follows imports into `node_modules` to find where each component comes from. Yarn projects need `nodeLinker: node-modules`.

```bash
npm i -D @scoutui/cli
npx scout init
npx scout scan --dry-run
```

`init` writes `scout.config.json`, and `scan --dry-run` writes `scout-scan.json` next to it without uploading. [Scan your first repo](https://scoutui.dev/docs/tutorials/scan-your-first-repo) explains the result.

## Upload to a dashboard

Sign in once, then scan. `scout scan` checks that the dashboard can take the scan, then uploads it:

```bash
npx scout auth login --host https://scout.example.com
npx scout scan
```

In CI, use an upload token instead. See [Run a scan and upload in CI](https://scoutui.dev/docs/guides/run-in-ci).

## Commands

| Command | What it does |
| --- | --- |
| `scout init` | Creates `scout.config.json` for the repo |
| `scout scan` | Scans the repo and uploads the scan to the dashboard; `--dry-run` writes it to `scout-scan.json` instead |
| `scout backfill` | Scans past commits on the tracked branch, one per week, and uploads them |
| `scout auth login`, `status`, `logout` | Signs in to a dashboard, shows the sign-in, or ends it |

The [CLI reference](https://scoutui.dev/docs/reference/cli) lists every flag, exit code and environment variable, and the [config reference](https://scoutui.dev/docs/reference/config) every field in `scout.config.json`.

## Links

- [Documentation](https://scoutui.dev/docs/overview)
- [Troubleshoot a scan](https://scoutui.dev/docs/guides/troubleshoot-a-scan)
- [Report a bug](https://github.com/scoutui/scout/issues)

The package includes a [CycloneDX](https://cyclonedx.org/) software bill of materials at `dist/sbom.cdx.json`.
