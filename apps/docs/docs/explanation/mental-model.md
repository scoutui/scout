---
description: "What a Scout scan counts as a component: every component it sees gets an entry, there are three kinds matched across repos in different ways, and packages must be installed for their components to be found."
sidebar_label: "How components are found"
---

# How components are found

A scan reads your repo's React and Vue files and records every component it sees in use. This page explains what counts as one component, the three kinds of component and how each is matched across repos, and why the scan needs your dependencies installed.

## Every component the scan sees gets an entry

The scan doesn't start from a list of components it expects to find. It reads each file, and every component tag it meets gets an entry: `Button` from `@acme/ui`, an old `LegacyButton` nobody documents any more, a `Card` your team wrote last week. [Framework support](/docs/reference/framework-support) lists what counts as a component tag in each framework.

A component your repo defines also gets an entry when nothing uses it, as long as its own code uses another component, such as a page component that only your framework's router loads. One that is neither used nor uses any other component is left out.

The scan doesn't know which packages make up your design system. It records every package the same way, and you pick out the ones that matter with [tags](/docs/reference/glossary#tag) in the dashboard.

## Three kinds of component

Every component is one of three kinds. For an imported component, the scan works out which from where the import points:

- **[From a package](/docs/reference/glossary#from-a-package):** the import leads to an installed package, such as `import { Button } from "@acme/ui"`.
- **[Defined in the repo](/docs/reference/glossary#defined-in-the-repo):** the import leads to a file in the repo, such as `import { Card } from "./Card"`. A component from another workspace package in the same monorepo is defined in the repo too: it is still your repo's code.
- **[Web component](/docs/reference/glossary#web-component):** a tag with a hyphen, such as `<acme-button>`, which nothing imports. A registration in your code or a package's Custom Elements Manifest decides which repo or package it belongs to. Otherwise it has no package. [Framework support](/docs/reference/framework-support#web-components) gives the order.

A [Custom Elements Manifest](/docs/reference/glossary#custom-elements-manifest) only tells the scan which package a tag belongs to. To ship one with your package, see [Link web components to your package](/docs/guides/link-web-components-to-your-package).

No config field labels a component one way or the other. If your repo uses path aliases, the scan needs them to follow imports: see [Resolve imports in a monorepo](/docs/guides/resolve-imports-in-a-monorepo).

### Why it matters across repos

Each kind is matched across repos in its own way:

- **From a package: matched by package and name.** `Button` from `@acme/ui` is the same component in `storefront` and `checkout`, so the dashboard can add their usage together and show every repo that uses it. The package entry point counts too: `Button` imported from `@acme/ui/button` is a separate component from `Button` imported from `@acme/ui`.
- **Defined in the repo: matched by repo and file.** A `Card` in `storefront` and a `Card` in `checkout` are two components, even when the files look alike. They are separate code and can change separately.
- **Web component: matched by tag name.** `<acme-button>` is the same component in every repo that uses it. Which package or repo it belongs to is worked out again in each scan.

## Why dependencies must be installed

To tell which component an import names, the scan follows the import into the installed package, and reads the package's version from there too. So install your dependencies before you scan.

When a package your `package.json` declares isn't installed, the scan can't tie its uses to a component. Each use becomes an [unresolved occurrence](/docs/reference/glossary#unresolved-occurrence), and none of that package's components get an entry. The scan's summary says so:

```text
Scout couldn't match 4 more occurrences to a component. See https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences
4 of them are from packages that aren't installed.
```

Until the packages in `dependencies` and `devDependencies` are installed, `scout scan` stops before it scans. A dry run (`scout scan --dry-run`) scans anyway and prints the summary above.

Unresolved occurrences stay in the JSON with the reason for each, but the dashboard leaves them out of every count. An import of a file that doesn't exist, or a component name that nothing imports, is unresolved too. When a component you expect is missing, see [Troubleshoot a scan](/docs/guides/troubleshoot-a-scan).

## One entry per component, one per place it is used

A scan records usage at two levels of detail:

- **One entry per component**, with the totals: how many places use it, in how many files, and which values each prop was given.
- **One entry per [occurrence](/docs/reference/glossary#occurrence)**, the place in the code where the component is used: the file, the line, and the props written there.

The totals answer "how much is this used, and how?". The occurrences answer "where do I go to change it?". A component's page in the dashboard shows both: the totals, and the files and calls. In the JSON they are the `components` and `occurrences` arrays; the [artifact reference](/docs/reference/artifact) lists their fields.

A compound component such as `<Dialog.Popup>` gets its own entry, named `Dialog.Popup`, separate from `Dialog`. When `Dialog` is defined in your repo and `Popup` points at a component declared elsewhere in your code, such as `Popup: DialogPopup`, the entry is `DialogPopup` instead.

The [glossary](/docs/reference/glossary) defines the other terms used on this page.
