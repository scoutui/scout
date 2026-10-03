---
description: "What the words Scout uses mean, in the dashboard and in the scan's JSON: component, use, scan, tag, lifecycle record and more."
sidebar_label: Glossary
---

# Glossary

The words Scout uses on screen and in a scan's JSON. The examples use invented names.

## Component

One distinct thing your code uses: a component [from a package](#from-a-package) such as `Button` from `@acme/ui`, a `Card` your repo [defines itself](#defined-in-the-repo), or a [web component](#web-component) such as `<acme-button>`.

You see components in the **Components** table on each repo page and package page, and in the `components` array of the JSON. See [Find where a component is used](/docs/guides/dashboard/find-where-a-component-is-used).

## Use {#use}

One place in the code where a component appears, usually one tag such as `<Button>`. If the `storefront` repo uses `Button` in 40 places across 12 files, that is 1 component, 40 uses and 12 files.

Most tables sort by **Uses**, and every chart counts them. A component's page lists them file by file, each with its line. The JSON calls them occurrences and keeps them in its `occurrences` array. See [Reading the numbers](/docs/explanation/dashboard/reading-the-numbers#components-uses-and-files).

## Unmatched use {#unmatched-use}

A place where the scan saw a component used but couldn't tell which component it is. The usual cause is a package that is declared in `package.json` but not installed. A use is unmatched too when its import points at a file that doesn't exist, or when nothing imports its name, such as `<Widget />` on its own.

The scan's summary counts them, as in `Scout couldn't match 4 more uses to a component.`, and the JSON keeps each one with its reason and the status `"unresolved"`. The dashboard leaves them out of every count. See [Troubleshoot a scan](/docs/guides/troubleshoot-a-scan).

## Scan

One run of `scout scan` over one repo at one commit. The dashboard keeps each uploaded scan in the repo's history, one scan per commit: a scan of a commit it already has is skipped, unless you scan with `--rescan` or the dashboard couldn't prepare the stored scan: then it replaces that commit's scan. Most pages show each repo's *latest scan*: the scan of its newest commit by commit date.

A repo page's **scan** button and its **Scan history** list the older scans. See [Look at an older scan](/docs/guides/dashboard/repos#look-at-an-older-scan).

## Artifact

The JSON file that holds one scan. `scout scan` sends it to the dashboard, and `scout scan --dry-run` writes it to `scout-scan.json` next to the config instead, so you can read it on its own with `jq` or your own scripts.

The [Scan artifact reference](/docs/reference/artifact) lists every field in it.

## Repo id

The name a scan is recorded under, such as `storefront`. It comes from `--repo-id` or the config's `repoId`, and otherwise from your git remote: `git@github.com:acme/storefront.git` gives `storefront`. Every scan with the same repo id joins one repo's history in the dashboard, so keep it the same from run to run. The dashboard ties a repo id to the git remote of the first scan uploaded under it, and refuses scans under it from a different remote.

It heads the repo page and is `meta.repo.id` in the JSON. [Repo identity](/docs/reference/config#repo-identity) gives the full order.

## From a package

A component imported from an installed package, such as `Button` from `@acme/ui`. It is the same component in every repo, so `Button` used in `storefront` and `checkout` counts as one component across both. The import path is part of it: `Button` from `@acme/ui` and `Button` from `@acme/ui/button` are two components. A web component is from a package too, when the package's [Custom Elements Manifest](#custom-elements-manifest) declares it or your code registers a class imported from it.

The **Origin** filter on a repo page calls it **External**. In the JSON its `identity.kind` is `"package-export"`. See the [artifact reference](/docs/reference/artifact).

## Defined in the repo

A component whose code lives in the scanned repo, such as `Card` in `src/components/Card.tsx`, including one in another workspace package of the same monorepo. A `Card` in `storefront` and a `Card` in `checkout` are two different components, even when their files look alike.

A web component that your repo defines and registers, with `customElements.define()` or `@customElement()`, counts as local too.

The **Origin** filter calls it **Local**. In the JSON its `identity.kind` is `"repository-declaration"`.

## Web component

A tag with a hyphen in its name, such as `<acme-button>`, in React JSX or a Vue template. The scan counts it as a component even though nothing imports it. It belongs to your repo when your code defines and registers it, or to a package when your code registers a class imported from that package or the package's [Custom Elements Manifest](#custom-elements-manifest) declares the tag. Otherwise it has no package. Either way, a tag is one component across every repo that uses it.

The **Framework** filter splits web components in two: **Web component** when a manifest or your code defines the tag, and **Tag** when nothing does. In the JSON its `identity.kind` is `"tag"`.

## Version

The version of a component's package that was installed when the scan ran, such as `4.2.0`. It is read from the installed package, not from the version range in your `package.json`. Components defined in the repo, and web components that belong to no package, have no version, and the dashboard shows a dash or **unversioned** in its place.

You see it in the **Version** columns and the version bar on a package page. See [Packages](/docs/guides/dashboard/packages).

## Custom Elements Manifest

A `custom-elements.json` file that a package of web components ships to list them. The scan reads it only to learn which package a tag such as `<acme-button>` belongs to, and only when the package's `package.json` points at it with a `customElements` field. Nothing else in it, such as descriptions, props or deprecations, reaches the scan or the dashboard.

See [Link web components to your package](/docs/guides/link-web-components-to-your-package).

## Tag

A name you give a set of packages in the dashboard, such as `acme-ui` for `@acme/ui` and `acme-ui-legacy` for `@acme/ui-legacy`. It matches package names by exact names, or by glob patterns such as `@acme/icons*`. Tags let you filter by library and compare libraries in charts. They are not the same as the **Tag** value of the **Framework** filter, which marks a [web component](#web-component) that nothing defines.

You create tags in the **Tags** section of the **governance** page. See [Tags](/docs/guides/dashboard/tag-your-libraries).

## Lifecycle record

An entry on the **governance** page that says a package or component is superseded by something else, or retired. For example: `LegacyButton` from `@acme/ui-legacy` is superseded by `Button` from `@acme/ui`. A record applies to every repo at once, including scans already uploaded, so no rescan is needed.

A superseded record tracks a [migration](#migration) and a retired one a [retirement](#retirement). See [Migrations and retirements](/docs/guides/dashboard/track-a-migration).

## Deprecated

A component a lifecycle record covers: a record on the component itself, on the component it belongs to (a record on `Card` covers `Card.Header`), or on its whole package. Only records count. A record covers a web component only when the scan links the tag to the record's package, so ship a [Custom Elements Manifest](#custom-elements-manifest) for your tags.

Deprecated components carry a warning icon, and the **deprecated** chip and **Deprecated** columns count them. See [Where "deprecated" comes from](/docs/explanation/dashboard/reading-the-numbers#where-deprecated-comes-from).

## Migration

The move from a superseded package or component to its successor, tracked by a lifecycle record. Its progress reads **N% migrated**: the successor's uses as a share of both sides together. With 30 uses of `LegacyButton` and 90 of `Button`, it reads **75% migrated**.

You see migrations under **Migrations** on the **charts** page and under **Migrations in this repo** on a repo's **Adoption** tab. See [Migrations and retirements](/docs/guides/dashboard/track-a-migration).

## Retirement

The removal of a package or component that has no replacement, tracked by a retired lifecycle record, for example retiring `Modal` from `@acme/ui-legacy`. With no successor to compare against, its progress reads **N remaining**: the uses that remain. Its record reads **None left** on the **governance** page once no repo's latest scan uses it.

You see retirements under **Retirements** on the **charts** page and under **Retirements in this repo** on a repo's **Adoption** tab. See [Migrations and retirements](/docs/guides/dashboard/track-a-migration#record-a-retirement).
