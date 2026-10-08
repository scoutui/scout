---
description: "Upgrade the Scout dashboard and the CLI, and fix a scan refused because the CLI is newer or older than the dashboard."
sidebar_label: "Upgrade Scout"
---

# Upgrade Scout

Upgrade the dashboard first, then the CLI in each repo. A CLI that gets ahead of the dashboard can have its scans refused until the dashboard catches up.

## Upgrade the dashboard

Follow the upgrade steps for how you deployed it:

- with the Helm chart: [Deploy the dashboard → Upgrade](/docs/guides/deploy-the-dashboard#upgrade)
- with your own chart: [Deploy with your own chart → Upgrade](/docs/guides/deploy-with-your-own-chart#upgrade)

## Upgrade the CLI in a repo

Upgrade `@scoutui/cli` like any other dev dependency:

```bash
npm install --save-dev @scoutui/cli@latest
# or: yarn add -D @scoutui/cli@latest
# or: pnpm add -D @scoutui/cli@latest
```

Commit the change and merge it into the [branch the dashboard tracks](/docs/reference/config).

In a terminal, Scout tells you when a newer version is available. When your dashboard can't read the new version's scans yet, it tells you to wait instead: see [If the CLI is newer or older than the dashboard](#version-messages).

## If the CLI is newer or older than the dashboard {#version-messages}

| Message starts with | Fix |
| --- | --- |
| `Error: Couldn't upload the scan: this CLI is newer than the dashboard.` | Ask whoever runs your dashboard to upgrade it. Until then, run the version the message names, for example `npx @scoutui/cli@0.2.4 scan`, or install that version in the repo so every upload keeps working. |
| `Scout <version> is available, but your dashboard can't read its scans yet.` | Keep the CLI you have. Ask whoever runs your dashboard to [upgrade it](#upgrade-the-dashboard), then [upgrade the CLI](#upgrade-the-cli-in-a-repo). |
| `Error: Couldn't upload the scan: this CLI is too old for the dashboard.` | [Upgrade the CLI](#upgrade-the-cli-in-a-repo). Until your upgrade is merged, run the version the message names, for example `npx @scoutui/cli@0.2.4 scan`. |

`scout auth login` is refused the same way, with a message that starts `Error: Couldn't sign in:`. Use the same fixes with `auth login` in place of `scan`, for example `npx @scoutui/cli@0.2.4 auth login`.
