---
description: "Install the Scout CLI in a repo that uses a design system, run a first scan, and read the components it found in the JSON file it writes."
sidebar_label: "Scan your first repo"
---

# Scan your first repo

In this tutorial we'll install the Scout CLI in a repo that uses a design system, run our first scan, and read what it found. By the end we'll have a file, `scout-scan.json`, that lists every component our repo uses and every place it uses one.

## Before we start

- **Node.js 24 or later.**
- **A git repository with at least one commit** that uses components from a design-system package, in React or Vue. Web components such as `<acme-button>` count in either. The scan reads the commit and branch from git.

We'll follow along with a small React repo called `storefront`; on our own repo the steps are the same, only the names and numbers change. It uses `Button` and `Card` from a design-system package, `@acme/ui`, and an older `LegacyButton` from `@acme/ui-legacy`. Its `package.json` lists both packages under `dependencies`, and besides that and a `tsconfig.json`, it has three source files. The app renders a product card and a button:

```tsx title="src/App.tsx"
import { Button } from "@acme/ui";
import { ProductCard } from "./components/ProductCard";

export function App() {
  return (
    <main>
      <ProductCard title="Trail shoes" />
      <Button variant="secondary">View all</Button>
    </main>
  );
}
```

`ProductCard` is defined in the repo and builds on `Card` and `Button`:

```tsx title="src/components/ProductCard.tsx"
import { Button, Card } from "@acme/ui";

export function ProductCard({ title }: { title: string }) {
  return (
    <Card>
      <h2>{title}</h2>
      <Button variant="primary">Add to cart</Button>
    </Card>
  );
}
```

The checkout page still uses the old button:

```tsx title="src/pages/Checkout.tsx"
import { LegacyButton } from "@acme/ui-legacy";

export function Checkout() {
  return <LegacyButton size="large">Pay now</LegacyButton>;
}
```

## Step 1: Install dependencies and the CLI

The scan finds a package's components by following each import into the installed package, so the repo's dependencies must be installed. In the root of our repo, we install them and add the CLI as a dev dependency:

```bash
npm install
npm install --save-dev @scoutui/cli
```

With Yarn, we'd run `yarn install` and `yarn add -D @scoutui/cli`. Yarn 2 and later need one setting changed first: see [Switch Yarn off Plug'n'Play](/docs/guides/install#2-switch-yarn-off-plugnplay).

We check that it works with `npx scout --version`, which prints the installed version, for example `0.1.0`.

:::warning
If the repo's dependencies aren't installed, the scan can't find any component from `@acme/ui` or `@acme/ui-legacy`. The scan we run in step 3 still finishes, but its summary says it couldn't match those uses, with a yellow line saying why:

```
Scanned 3 files in 0.1s: 3 components, 1 occurrence.
Scout couldn't match 4 more occurrences to a component. See https://scoutui.dev/docs/guides/troubleshoot-a-scan#unresolved-occurrences
4 of them are from packages that aren't installed.
```

