---
"@scoutui/cli": minor
---

A web component now belongs to the package whose type declarations list its tag in `HTMLElementTagNameMap`, when a file in the repo imports the module they describe. Before, a tag from a package that ships TypeScript types but no Custom Elements Manifest, such as `<icon-close>` after `import "@acme/icons/dist/IconClose.js"`, was an Undefined element. Side-effect imports count; `import type` doesn't. The scan file records this as a new evidence `source`, `tag-map`. When it names a different package from a manifest that declares the same tag, the tag is a conflict, as it is between two manifests.

Angular components from an installed library are also found in three more places, as TypeScript finds their typings: the `.d.ts` file beside a package's `main` when it has no `types` field, the `.d.ts` file beside a deep import such as `@acme/ui/dist/button.js` when the package has no `exports`, and a re-export written with a `.ts` extension.
