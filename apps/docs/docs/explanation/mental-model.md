---
description: "What a Scout scan counts as a component: the two kinds and how each is matched across repos, and why packages must be installed for their components to be found."
sidebar_label: "How components are found"
---

# How components are found

A scan reads your repo's React and Vue files and records every component it sees in use. [Framework support](/docs/reference/framework-support) lists what counts as a component in each framework. This page explains the two kinds of component and how each is matched across repos, and why the scan needs your dependencies installed.

## What gets an entry

A component your repo defines also gets an entry when nothing uses it, as long as its own code uses another component, such as a page component that only your framework's router loads.

The scan doesn't know which packages make up your design system. It records every package the same way, and you pick out the ones that matter with [tags](/docs/reference/glossary#tag) in the dashboard.

## Two kinds of component

Every component is one of two kinds:

- **[External](/docs/reference/glossary#external):** it comes from an installed package, such as `import { Button } from "@acme/ui"`.
- **[Local](/docs/reference/glossary#local):** your repo defines it, such as `import { Card } from "./Card"`. A component from another workspace package in the same monorepo is local too: it is still your repo's code.

A [web component](/docs/reference/glossary#web-component) such as `<acme-button>` is one of these two. Nothing imports a tag, so Scout tells which repo or package it belongs to from where it's registered or declared: it's local when your repo registers it, and external when it comes from a package, or when nothing defines it. To link your package's tags to it, see [Link web components to your package](/docs/guides/link-web-components-to-your-package).

If your repo uses path aliases, the scan needs them to follow imports: see [Resolve imports in a monorepo](/docs/guides/resolve-imports-in-a-monorepo).

### Matching across repos

Each kind is matched across repos in its own way:

- **External: matched by package and name.** `Button` from `@acme/ui` is the same component in `storefront` and `checkout`, so the dashboard can add their usage together and show every repo that uses it. The package entry point counts too: `Button` imported from `@acme/ui/button` is a separate component from `Button` imported from `@acme/ui`.
- **Local: matched by repo and file.** A `Card` in `storefront` and a `Card` in `checkout` are two components, even when the files look alike.
- **Web components: matched by tag name.** `<acme-button>` is the same component in every repo that uses it.

## Install dependencies before you scan

Install your dependencies before you scan. When a package your `package.json` declares isn't installed, the scan can't tie its uses to a component. They are recorded as [unmatched uses](/docs/reference/glossary#unmatched-use), and none of that package's components get an entry. The scan's summary says so:

```text
Scout couldn't match 4 more uses to a component. See https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences
4 of them are from packages that aren't installed.
```

Until the packages in `dependencies` and `devDependencies` are installed, `scout scan` stops before it scans. A dry run (`scout scan --dry-run`) scans anyway and prints the summary above.

Unmatched uses stay in the JSON with the reason for each, but the dashboard leaves them out of every count. A use is unmatched too when its import points at a file that doesn't exist, or when nothing imports its name. When a component you expect is missing, see [Troubleshoot a scan](/docs/guides/troubleshoot-a-scan).

## One entry per component, one per place it is used

A scan records usage at two levels of detail:

- **One entry per component**, with the totals: how many places use it, in how many files, and which values each prop was given.
- **One entry per [use](/docs/reference/glossary#use)**, the place in the code where the component is used: the file, the line, and the props written there.

The totals answer "how much is this used, and how?". The uses answer "where do I go to change it?". A component's page in the dashboard shows both. In the JSON they are the `components` and `occurrences` arrays; the [scan file reference](/docs/reference/artifact) lists their fields.

A compound component such as `<Dialog.Popup>` gets its own entry, named `Dialog.Popup`, separate from `Dialog`.

The [glossary](/docs/reference/glossary) defines the other terms used on this page.
