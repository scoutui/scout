---
"@scoutui/cli": minor
---

`scout scan` now reads `.mjs`, `.cjs`, `.mts` and `.cts` files. A config without `include` scans them, and an import such as `./theme.mjs` finds `theme.mts`. Type declaration files (`.d.mts`, `.d.cts`) are left out, like `.d.ts`. An installed package whose `.mts` or `.cts` file re-exports a component is now followed to the package that declares it.

A file the scan can't read or parse is now listed in the scan file as a `file-not-parsed` diagnostic, and prints `Warning: Skipped <file>: couldn't parse it (<reason>).` or `couldn't read it.` at the end of the scan instead of as it reads. The summary's file count no longer includes these files, or files `include` matches with an extension the scan doesn't read. The warning for a file with syntax errors the scan reads past now names the file by its path in the repository, as the skipped-file warning does.

With no `include` and nothing to scan, the error now reads `No JavaScript, TypeScript or Vue files to scan in <folder>.`
