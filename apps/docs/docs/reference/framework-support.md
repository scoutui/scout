---
description: "What a Scout scan reads in React and Vue files: which files, how React, Vue and web components are recognised, whether renders and rendered by are tracked, and the known gaps."
sidebar_label: "Framework support"
---

# Framework support reference

A scan reads React and Vue. This page lists, for each, which files are read, how a [component](/docs/reference/glossary#component) is recognised, what else is recorded, and what is not found. [Web components](#web-components) such as `<acme-button>` are counted in both. A file is only read when your config's `include` patterns match it, or when the config has no `include`; see [Config reference](/docs/reference/config).

HTML files and Lit templates are not read.

## At a glance

| | React | Vue |
| --- | --- | --- |
| Files | `.tsx`, `.jsx`, `.ts`, `.js` | `.vue` |
| What is read | JSX anywhere in the file | The `<template>` and `<script>` blocks |
| Components found | Imported or locally defined components used as JSX tags, and web components | Imported components, auto-imported components, and web components |
| Prop values | Yes | Yes |
| Events | Props named `on` plus a capital letter, such as `onClick` | `@name` and `v-on:name` |
| Renders and rendered by | Yes | Yes |

Files with any other extension, such as `.mjs`, `.mts`, `.html` or `.svelte`, are skipped even when `include` matches them.

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
- In a file with both `<script>` and `<script setup>`, a component imported in the plain `<script>` is not matched. Written `<LineItem>`, its tag is not counted at all. Written `<line-item>`, it is counted as a web component with no package. Move the import into `<script setup>`.

## Web components

**Recognised:** a tag with a hyphen in its name, such as `<acme-button>`, in React JSX or a Vue template. It is counted even though nothing imports it. Capitals don't matter: `<Acme-Button>` is the same `acme-button`. The few SVG and MathML elements with a hyphen, such as `<font-face>`, are not counted.

**Linked to a package or your repo:** each tag belongs to one of these, in this order:

1. Your repo, when one of its files registers the tag with `customElements.define("…", …)` or `@customElement("…")`. When the registered class is imported from a package, the tag belongs to that package instead.
2. The package whose [Custom Elements Manifest](/docs/reference/glossary#custom-elements-manifest) declares the tag. The package must be installed, and its `package.json` must point at the manifest with a `customElements` field. See [Link web components to your package](/docs/guides/link-web-components-to-your-package).
3. No package, when neither applies. The tag is still counted, and the dashboard's **Type** filter shows it as **Undefined element**.

**Renders and rendered by:** a web component counts for the React or Vue component whose code contains it. On its **Composition** tab it renders nothing, because what a web component draws inside itself isn't read.

**Known gaps:**

- A package that registers its own tags when you import it, such as `import "@acme/elements"`, isn't linked to them: the scan only looks for registrations in the files it scans. Give the package a manifest.
- A manifest that no `customElements` field points at is not read, including a `custom-elements.json` at your repo's root.

## In both frameworks

- A component from a package is found only when the package is installed. Without it, each use of the package is [unmatched](/docs/reference/glossary#unmatched-use): the JSON keeps it with its reason, and the dashboard leaves it out.
- A capitalised tag that nothing imports or defines, such as `<Widget />`, is unmatched too.
