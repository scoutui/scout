---
"@scoutui/cli": patch
---

Imports through a workspace package's `exports` subpath that lists conditions, such as `"./constants": { "types": "./src/constants/index.ts", "default": "./dist/constants/index.mjs" }`, now resolve to the file the first existing condition names. Before, the scan skipped these subpaths. A component imported this way is now listed as defined in your repo, at its source file, rather than as a package export with no file. A value that isn't a component, such as a constant passed to a hook, is no longer reported as a component.
