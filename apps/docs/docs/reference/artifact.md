---
description: "Every field in the JSON file scout scan uploads and scout scan --dry-run writes: meta, components, occurrences and diagnostics."
sidebar_label: "Scan artifact"
---

# Scan artifact reference

Every scan is one JSON file, the [artifact](/docs/reference/glossary#artifact). [`scout scan --dry-run`](/docs/reference/cli#scan) writes it to `scout-scan.json` next to the config; an upload sends it to the dashboard without writing it. This page lists every field in it.

## Top-level shape {#top-level-shape}

The file is one JSON object with four keys, written in this order:

| Key | Type | Contents |
| --- | --- | --- |
| `meta` | object | Which repo and commit was scanned, when, by which CLI version, and what the scan covered. See [`meta`](#meta). |
| `components` | array | One entry per component. See [`components[]`](#components). |
| `occurrences` | array | One entry per place a component is used, including places the scan couldn't tie to a component. See [`occurrences[]`](#occurrences). |
| `diagnostics` | array | Things the scan saw but couldn't follow. See [`diagnostics[]`](#diagnostics). |

Most questions are answered from `components` and `occurrences`. A resolved occurrence names its component by the component's `id`.

:::note
A newer CLI can add values to some lists: `credit.kind`, a `trace` step's `kind`, an unresolved occurrence's `reason.kind` and `reason.code`, and the `confidence`, `strongestClass`, `reason`, `source`, `strength` and `disposition` values in a tag's `attribution`. If you read the file with your own scripts, skip values you don't recognise. The other lists of values in `components[]` and `occurrences[]` change only with a new `meta.schemaVersion`.
:::

## Paths {#paths}

Every path in the file is relative to the repository root and uses `/` separators, except a few diagnostic fields that the [diagnostics reference](/docs/reference/diagnostics) notes. The root is the top-level folder of the git work tree, or the folder given to [`--repo-root`](/docs/reference/cli#scan). Scanning from a subdirectory gives the same paths as scanning from the root.

## `components[]` {#components}

One entry per [component](/docs/reference/glossary#component). A component appears when the scan finds at least one place it is used. A component defined in the repo also appears when its own code uses a component, even if nothing renders it, such as the `App` at the top of the tree.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | 16-character id computed from `identity`. The same identity gets the same `id` in every scan, so you can match a component across scans. Occurrences and `composition` refer to components by this value. |
| `identity` | object | What the component is and where it comes from. See [Component identity](#component-identity). |
| `framework` | `"react" \| "vue"` \| absent | The framework the component is written in. Absent on web components. |
| `stats.occurrenceCount` | `number` | Number of resolved occurrences of this component, including those where it is passed to a call (see [`credit`](#credit)). |
| `stats.fileCount` | `number` | Number of distinct files those occurrences are in. |
| `usage` | `"direct" \| "root" \| "none"` | Why the component is listed. See [`usage`](#usage). |
| `props` | object | For each prop name, how often each value was passed. See [Prop value counts](#component-props). |
| `composition` | object | Which components this one renders and is rendered by. Present on every entry. See [`composition`](#composition). |
| `version` | `string \| null` | Installed [version](/docs/reference/glossary#version) of the component's package, read from its `package.json` in `node_modules`: the package of a package export, or the package a tag belongs to. `null` for components defined in the repo, for tags with no package, and when no version is found. |

These fields are less often needed:

| Field | Type | Description |
| --- | --- | --- |
| `attribution` | object \| absent | Tags only: which package or repo file defines the web component. See [`attribution`](#attribution). |
| `events` | object \| absent | Event name to `{ "boundCount": number }`, the number of occurrences that bind it: Vue listeners such as `@click`, and React props named `on` plus a capital letter, such as `onClick`. Absent when no occurrence binds an event. |
| `writtenNames` | `string[]` \| absent | The other names files render the component under: every distinct [`writtenName`](#occurrences) of its occurrences, most used first. Absent when none has one. |
| `declared` | object \| absent | Components defined in the repo only: the props the component's own code declares. See [`declared`](#declared). |
| `definition` | `{ line, column }` \| absent | React components defined in the repo only: where the declaration starts in `identity.filePath`. `line` counts from 1 and `column` from 0. |
| `owningPackage` | `string` \| absent | Components defined in the repo only: the name of the package the file belongs to. That is the deepest workspace package whose folder holds the file, else the [root package](#root-package). Absent when the file is outside the root package's folder. |

```json title="A components[] entry"
{
  "id": "143bee555932e50c",
  "identity": { "kind": "package-export", "packageName": "@acme/ui", "publicEntry": "", "exportName": "Button" },
  "framework": "react",
  "stats": { "occurrenceCount": 2, "fileCount": 2 },
  "usage": "direct",
  "props": {
    "variant": {
      "values": [
        { "provenance": "written", "value": "secondary", "count": 1 },
        { "provenance": "written", "value": "primary", "count": 1 }
      ],
      "dynamic": 0,
      "omitted": 0
    }
  },
  "version": "4.2.0",
  "composition": {
    "rendersByCount": {},
    "renderedByCount": { "0a12a8f48dc0e818": 1, "98464c541cecabae": 1 },
    "isRootCount": 0,
    "isLeafCount": 2
  }
}
```

### Component identity {#component-identity}

`identity.kind` says which of three shapes the identity has. Every field of the identity goes into `id`.

| `kind` | Fields | What it is |
| --- | --- | --- |
| `package-export` | `packageName`, `publicEntry`, `exportName` | A component imported from an installed package, such as `Button` from `@acme/ui`. See [From a package](/docs/reference/glossary#from-a-package). |
| `repository-declaration` | `repoId`, `filePath`, `exportName` | A component defined in the scanned repo, including one in another workspace package of the same repo. See [Defined in the repo](/docs/reference/glossary#defined-in-the-repo). |
| `tag` | `tagName` | A [web component](/docs/reference/glossary#web-component), such as `<acme-badge>`, whichever package or file defines it. Any tag with a hyphen in its name that nothing imports counts, so a Vue component registered globally at runtime, such as vue-i18n's `<i18n-t>`, is a tag too. The few SVG and MathML elements with a hyphen, such as `<font-face>`, are not. |

| Field | In | Description |
| --- | --- | --- |
| `packageName` | `package-export` | The package that defines the component. |
| `publicEntry` | `package-export` | The package entry the component was reached through: the path after the package name, without a file extension, such as `react` for `@acme/ui/react`. `""` for the package root. |
| `exportName` | `package-export`, `repository-declaration` | The component's name. For a package export, the name the package exports it under, `default` for a default export. For a component defined in the repo, its declared name, `default` when a default export has no name. A name with a dot, such as `Dialog.Popup`, is a member of an exported object: the part before the first dot is the export, the rest is the member. |
| `repoId` | `repository-declaration` | Same value as `meta.repo.id`. The same file scanned under two repo ids gives two components. |
| `filePath` | `repository-declaration` | The file the component is defined in. |
| `tagName` | `tag` | The tag name, lowercased: `<Acme-Badge>` gives `acme-badge`. |

When you import a component through a package that re-exports it from another package, `packageName` and `publicEntry` name the package that defines it and the entry the re-exports lead into, not the package in your import.

```json title="identity examples"
{ "kind": "package-export", "packageName": "@acme/ui", "publicEntry": "", "exportName": "Button" }

{ "kind": "repository-declaration", "repoId": "storefront", "filePath": "src/components/ProductCard.tsx", "exportName": "ProductCard" }

{ "kind": "tag", "tagName": "acme-badge" }
```

### `attribution` {#attribution}

Tags only. Which package or repo file defines the web component, decided from the evidence this scan found. The same tag can be attributed differently in two repos.

Evidence is *observed* when the scanned repo registers the element itself, and *declared* when a manifest or a type declaration claims it. Observed evidence outranks declared.

| `status` | Other fields | Meaning |
| --- | --- | --- |
| `"resolved"` | `target`, `confidence`, `evidence` | One target won. `confidence` is `"observed"` or `"declared"`: the kind of evidence that decided it. |
| `"unknown"` | `reason`, `evidence` | No target. `reason` is `"absent"` when the scan found no evidence, or `"unresolved"` when it found evidence that names no target. |
| `"conflict"` | `strongestClass`, `candidates`, `evidence` | Several targets tie in the strongest kind of evidence, `strongestClass` (`"observed"` or `"declared"`). `candidates` lists them. |

A target, in `target` or `candidates`, is one of:

- `{ "kind": "package", "packageName": string }`
- `{ "kind": "repository", "repoId": string, "filePath": string, "exportName": string }`

Each entry in `evidence` is one record:

| Field | Type | Description |
| --- | --- | --- |
| `source` | `"registration" \| "cem" \| "global-declaration"` | `registration`: a `customElements.define()` call or `@customElement()` decorator in the scanned repo. `cem`: the [Custom Elements Manifest](/docs/reference/glossary#custom-elements-manifest) of an installed package, when the package's `package.json` points at it with a `customElements` field. `global-declaration`: an entry keyed by a hyphenated name, such as `'acme-panel'`, in the `GlobalComponents` declarations of the [list of auto-imports](/docs/reference/framework-support#vue) the scan reads, such as Nuxt's `.nuxt/components.d.ts`. |
| `strength` | `"observed" \| "declared"` | `observed` for a registration, `declared` for the other two sources. |
| `locator` | `{ filePath, line }` or `{ packageName, version }` | Where the evidence is: a file and line for a registration or a global declaration, or the package and its installed version (`null` when unknown) for a manifest. |
| `target` | target \| absent | What the record points at. Absent when it names nothing the scan can find, such as a registration whose class isn't found. |
| `disposition` | `"supports" \| "candidate" \| "contradicts" \| "unresolved"` | How the record relates to the outcome: it names the resolved target (`supports`), one of a conflict's candidates (`candidate`), a target the outcome didn't pick (`contradicts`), or no target (`unresolved`). |

```json title="attribution for <acme-badge>"
{
  "status": "resolved",
  "target": { "kind": "package", "packageName": "@acme/elements" },
  "confidence": "declared",
  "evidence": [
    {
      "source": "cem",
      "strength": "declared",
      "locator": { "packageName": "@acme/elements", "version": "1.0.0" },
      "target": { "kind": "package", "packageName": "@acme/elements" },
      "disposition": "supports"
    }
  ]
}
```

### `usage` {#usage}

Every component has exactly one value. The first row that applies wins.

| Value | When |
| --- | --- |
| `direct` | The component has at least one resolved occurrence. |
| `root` | A component defined in the repo, with no resolved occurrences, that is the default export of a framework entry file: `{page,layout,template,error,loading,not-found}.{tsx,jsx}` anywhere under an `app/` folder, or any `.tsx` or `.jsx` file under a `pages/` folder except `pages/api/`. The folders can be at any depth, such as `src/app/`. |
| `none` | Anything else, such as a component defined in the repo that renders others but that nothing renders. |

### Prop value counts {#component-props}

`props` has one key per prop name passed at any of the component's resolved occurrences. Each value is:

| Field | Type | Description |
| --- | --- | --- |
| `values` | array | One entry per distinct value, most frequent first. See the value shapes below. |
| `dynamic` | `number` | Occurrences where the value is an expression the scan doesn't read, such as a function call or an arrow function. |
| `omitted` | `number` | Occurrences that don't pass the prop. |
| `other` | `number` \| absent | Occurrences whose value isn't in `values` because the prop has more than 100 distinct values. `values` keeps the 100 most frequent. Absent at 100 distinct values or fewer. |
| `truncated` | `number` \| absent | How many distinct values were left out of `values`. Absent at 100 distinct values or fewer. |

For every prop, the counts in `values` plus `dynamic`, `other` and `omitted` add up to `stats.occurrenceCount`.

| `values[]` entry | Meaning |
| --- | --- |
| `{ "provenance": "written", "value": ..., "count": n }` | A literal string, number, boolean or `null`. A prop written with no value, such as `disabled`, counts as `true`. |
| `{ "provenance": "written", "valueSet": [...], "count": n }` | React only. A condition that picks between literals, such as `sale ? "primary" : "secondary"`. `valueSet` holds the literals, sorted. |
| `{ "provenance": "reference", "ref": "...", "count": n }` | A variable or a dotted path, such as `label` or `theme.icon`, recorded by name. The scan doesn't look up its value. |

### `declared` {#declared}

The props a component defined in the repo declares in its own code. Read from a destructured first parameter in React (`function ProductCard({ title, size = "md" })`) and from `defineProps` in Vue. Absent when the props can't be read that way.

| Field | Type | Description |
| --- | --- | --- |
| `props` | object | Prop name to `{ type, required, default }`, in source order. Each field is present only when the code states it. `type`: Vue only, such as `"number"` or `"String"`. `required`: `false` for a destructured React prop with a default; in Vue, from `?` in a type or `required:` in a props object. `default`: set when the default is a literal. |
| `hasRest` | `boolean` | `true` when the component collects the remaining props (`...rest`) or declares an index signature. |

```json title="declared for a React ProductCard component"
{ "props": { "title": {}, "size": { "required": false, "default": "md" } }, "hasRest": false }
```

### `composition` {#composition}

Which components this one renders and which render it. Component A *renders* component B when a place B is used sits inside A's own code, so A is that occurrence's `ownerComponentId`. Only resolved occurrences count. [Composition: renders and rendered by](/docs/explanation/composition-and-ownership) explains how this is worked out.

| Field | Type | Description |
| --- | --- | --- |
| `rendersByCount` | `Record<string, number>` | Component `id` of each component this one renders, to how many times it renders it. |
| `renderedByCount` | `Record<string, number>` | Component `id` of each component that renders this one, to how many times it does. |
| `isRootCount` | `number` | Occurrences of this component that no component renders, such as a use outside any component. |
| `isLeafCount` | `number` | Equal to `stats.occurrenceCount` when `rendersByCount` is empty, otherwise `0`. |

Keys are `components[].id` values. Look them up in `components[]` to get names. Only ids that are in `components[]` appear.

## `occurrences[]` {#occurrences}

One entry per [occurrence](/docs/reference/glossary#occurrence): a place in the code that uses a component, usually one tag. A tag inside a helper function that several components call gets one occurrence per calling component. The array also holds [unresolved occurrences](#unresolved-occurrences), places where the scan saw a component used but couldn't tell which one.

| Field | Type | Description |
| --- | --- | --- |
| `occurrenceId` | `string` | 16-character id computed from what the occurrence names, its position and its owner. Unique within the artifact. |
| `resolution` | object | Which component this is, or why the scan couldn't tell. See [`resolution`](#resolution). |
| `filePath` | `string` | The file the use is in. |
| `usedIn` | `string` \| absent | The name of the package the file belongs to: the deepest package in [`meta.scope.packages`](#meta) whose folder holds it. Present only when `meta.scope.packages` has more than one entry. |
| `line` | `number` | Line of the use, counted from 1. |
| `column` | `number` | Column of the use: counted from 0 in React files and from 1 in Vue files. |
| `credit` | object | Whether the component is rendered here or passed to a call. See [`credit`](#credit). |
| `trace` | array | The steps between this use and the component, such as an import or a wrapper. See [`trace`](#trace). |
| `writtenName` | `string` \| absent | The name this file renders the component under, with any member path, such as `SettingsHeader` after `import SettingsHeader from "./Header"`, or `Filters.FilterBar`. Present only on a resolved occurrence, and only when the name differs from the component's own `exportName`, or `tagName` for a tag. A difference in letter case or hyphens alone doesn't count. A package's default export has no name of its own, so it always has one. |
| `props` | object | The value passed for each prop here. See [Prop values at one place](#occurrence-props). |
| `events` | `string[]` \| absent | Vue event listeners bound here, such as `remove` for `@remove`. React handlers stay in `props`. Absent when none are bound. |
| `ownerComponentId` | `string` \| absent | The `components[].id` of the component whose code contains this use. Absent outside any component. |

```json title="An occurrences[] entry"
{
  "occurrenceId": "c23610a099090c05",
  "resolution": { "status": "resolved", "componentId": "143bee555932e50c" },
  "filePath": "src/components/ProductCard.tsx",
  "line": 7,
  "column": 6,
  "credit": { "kind": "render" },
  "trace": [{ "kind": "import", "specifier": "@acme/ui", "name": "Button" }],
  "props": { "variant": { "tier": "written", "value": "primary" } },
  "ownerComponentId": "98464c541cecabae"
}
```

### `resolution` {#resolution}

| `status` | Other fields | Meaning |
| --- | --- | --- |
| `"resolved"` | `componentId` | The `components[].id` of the component used. |
| `"unresolved"` | `reason` | The scan couldn't tell which component this is. See [Unresolved occurrences](#unresolved-occurrences). |

### Unresolved occurrences {#unresolved-occurrences}

An [unresolved occurrence](/docs/reference/glossary#unresolved-occurrence) is a place where the scan saw a component used but couldn't tie it to one. It has no `componentId`, and nothing in `components[]` stands for it. It keeps its file, position, `credit`, `trace`, `props` and owner, but doesn't count toward any component's `stats`, `props` or `composition`. When the use came through an import, `trace` keeps that import as written, so it shows which import failed. The scan summary counts unresolved occurrences, as in `Scout couldn't match 4 more occurrences to a component.`

`reason.kind` says why:

| `reason.kind` | Other fields | Meaning |
| --- | --- | --- |
| `package-not-installed` | `packageName` | The import names a package that a `package.json` declares, either the importing file's workspace package or the workspace root, but the package isn't installed. Each such package also gets a [`dependency-not-installed`](/docs/reference/diagnostics#dependency-not-installed) diagnostic. A package in `dependencies` or `devDependencies` that isn't installed stops `scan` before it scans, unless it's a dry run. One listed only in `peerDependencies` or `optionalDependencies` doesn't: the scan uploads with these occurrences unresolved. |
| `module-not-found` | none | The import can't be followed: a path to a missing file, a path to a file outside the scanned folder (outside the monorepo, when the folder is part of one), an alias your config or `tsconfig.json` doesn't define, or a package that no `package.json` declares and that isn't installed. |
| `unbound-name` | `name` | Nothing in the file imports or declares the name, such as `<Widget />` with no import. In a Vue template it also covers a tag whose import lacks the name, such as `<Menu.Item>` when the imported `Menu` has no `Item`. |
| `chain-bailed` | `code` | Following a package's re-exports to the file that defines the component looped back on itself (`"cycle-detected"`) or passed through more than 32 files (`"chain-too-deep"`). The same problem is reported as a [diagnostic](/docs/reference/diagnostics#package-re-export-codes). |

```json title="An unresolved occurrence: @acme/ui is declared but not installed"
{
  "occurrenceId": "742a11f2ccdeec08",
  "resolution": {
    "status": "unresolved",
    "reason": { "kind": "package-not-installed", "packageName": "@acme/ui" }
  },
  "filePath": "src/App.tsx",
  "line": 8,
  "column": 6,
  "credit": { "kind": "render" },
  "trace": [{ "kind": "import", "specifier": "@acme/ui", "name": "Button" }],
  "props": { "variant": { "tier": "written", "value": "secondary" } },
  "ownerComponentId": "0a12a8f48dc0e818"
}
```

When a component you expect is missing, see [Troubleshoot a scan](/docs/guides/troubleshoot-a-scan).

### `credit` {#credit}

| `kind` | Other fields | Meaning |
| --- | --- | --- |
| `"render"` | none | The component is rendered here: a JSX element or a Vue template tag. |
| `"argument"` | `callee`, `index` | The component is passed to a call instead of rendered, such as `makeControl(Input)` or `useModal(ConfirmDialog)`. `callee` names the function and `index` is the argument position, from `0`. These occurrences have no props. |

A component rendered through a wrapper, such as `const Save = memo(Button)` then `<Save />`, is a `render` of `Button` with a `hoc` step in its trace.

### `trace` {#trace}

The steps between the use and the component, outermost first. A plain import has one `import` step. The list is empty when nothing needs explaining, such as a component defined in the same file.

| `kind` | Other fields | Step |
| --- | --- | --- |
| `import` | `specifier`, `name` | An import the use goes through: the import path and the imported name as written (`default` for a default import, `*` for a namespace import). |
| `tag` | `written` | A web component whose tag is written with capitals, such as `Acme-Badge`. `identity.tagName` holds the lowercased name. |
| `hoc` | `callee` | A function that wraps the component and returns a new one, such as `memo`, `forwardRef` or `connect`. |
| `lazy` | `callee` | A lazy-loading wrapper, such as `lazy(() => import("./Checkout"))` or Next.js `dynamic`. |
| `dynamic-map` | `mapName`, `mapLoc: { file, line, column }` | The component is picked from an object of components, such as `icons[kind]`. Every component in the object gets an occurrence. `mapLoc` is where the object is defined. |
| `helper-call` | `callee`, `calleeFile` | The element is inside a function that isn't a component, such as a helper that returns JSX. The element gets one occurrence per component that calls the helper. |
| `prop-forward` | `bindingName`, `constructionSite: { file, line, column }` | The element is created outside any component, such as `const badge = <Icon />`, and used inside one. `constructionSite` is where it is created. |

The `column` in `mapLoc` and `constructionSite` counts from 0.

```json title="trace for a Checkout component loaded with lazy()"
[
  { "kind": "lazy", "callee": "lazy" },
  { "kind": "import", "specifier": "./Checkout", "name": "default" }
]
```

### Prop values at one place {#occurrence-props}

`props` has one key per prop passed. A prop that isn't passed has no key.

| Value | Meaning |
| --- | --- |
| `{ "tier": "written", "value": ... }` | A literal string, number, boolean or `null`. A prop written with no value counts as `true`. |
| `{ "tier": "written", "valueSet": [...] }` | React only. A condition that picks between literals, such as `sale ? "primary" : "secondary"`. |
| `{ "tier": "reference", "ref": "..." }` | A variable or dotted path, recorded by name, such as `label` or `theme.icon`. |
| `{ "tier": "dynamic" }` | Any other expression. React props named `on` plus a capital letter are always `dynamic`. |

A spread such as `{...rest}` in React or `v-bind="obj"` in Vue is recorded as a prop named `...rest` with `{ "tier": "dynamic" }`.

## `meta` {#meta}

| Field | Type | Description |
| --- | --- | --- |
| `schemaVersion` | `number` | Version of the file format: `2`. |
| `scannerName` | `string` | Package name of the CLI that wrote the file: `@scoutui/cli`. The dashboard refuses a scan without it. |
| `scannerVersion` | `string` | Version of the CLI that wrote the file. |
| `scanId` | `string` | ULID, new for every scan. |
| `scannedAt` | `string` | When the scan ran, as an ISO 8601 UTC timestamp. The dashboard dates a scan by `repo.committedAt`, not by this field. |
| `repo.id` | `string` | The [repo id](/docs/reference/glossary#repo-id). [Repo identity](/docs/reference/config#repo-identity) says how it's chosen. |
| `repo.gitRemote` | `string \| null` | URL of the remote: the one `git config scout.remote` names, else `upstream` when there is one, else the only remote, else `origin`. It's the URL `git remote get-url` gives, so `url.<base>.insteadOf` rewrites apply, with an SSH host alias replaced by the host name `ssh -G` gives for it. When that host name is a subdomain of the host as written, as with GitHub's, GitLab's and Bitbucket's port-443 endpoints (`Host github.com` with `HostName ssh.github.com`), the host is kept as written. Any `user:password@` in an `https://` URL is left out. `null` when there is none. |
| `repo.commit` | `string` | SHA of the checked-out commit. The dashboard keeps one scan per repo id and commit: it skips a scan of a commit it already has, unless the scan is uploaded with [`--rescan`](/docs/reference/cli#scan) or the dashboard couldn't prepare the stored scan: then it replaces it. |
| `repo.committedAt` | `string` | Committer date of that commit, as an ISO 8601 UTC timestamp. |
| `repo.branchPosition` | `number` (optional) | In an uploaded scan: how many commits the tracked branch's first-parent history has up to and including `repo.commit`. The dashboard uses it to order scans of commits with the same date. Absent on a dry run. |
| `repo.initialCommit` | `string \| null` | SHA of the first commit in the history. `null` in a shallow clone, so [fetch full history](/docs/guides/run-in-ci#fetch-full-history) in CI. |
| `repo.branch` | `string \| null` | In an uploaded scan, the branch the dashboard tracks. On a dry run, the checked-out branch, `null` on a detached HEAD. |
| `scope.folder` | `string` | The config folder. `""` when it is the repository root. |
| `scope.include` | `string[]` \| absent | The config's [`include`](/docs/reference/config#common-fields). Absent when the config has none, so the scan read every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file below the config folder. |
| `scope.exclude` | `string[]` | The config's `exclude`, `[]` when it has none. |
| `scope.packages` | array of `{ name, folder }` | Each package that holds a scanned file, sorted by `folder`: workspace packages, and the [root package](#root-package) when a scanned file is outside every workspace package. `folder` is `""` for a package at the repository root. |

```json title="meta"
{
  "schemaVersion": 2,
  "scannerName": "@scoutui/cli",
  "scannerVersion": "0.1.0",
  "scanId": "01M3HSR732T792S6G1PCAVYKXQ",
  "scannedAt": "2026-09-27T16:04:14.021Z",
  "repo": {
    "id": "storefront",
    "gitRemote": "git@github.com:acme/storefront.git",
    "commit": "8676019952a756dacb00ed21a406485f6cd83492",
    "committedAt": "2026-09-24T14:00:00.000Z",
    "initialCommit": "8676019952a756dacb00ed21a406485f6cd83492",
    "branch": "main"
  },
  "scope": {
    "folder": "",
    "exclude": ["apps/playground"],
    "packages": [
      { "name": "storefront", "folder": "" },
      { "name": "@acme/web", "folder": "apps/web" },
      { "name": "@acme/ui", "folder": "packages/ui" }
    ]
  }
}
```

### Root package {#root-package}

The *root package* is the package in the config folder, or at the monorepo root when `scan` prints `Monorepo root:`. Its name is the `name` in that folder's `package.json`, or the [repo id](/docs/reference/glossary#repo-id) when there is none. A file below that folder that is in no workspace package belongs to the root package, so in a repo that isn't a monorepo, every scanned file does.

## `diagnostics[]` {#diagnostics}

Things the scan saw but couldn't follow, such as a component passed in as a prop, or a package whose re-exports loop. A use the scan couldn't tie to a component because of a missing file, an uninstalled package or a name nothing imports isn't a diagnostic: it is an [unresolved occurrence](#unresolved-occurrences).

| Field | Type | Description |
| --- | --- | --- |
| `code` | `string` | What the scan saw. The [diagnostics reference](/docs/reference/diagnostics) lists every code. |
| `severity` | `"warning" \| "info"` | `warning`: something you can usually fix, or a shape the scan doesn't support. `info`: a render the scan couldn't tie to a component, usually with nothing to fix. |
| `filePath` | `string` \| absent | The file the diagnostic is about. Absent on `dependency-not-installed`, which names the `package.json` in `declaredIn` instead. |
| other fields | | Depend on the code. The [diagnostics reference](/docs/reference/diagnostics) lists them. |

```json title="A diagnostics[] entry"
{ "code": "dependency-not-installed", "severity": "warning", "packageName": "@acme/ui", "occurrenceCount": 3, "declaredIn": "package.json" }
```
