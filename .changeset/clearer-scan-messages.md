---
"@scoutui/cli": patch
---

Clearer messages from `scout scan` and `scout auth login`:

- The lines that started with `[scan]` now read `Monorepo root: ../..` and `Path aliases: tsconfig.json`. At a monorepo root with no tsconfig of its own, it counts the workspace packages whose tsconfig files supply the aliases, instead of saying none was found. With no tsconfig anywhere, it says how to point `tsconfigPath` at one with another name.
- A tsconfig the scan can't read gets one warning with its path relative to the repository and what to do, such as `docs/tsconfig.json points to docs/.nuxt/tsconfig.json, which doesn't exist, so its path aliases aren't followed.`, in place of the file system's own error. A problem two packages share is reported once.
- When dependencies aren't installed, the refusal to upload names the first missing package and the `package.json` that lists it.
- An address that isn't a Scout dashboard now says so (`<host> didn't answer like a Scout dashboard. Check the dashboard address and try again.`) instead of asking you to check the dashboard's logs.
- A missing config reads `Couldn't find ./scout.config.json. Run scout init to create one, or pass --config <path>.`, an invalid one ends with what to do, and `scout auth login` without an address says how to give one.
