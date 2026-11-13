---
"@scoutui/cli": patch
---

An installed Angular library whose `package.json#exports` points at JavaScript files with no `types` condition, such as `@ionic/angular` (`".": "./dist/standalone/index.js"`), now has its components read from the `.d.ts` file next to each target, the way TypeScript finds them. Before, the scan treated the library as having no typings, so all of its elements (every `<ion-*>` tag) were listed as custom elements instead of the library's components.
