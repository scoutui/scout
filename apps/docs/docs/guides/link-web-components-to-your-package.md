---
description: "Point your package of web components at its Custom Elements Manifest, so its tags in other repos belong to your package, with a version that lifecycle records can cover."
sidebar_label: "Link web components to your package"
---

# Link web components to your package

In a repo that uses your [web components](/docs/reference/glossary#web-component), a tag such as `<acme-button>` has no package unless something links it to yours. With no package it has no [version](/docs/reference/glossary#version), and a [lifecycle record](/docs/reference/glossary#lifecycle-record) on your package can't cover it. To link your tags in every repo that installs your package, ship a [Custom Elements Manifest](/docs/reference/glossary#custom-elements-manifest) and point your `package.json` at it.

## 1. Ship the manifest

Generate a `custom-elements.json` with your usual tooling, or write one by hand. The scan reads only which tags you declare: each declaration needs `"customElement": true` and a `tagName`.

```json title="dist/custom-elements.json"
{
  "schemaVersion": "1.0.0",
  "modules": [{
    "kind": "javascript-module",
    "path": "src/button.js",
    "declarations": [{ "kind": "class", "customElement": true, "name": "AcmeButton", "tagName": "acme-button" }]
  }]
}
```

Make sure the file is published with the package. If your `package.json` has a `files` list, it must include the manifest.

## 2. Point `package.json` at it

Add a `customElements` field with the manifest's path, relative to `package.json`:

```json title="package.json"
{
  "name": "@acme/elements",
  "version": "2.1.0",
  "customElements": "dist/custom-elements.json"
}
```

The scan follows only this field. A `custom-elements.json` that no `customElements` field points at is ignored, even at the package root.

Publish a new version of the package.

## 3. Check a scan

In a repo that uses the tag, install the new version, then scan.

```bash
npx scout scan --dry-run
jq '.components[] | select(.identity.tagName == "acme-button") | {status: .attribution.status, package: .attribution.target.packageName, version}' scout-scan.json
```

The tag's `attribution` is `resolved` to your package, and its `version` is set:

```json
{
  "status": "resolved",
  "package": "@acme/elements",
  "version": "2.1.0"
}
```

Once you upload a scan with `npx scout scan`, open the tag's page in the dashboard. A badge beside its name reads **Web component**, and the line under the name now gives your package and version: **From** `@acme/elements · v2.1.0`. The tag is also listed in the **Components** table of the package's page (see [Read a package page](/docs/guides/dashboard/packages#read-a-package-page)), and a lifecycle record on `@acme/elements` now covers it.

:::note
The manifest only tells the scan which package a tag belongs to. Descriptions, props, events and deprecation notes in it don't reach the scan or the dashboard. A tag's props and events are counted from what each place in the code passes, and only a lifecycle record marks it [deprecated](/docs/reference/glossary#deprecated).
:::

## If it still has no package

The scan warns when a package's `customElements` field points at a file that is missing or isn't valid JSON. Otherwise it doesn't warn: the tag's `attribution.status` just reads `unknown`, or `conflict` when two packages claim it. Check each of these:

- **The repo doesn't install your package.** The scan reads manifests only from packages installed in the scanned repo, so tags loaded from a CDN script stay without a package.
- **The field is missing, or isn't a string path.** Check `customElements` in the installed copy, `node_modules/@acme/elements/package.json`.
- **The file isn't at that path in the installed package.** Look for it in `node_modules/@acme/elements/`. A `files` list or a build step that leaves the manifest out gives a field that points at nothing.
- **The manifest isn't valid JSON.** A file that doesn't parse, for example because of a trailing comma, is skipped.
- **The declaration lacks `"customElement": true` or a `tagName`.**
- **Two installed packages declare the tag.** The tag gets no package, its `attribution.status` is `conflict`, and its component page names both packages after **From**. Declare each tag in one package's manifest only: if `@acme/ui` re-exports the elements of `@acme/ui-core`, don't copy the manifest into both.
- **The repo registers the tag with a class of its own.** When the repo's code runs `customElements.define("acme-button", …)` or uses `@customElement("acme-button")` with a class it defines itself, the tag belongs to that repo, not to your package: its `attribution.target` names the file that defines the class. A class imported from `@acme/elements` links the tag to your package instead, with or without the manifest.