`Button`, `Card` and `LegacyButton` are then missing from the results, and `scan` refuses to upload. [Dependencies aren't installed](/docs/guides/troubleshoot-a-scan#dependencies-arent-installed) shows the fix.
:::

## Step 2: Create a config

The scan reads its settings from `scout.config.json`. We create one with `init`:

```bash
npx scout init -y --framework react
```

`-y` accepts the defaults instead of asking questions, and `--framework react` tells it which file types to include. A Vue repo passes `--framework vue` instead, and a repo with both passes the flag twice.

`init` prints:

```
Wrote /home/dev/storefront/scout.config.json. Run scout scan to scan the repo and upload the scan.
```

The file it wrote looks like this:

```json title="scout.config.json"
{
  "$schema": "https://unpkg.com/@scoutui/cli/schema/config.schema.json",
  "repoId": "acme/storefront",
  "branch": "main",
  "include": ["src/**/*.{js,jsx,ts,tsx}"],
  "exclude": ["**/*.{test,spec,stories}.*", "**/node_modules/**"]
}
```

- `repoId` is the name the scan is recorded under, taken from the owner and name in our git remote, `git@github.com:acme/storefront.git`.
- `branch` is the branch a dashboard tracks when we upload scans to it, taken from our remote's default branch.
- `include` says which files to read: every JavaScript and TypeScript file under `src/`. If our own repo keeps its code somewhere else, we change it before moving on.
- `exclude` skips tests, stories and `node_modules`. The [config reference](/docs/reference/config) lists every field.

## Step 3: Run the scan

A plain `scout scan` uploads to a dashboard, and we don't have one yet. So we add `--dry-run`, which scans without uploading and writes the result to a file:

```bash
npx scout scan --dry-run
```

When it finishes, we see:

```
Path aliases: tsconfig.json
Scanned 3 files in 0.1s: 6 components, 5 occurrences.

Most used:
  Button        @acme/ui                        2
  ProductCard   src/components/ProductCard.tsx  1
  Card          @acme/ui                        1
  LegacyButton  @acme/ui-legacy                 1

Wrote scout-scan.json (not uploaded).
```

:::note
A repo without a `tsconfig.json` prints `Path aliases: no tsconfig.json found.` instead, with how to name one that has another name. The scan still runs; it just can't follow import aliases such as `@/components`.
:::

The summary's first line says the scan read our three files and found six components. Three come from packages: `Button`, `Card` and `LegacyButton`. The other three, `App`, `ProductCard` and `Checkout`, are defined in the repo.

It also counted five [occurrences](/docs/reference/glossary#occurrence), places in the code where a component is used, and tied each one to a component. A use it can't tie to a component is an [unresolved occurrence](/docs/reference/glossary#unresolved-occurrence). When there are any, the summary counts them on a second line, `Scout couldn't match … more occurrences to a component.` Ours has none, so that line isn't there.

`Most used` lists up to five components by their occurrences, with where each comes from: its package, or the file that defines it in our repo. `Button` has two occurrences, one in `App` and one in `ProductCard`. `App` and `Checkout` aren't listed because nothing in the repo uses them.

The last line says the scan wrote `scout-scan.json` and didn't upload it.

## Step 4: Read the results

The scan wrote `scout-scan.json` next to the config. It has four top-level keys. Here it is with the two long lists folded away:

```json title="scout-scan.json"
{
  "meta": {
    "schemaVersion": 2,
    "scannerName": "@scoutui/cli",
    "scannerVersion": "0.1.0",
    "scanId": "01M3HYCCGXM3ZVZGCKM9A4PZ80",
    "scannedAt": "2026-09-27T17:25:09.251Z",
    "repo": {
      "id": "acme/storefront",
      "gitRemote": "git@github.com:acme/storefront.git",
      "commit": "8676019952a756dacb00ed21a406485f6cd83492",
      "committedAt": "2026-09-24T14:00:00.000Z",
      "initialCommit": "8676019952a756dacb00ed21a406485f6cd83492",
      "branch": "main"
    }
  },
  "components": [ ... ],
  "occurrences": [ ... ],
  "diagnostics": []
}
```

`meta` records which repo, commit and branch this scan came from, and which CLI version wrote it. `diagnostics` lists anything the scan saw but couldn't follow; ours is empty. `components` has one entry per component. We find the one for `Button`:

```json
{
  "id": "143bee555932e50c",
  "identity": {
    "kind": "package-export",
    "packageName": "@acme/ui", "publicEntry": "", "exportName": "Button"
  },
  "framework": "react",
  "stats": { "occurrenceCount": 2, "fileCount": 2 },
  "usage": "direct",
  "props": {
    "variant": {
      "values": [
        { "provenance": "written", "value": "secondary", "count": 1 },
        { "provenance": "written", "value": "primary", "count": 1 }
      ],
      "dynamic": 0, "omitted": 0
    }
  },
  "version": "4.2.0",
  "composition": {
    "rendersByCount": {},
    "renderedByCount": { "0a12a8f48dc0e818": 1, "98464c541cecabae": 1 },
    "isRootCount": 0, "isLeafCount": 2
  }
}
```

- `identity` says `Button` is a `package-export`: it comes from `@acme/ui`, imported from the package root, so `publicEntry` is empty. Components defined in our repo have `"kind": "repository-declaration"` and a `filePath` instead.
- `stats` says it is used twice, across two files, and `props` counts each value passed to `variant`. `version` is the installed version of `@acme/ui`.
- `composition.renderedByCount` lists the components that render `Button` by their `id`: `0a12a8f48dc0e818` is `App` and `98464c541cecabae` is `ProductCard`.

`occurrences` has one entry per place a component is used. We find the `Button` inside `ProductCard`:

```json
{
  "occurrenceId": "c23610a099090c05",
  "resolution": { "status": "resolved", "componentId": "143bee555932e50c" },
  "filePath": "src/components/ProductCard.tsx",
  "line": 7, "column": 6,
  "credit": { "kind": "render" },
  "trace": [
    { "kind": "import", "specifier": "@acme/ui", "name": "Button" }
  ],
  "props": { "variant": { "tier": "written", "value": "primary" } },
  "ownerComponentId": "98464c541cecabae",
  "depth": 1
}
```

- `resolution` says the scan tied this use to a component, and its `componentId` matches the `id` of the `Button` entry above.
- `filePath`, `line` and `column` point at the spot in `ProductCard.tsx`, and `props` shows the value written there.
- `credit` and `trace` say how the scan got there: this line renders `Button`, which the file imports from `@acme/ui`.
- `ownerComponentId` is the `id` of the component whose code contains this line: `ProductCard`.

We've run a real scan and followed one component from its summary to the line where it is used.

## Next

To upload this scan and read it in the dashboard, continue with [Explore the dashboard](/docs/tutorials/explore-the-dashboard). To set the scan up for your own repo's layout, see [Configure a scan](/docs/guides/configure-a-scan), and to scan on every push, see [Run a scan and upload in CI](/docs/guides/run-in-ci). The [artifact reference](/docs/reference/artifact) describes every field in the file, and [How components are found](/docs/explanation/mental-model) explains what the scan counts as a component.
