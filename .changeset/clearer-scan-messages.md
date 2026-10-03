---
"@scoutui/cli": patch
---

Clearer messages from `scout scan` and `scout auth login`:

- The lines that started with `[scan]` now read `Monorepo root: ../..` and `Path aliases: tsconfig.json`. At a monorepo root with no tsconfig of its own, it counts the workspace packages that have a tsconfig file, instead of saying none was found. With no tsconfig anywhere, it says how to point `tsconfigPath` at one with another name.
- A tsconfig the scan can't read gets one warning with its path relative to the repository and what to do, such as `docs/tsconfig.json points to docs/.nuxt/tsconfig.json, which doesn't exist, so its path aliases aren't followed.`, in place of the file system's own error. A problem that several tsconfig files reach is reported once.
- When dependencies aren't installed, the refusal to upload names the first missing package and the `package.json` that lists it, relative to the repository like the scan's own warning.
- An address that isn't a Scout dashboard now says so (`<host> didn't answer like a Scout dashboard. Check the dashboard address and try again.`) instead of asking you to check the dashboard's logs.
- With no dashboard address set, the upload error also names `SCOUTUI_HOST`, and `scout auth login` says how to give one.
- A missing config reads `Couldn't find ./scout.config.json. Run scout init to create one, or pass --config <path>.` Config errors name the config path as you gave it, and invalid JSON ends with what to do; `--debug` shows where the parser stopped.
- `scout auth --help` lists `--host` and `--debug`, and `scout --help` says what `auth status` does.
- With `--debug` in a terminal, debug lines no longer print on the end of the progress line.
