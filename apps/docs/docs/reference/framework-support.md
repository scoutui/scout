---
description: "What a Scout scan reads in React, Vue and Angular files: which files, how React, Vue, Angular and web components are recognised, whether renders and rendered by are tracked, and the known gaps."
sidebar_label: "Framework support"
---

# Framework support reference

A scan reads React, Vue and Angular. This page lists, for each, which files are read, how a [component](/docs/reference/glossary#component) is recognised, what else is recorded, and what is not found. [Web components](#web-components) such as `<acme-button>` are counted in all three. A file is only read when your config's `include` patterns match it, or when the config has no `include`; see [Config reference](/docs/reference/config).

HTML files and Lit templates are not read.

## At a glance

| | React | Vue | Angular |
| --- | --- | --- | --- |
| Files | `.tsx`, `.jsx`, `.ts`, `.js`, `.mts`, `.mjs`, `.cts`, `.cjs` | `.vue` | `.ts` component classes, and the `.html` a `templateUrl` points at |
| What is read | JSX anywhere in the file | The `<template>` and `<script>` blocks | Each `@Component` class and its template, inline or via `templateUrl` |
| Components found | Imported or locally defined components used as JSX tags, and web components | Imported components, auto-imported components, and web components | `@Component` classes matched to template elements and attribute selectors, and web components |
| Prop values | Yes | Yes | Yes |
| Events | Props named `on` plus a capital letter, such as `onClick`, unless their value is written, as in `onLabel="On"` | `@name`, `v-on:name`, and props bound with a name like `:onClick`, unless their value is written | `(name)` output bindings |
| Renders and rendered by | Yes | Yes | Yes |

Files with any other extension, such as `.html` or `.svelte`, are skipped even when `include` matches them.

*Renders and rendered by* is what the dashboard's **Composition** tab shows and what `composition` holds in the [scan file](/docs/reference/artifact#composition): which components a component's own code renders, and which components render it. [Composition](/docs/explanation/composition-and-ownership) explains it.

## React

**Recognised:** a JSX tag with a capital letter or a dot, such as `<Button>` or `<Card.Header>`, that names an imported component or one defined in the repo. Components reached through `lazy()`, through wrappers such as `memo()` and `forwardRef()`, or through an object of components are found too, and so are components passed to a function, such as `makeControl(Input)`. In the JSON, each use's [`trace`](/docs/reference/artifact#trace) records how it was reached. A lowercase tag such as `<div>` is ignored unless it is a [web component](#web-components).

**Renders and rendered by:** each use counts for the component whose code contains it, so a `ProductCard` that renders a `Button` shows up on both. A file that defines several components records each one separately.

**Known gaps:**

- A tag that renders a component received as a prop, a function parameter or the result of a hook from a package is not counted. The scan reports [`late-bound-render`](/docs/reference/diagnostics#late-bound-render).

## Vue

**Recognised:** each `.vue` file is itself a component, named by the `name` in `defineOptions()` or `export default`, or else by its file name (`line-item.vue` is `LineItem`). In its template:

- A tag that matches a script import, written either way (`<LineItem>` or `<line-item>`), is that component.
- A tag that matches an auto-imported component is that component. The list of auto-imports is the first of these files, in the folder that holds your config, that lists any:
  - `.nuxt/components.d.ts` or `.nuxt/types/components.d.ts`, which Nuxt writes. Run `nuxt prepare` before scanning so they exist.
  - `components.d.ts` or `src/components.d.ts`, which `unplugin-vue-components` writes. Its resolvers list library components there too, so with Element Plus's resolver `<el-button>` is Element Plus's `ElButton`.

  A `GlobalComponents` declaration you write yourself at one of these paths is read the same way.
- Any other tag with a hyphen, such as `<acme-button>`, is counted as a [web component](#web-components).
- Vue's built-in tags, such as `<Transition>` and `<component>`, are ignored, and so are plain HTML tags such as `<div>`.

**Renders and rendered by:** every tag in a file's template counts for that file's component, however deeply it is nested.

**Known gaps:**

- Components registered globally and missing from the list of auto-imports, for example with `app.component()`, are not matched to their definition. Written with a capital letter (`<PromoBanner>`), the tag is an [unmatched use](/docs/reference/glossary#unmatched-use). Written with a hyphen (`<promo-banner>`), it is counted as a web component with no package, which the dashboard's **Type** filter shows as **Undefined element**. Import the component in the file's script to have it matched.
- A list of auto-imports at any other path is not read, for example when `unplugin-vue-components`'s `dts` option writes it to `types/components.d.ts`. Set `dts` to `true` or `src/components.d.ts` to have it read.
- A component the file's own script declares, such as `const LazyPanel = defineAsyncComponent(() => import("./Panel.vue"))`, is not counted, written either way (`<LazyPanel>` or `<lazy-panel>`). Declare it in a file of its own and import it to have it matched. A component registered in `components:` under a name other than its import's isn't counted either.

## Angular

Requires `@angular/compiler` installed in the repo being scanned: Scout uses that repo's own copy, not a bundled one, so a scan sees exactly what your own build does. Without it installed, Angular files are skipped and the scan reports why. Supported from Angular 19 on.

**Recognised:** a class decorated with `@Component`, matched against a template element or attribute selector such as `<app-button>` or `button[app-icon-button]`. A component is in scope for a standalone component's template (the default from Angular 19 on) when it's listed in that component's `imports`; for a non-standalone component, through an `NgModule`'s `declarations` and `exports`. Both inline templates and a `templateUrl` file are read, whichever API a component's inputs and outputs use: `@Input()`/`@Output()` decorators, or the `input()`/`output()`/`model()` signal functions — `model()`'s matching `<name>Change` output included. An element that matches more than one component in scope isn't counted: the scan reports why.

**Renders and rendered by:** each use counts for the component whose template contains it, found inside `@if`/`@for`/`@switch`/`@case`/`@defer` (and its `@placeholder`/`@loading`/`@error`) blocks the same as directly in the template, and inside content projected into another component (`<ng-content>`).

**Known gaps:**

- Directives and pipes aren't counted as components.
- A component created in code rather than written in a template — a route's `loadComponent`, or `ViewContainerRef.createComponent()` — isn't counted.
- Host bindings and `hostDirectives` aren't read.

- A component from an installed library is matched only when the library is installed and ships Angular's compiled typings, which every library built with the Angular CLI does. Scout reads its components, inputs and outputs from those typings, so `<mat-card>` and `<button mat-button>` count as Angular Material's `MatCard` and `MatButton`. A library's directives, such as `<mat-error>`, aren't counted, and aren't counted as web components either. When several of a library's entry points export the same component, a use is credited to the entry point your file imports from.

## Web components

**Recognised:** a tag with a hyphen in its name, such as `<acme-button>`, in React JSX, a Vue template or an Angular template. It is counted even though nothing imports it. Capitals don't matter: `<Acme-Button>` is the same `acme-button`. The few SVG and MathML elements with a hyphen, such as `<font-face>`, are not counted.

**Linked to a package or your repo:** each tag belongs to one of these, in this order:

1. Your repo, when one of its files registers the tag with `customElements.define("…", …)` or `@customElement("…")`. When the registered class is imported from a package, the tag belongs to that package instead.
2. The package whose [Custom Elements Manifest](/docs/reference/glossary#custom-elements-manifest) declares the tag. The package must be installed, and its `package.json` must point at the manifest with a `customElements` field. A copy in a folder your `.gitignore` ignores, such as a build's output, doesn't count, unless the config sets [`gitignore`](/docs/reference/config#other-fields) to `false`. See [Link web components to your package](/docs/guides/link-web-components-to-your-package).
3. No package, when neither applies. The tag is still counted, and the dashboard's **Type** filter shows it as **Undefined element**.

**Renders and rendered by:** a web component counts for the React, Vue or Angular component whose code contains it. On its **Composition** tab it renders nothing, because what a web component draws inside itself isn't read.

**Known gaps:**

- A package that registers its own tags when you import it, such as `import "@acme/elements"`, isn't linked to them: the scan only looks for registrations in the files it scans. Give the package a manifest.
- A manifest that no `customElements` field points at is not read, including a `custom-elements.json` at your repo's root.

## In all three frameworks

- A component from a package is found only when the package is installed. Without it, each use of the package is [unmatched](/docs/reference/glossary#unmatched-use): the JSON keeps it with its reason, and the dashboard leaves it out.
- A capitalised tag that nothing imports or defines, such as `<Widget />`, is unmatched too.
