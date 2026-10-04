---
description: "Every diagnostic code a Scout scan reports: severity, fields, what it means, what to do, and how it prints in the terminal."
sidebar_label: "Diagnostics"
---

# Diagnostics reference

A *diagnostic* is a note the scan records when it sees something it can't fully follow, such as a component that arrives as a prop. The scan prints its warnings to the terminal at the end of the run ([the rest with `--debug`](#terminal-output)) and writes every diagnostic to the scan file's [`diagnostics[]`](/docs/reference/artifact#diagnostics) array.

A use whose import points at a missing file, whose package isn't installed, or whose name nothing imports isn't a diagnostic. The scan keeps it in `occurrences[]` as an [unmatched use](/docs/reference/artifact#unresolved-occurrences), with the reason.

On a dry run ([`scout scan --dry-run`](/docs/reference/cli#scan)), a scan with diagnostics still writes the scan file and exits `0`.

To work out why a component is missing from your results, start with [Troubleshoot a scan](/docs/guides/troubleshoot-a-scan). This page lists every code.

## Fields

Every diagnostic has these two fields, plus the fields listed under its code:

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | string | One of the codes below. |
| `severity` | `"warning"` or `"info"` | `warning`: something you can usually fix, or a shape the scan doesn't support. `info`: a render the scan couldn't tie to a component, usually with nothing to fix. |

Every code except `dependency-not-installed` also has `filePath`, the file the diagnostic is about, relative to the repository root.

`line` and `column` start at 1, the same as in [`occurrences[]`](/docs/reference/artifact#occurrences).

## Codes at a glance

| `code` | Severity | Reported when |
| --- | --- | --- |
| [`dependency-not-installed`](#dependency-not-installed) | `warning` | A package your `package.json` declares isn't installed, and your code uses its components. |
| [`late-bound-render`](#late-bound-render) | `info` | A tag renders a component that arrives as a prop, a parameter or the result of a hook from a package. |
| [`unresolved-reference`](#unresolved-reference) | `info` | A tag names something the scan can't follow to a component, for any other reason. |
| [`lazy-import-unsupported`](#lazy-import-unsupported) | `warning` | A component loaded with `import()` is written in a shape the scan can't follow. |
| [`auto-import-manifest-missing`](#auto-import-manifest-missing) | `warning` | A Nuxt app has no generated components file. |
| [`auto-import-stale-entry`](#auto-import-stale-entry) | `warning` | The list of auto-imported components names a file that no longer exists. |
| [`cycle-detected`](#cycle-detected) | `warning` | A package's re-exports loop back on themselves. |
| [`chain-too-deep`](#chain-too-deep) | `warning` | A package's re-exports pass through more than 32 files. |

## Dependency code

### `dependency-not-installed`

**Severity:** `warning`

A package that a `package.json` in the repo declares isn't installed, so the scan can't find its components. Every use of them is [unmatched](/docs/reference/artifact#unresolved-occurrences), with the reason `package-not-installed`. The scan reports one diagnostic per package, and only for a package it found in use.

| Field | Type | Meaning |
| --- | --- | --- |
| `packageName` | string | The package that isn't installed. |
| `occurrenceCount` | number | How many uses of its components the scan couldn't tie to them. |
| `declaredIn` | string | The `package.json` that declares the package, relative to the repository root. `""` when the scan can't tell. |

This code has no `filePath`.

```text
Warning: @acme/ui is listed in package.json but isn't installed, so 3 uses of it aren't matched to a component. Install your dependencies and scan again.
```

**What to do:** install the repo's dependencies with your package manager, then scan again. Until every package in `dependencies` and `devDependencies` is installed, `scan` stops before it scans:

```text
Error: Couldn't upload the scan: @acme/ui is listed in package.json but isn't installed. Install your dependencies and try again.
```

A package listed only in `peerDependencies` or `optionalDependencies` doesn't stop it: the scan uploads with that package's uses unmatched.

## Render codes

A *render* is one JSX tag that names a component, such as `<Button>` or `<Card.Header>`. When the tag's name is bound to something the scan can't follow to a component, the render isn't counted as a [use](/docs/reference/glossary#use) and reports one of these codes instead, unless it is one of the [renders that report nothing](#renders-that-report-nothing).

### `late-bound-render`

**Severity:** `info`

The tag renders a value the component receives, such as a prop, a function parameter, a member read off one (`<slots.Empty />`) or the result of a hook from a package, so the scan can't tell which component it is. The render isn't counted for any component.

```tsx title="src/components/Row.tsx"
export function Row({ Icon }) {
  return <Icon />; // late-bound-render: Icon
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `line`, `column` | number | Where the tag is. |
| `symbol` | string | The tag's name up to the first dot. |
| `memberChain` | array of strings | The rest of the tag's name. `<slots.Empty>` is `"slots"` and `["Empty"]`. |

**What to do:** nothing; no config change affects this. [Troubleshoot a scan](/docs/guides/troubleshoot-a-scan) shows how to list these renders.

### `unresolved-reference`

**Severity:** `info`

The tag's name is imported or declared, but the scan can't follow it to a component. Common causes:

- The name holds the result of a function call (`const Tag = pickTag();`).
- The name reads a member assigned inside a function, such as `Card.Header = Header;` in a setup function rather than where `Card` is declared.
- The import names something the file doesn't export, such as a misspelled name.
- The import points at a file that isn't code, such as `./logo.svg`.
- The name reaches the component through `export * from` a file the scan didn't read: one your [`include`](/docs/reference/config#fields) patterns don't match, one `exclude` matches, or one that failed to parse.
- The import passes through re-exports in your own code that loop back on themselves.

| Field | Type | Meaning |
| --- | --- | --- |
| `line`, `column` | number | Where the tag is. |
| `symbol` | string | The tag's name up to the first dot. |
| `memberChain` | array of strings | The rest of the tag's name. `<Card.Header>` is `"Card"` and `["Header"]`. |

**What to do:** check the tag at `line` and `column` against the causes above. Fix a misspelled import in your code. The one you can fix from config is a file the scan didn't read: widen `include` or narrow `exclude`, then scan again.

### `lazy-import-unsupported`

**Severity:** `warning`

The component is loaded with `import()`, for example through `React.lazy` or `next/dynamic`, in a shape the scan can't turn into a component. A common cause is a `.then` callback that does more than pick one export. The component is missing from the results at this tag.

| Field | Type | Meaning |
| --- | --- | --- |
| `line`, `column` | number | Where the tag is. |
| `specifier` | string | The path passed to `import()`. |
| `detail` | string | Why the scan gave up. |

```text
Warning: src/App.tsx:24:6: couldn't tell which component import('./Panel') loads, so this use isn't counted.
```

**What to do:** where you can, reduce the `.then` callback to a single export pick, such as `.then((m) => ({ default: m.Panel }))`.

## Auto-import codes

### `auto-import-manifest-missing`

**Severity:** `warning`

The `package.json` next to the config lists `nuxt`, but Nuxt's generated components file, `.nuxt/components.d.ts` (Nuxt 3) or `.nuxt/types/components.d.ts` (Nuxt 4), doesn't exist. Without it the scan can't find auto-imported components. A tag that uses one, such as `<AppHeader />`, is an [unmatched use](/docs/reference/artifact#unresolved-occurrences) with the reason `unbound-name`. A kebab-case tag such as `<app-header />` is counted instead as a [web component](/docs/reference/glossary#web-component) with no package.

| Field | Type | Meaning |
| --- | --- | --- |
| `filePath` | string | The generated file the scan expected. |
| `detail` | string | What's missing and how to fix it. |

```text
Warning: This Nuxt app hasn't been prepared, so auto-imported components aren't counted. Run npx nuxt prepare and scan again.
```

**What to do:** run `nuxt prepare` (or any Nuxt `dev` or `build` command), then scan again. Until then, `scan` refuses to upload:

```text
Error: Couldn't upload the scan: this Nuxt app hasn't been prepared. Run npx nuxt prepare and try again.
```

### `auto-import-stale-entry`

**Severity:** `warning`

The list of auto-imported components, which Nuxt or `unplugin-vue-components` writes, names a component whose file no longer exists. The scan ignores that entry, so tags that use the component aren't tied to it, the same as for [`auto-import-manifest-missing`](#auto-import-manifest-missing).

| Field | Type | Meaning |
| --- | --- | --- |
| `filePath` | string | The components file the entry was read from. |
| `componentName` | string | The component name the entry declares. |
| `target` | string | The missing file, relative to the repository root. |

```text
Warning: /home/dev/checkout/.nuxt/components.d.ts lists PromoBanner at components/PromoBanner.vue, which no longer exists. Regenerate that file (for Nuxt, run npx nuxt prepare) and scan again.
```

**What to do:** regenerate the file, then scan again. In a Nuxt app, run `nuxt prepare`. With `unplugin-vue-components`, build the app, for example with `vite build`: a build rewrites the file, while the dev server only adds to it.

## Package re-export codes

These two describe files inside an installed package, not your code. While following the package's re-exports (`export * from "./widgets.js"`) to the file that defines a component, the scan gave up. Every use of that component is [unmatched](/docs/reference/artifact#unresolved-occurrences), with the reason `chain-bailed` and the same code.

For both codes, `filePath` is the package file, such as `node_modules/@acme/ui/index.js`.

### `cycle-detected`

**Severity:** `warning`

The re-exports came back to a file and export the scan had already visited, so it stopped.

| Field | Type | Meaning |
| --- | --- | --- |
| `exportName` | string | The export being followed when the loop closed. |
| `packageName` | string, optional | The package that holds `filePath`. |

```text
Warning: The re-exports of Widget in node_modules/@acme/loop/index.js loop back on themselves, so its uses aren't matched to a component.
```

**What to do:** nothing to fix in your repo. If the package is yours, remove the loop from its re-exports.

### `chain-too-deep`

**Severity:** `warning`

The re-exports passed through more than 32 files without reaching the file that defines the component, so the scan stopped.

| Field | Type | Meaning |
| --- | --- | --- |
| `exportName` | string | The export being followed. |
| `depth` | number | The limit reached. Always `32`. |
| `packageName` | string, optional | The package that holds `filePath`. |

```text
Warning: Stopped following the re-exports of StarIcon after 32 files (at node_modules/@acme/icons/d32.js), so its uses aren't matched to a component.
```

**What to do:** nothing to fix in your repo. If the package is yours, shorten its re-export chain.

## Renders that report nothing

These tags aren't counted as uses and report no diagnostic:

- A plain HTML or namespaced JSX tag, such as `<div>` or `<svg:rect>`.
- A JSX tag bound to a string, such as `const Tag = as ?? "span";` then `<Tag>`.
- A React context used as a provider or consumer, such as `<ThemeContext.Provider>`.
- A Vue built-in tag, such as `<Transition>`.
- A Vue template tag whose script binds it to something the scan can't follow to a component, such as the result of a call (`const Panel = pickPanel();`).

## Terminal output

At the end of a scan, before the summary, the scan prints each `warning` to stderr on its own line, starting `Warning:`. `dependency-not-installed` lines come last. The terminal lines don't show the codes; the scan file does.

```text
Warning: src/App.tsx:24:6: couldn't tell which component import('./Panel') loads, so this use isn't counted.
```

[`--quiet`](/docs/reference/cli#scan) turns off these lines. The scan file still lists every diagnostic. `auto-import-manifest-missing` prints once, as the scan starts, so it shows even with `--quiet`.

The `info` codes print only with [`--debug`](/docs/reference/cli#global-flags): one line per code, with a count. The individual entries are only in the scan file.

```text
1 component passed in as a prop or argument wasn't counted.
5 renders couldn't be followed to a component and weren't counted as uses.
```

The scan file records each diagnostic once. `cycle-detected` and `chain-too-deep` appear once per package file and export, however many of your files import the component.
