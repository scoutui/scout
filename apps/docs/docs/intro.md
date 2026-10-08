---
description: "What Scout does, what it reads, and where to start depending on whether you read the dashboard, scan repos, or run the dashboard for your team."
sidebar_label: Overview
slug: /overview
---

# Scout

Scout shows how design-system components are used across your codebase. The CLI scans one repository and uploads a JSON file that lists every component the repo uses and every place it uses it. The dashboard, which you host yourself, collects those scans so your team can compare usage across repos and follow it over time.

For example, the dashboard can show that `storefront` and `checkout` both use `Button` from `@acme/ui`, which version of the package each is on, and the file and line of every `Button` in `storefront`.

The CLI reads React and Vue. Web components such as `<acme-button>` are counted in both. [Framework support](/docs/reference/framework-support) lists what it reads in each.

Install the repo's dependencies before you scan: components from a package that isn't installed aren't found. [How components are found](/docs/explanation/mental-model) explains what happens when they aren't.

## Start here

### I read the dashboard

- [Explore the dashboard](/docs/tutorials/explore-the-dashboard): a guided first look at scanned repos in the dashboard.
- [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used): which repos use a component, and the files and lines in each.
- [Tags](/docs/guides/dashboard/tag-your-libraries): group packages into libraries so you can filter and compare them.
- [Migrations and retirements](/docs/guides/dashboard/track-a-migration): record that a component is replaced or removed, and follow each repo until no one uses it.
- [Reading the numbers](/docs/explanation/dashboard/reading-the-numbers): what the counts, shares and migration progress mean.

### I scan repos

- [Scan your first repo](/docs/tutorials/scan-your-first-repo): install the CLI, run a scan and read the result.
- [Install the CLI](/docs/guides/install): add the CLI to a repo and check that it runs.
- [Run a scan and upload in CI](/docs/guides/run-in-ci): scan from GitHub Actions and send each result to the dashboard.
- [Troubleshoot a scan](/docs/guides/troubleshoot-a-scan): fix a scan that fails or misses components.
- [CLI reference](/docs/reference/cli): every command, flag, exit code and environment variable.

### I run the dashboard for my team

- [Run the dashboard locally](/docs/guides/run-the-dashboard-locally): try it on your own machine with Postgres and a built-in dev sign-in.
- [Deploy the dashboard](/docs/guides/deploy-the-dashboard): host it for your team on Kubernetes with the Helm chart, an OIDC identity provider and Postgres.
- [How the CLI and the dashboard fit together](/docs/explanation/cli-and-dashboard): what happens to a scan after it is uploaded.
