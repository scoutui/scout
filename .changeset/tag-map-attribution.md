---
"@scoutui/cli": minor
---

A web component now belongs to the package whose type declarations list its tag in `HTMLElementTagNameMap`, when a file in the repo imports the module they describe. Before, a tag from a package that ships TypeScript types but no Custom Elements Manifest, such as `<icon-close>` after `import "@acme/icons/dist/IconClose.js"`, was an Undefined element. Side-effect imports count; `import type` doesn't. The scan file records this as a new evidence `source`, `tag-map`. When it names a different package from a manifest that declares the same tag, the tag is a conflict, as it is between two manifests.
