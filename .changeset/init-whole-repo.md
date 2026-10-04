---
"@scoutui/cli": minor
---

`scout init` now sets up a scan of the whole repository:

- It no longer writes `include`, or the test and story patterns in `exclude`. Without `include`, the scan reads every `.js`, `.jsx`, `.ts`, `.tsx` and `.vue` file below the config's folder, and it leaves out tests, stories and `node_modules` on its own. `exclude` is always written, as `[]` when nothing is left out.
- In a monorepo, it asks `Leave any packages or folders out of the scan?` and lists the workspace packages and the top-level folders outside them. The ones you pick are written to `exclude`. To skip the question, pass `--exclude <folder>` once for each folder.
- Run in a workspace package's folder, when the repository root has no config yet, it asks `Scan the whole repository instead of only this package?`. Yes writes the config at the root. With `--yes`, it writes the config in the current folder and prints the `scout init --output` command that writes it at the root instead.
- Its questions open with the Scout wordmark, `scout <version> · init`, and it ends with `Wrote scout.config.json. Run scout scan --dry-run to try it, then scout scan to upload.` Outside a git repository, it warns first that `scout scan` needs one.
- `--framework` and the question about frameworks are gone, so `scout init --framework` now stops with an unknown-option error. Drop the flag: the scan reads React and Vue files alike. To scan only some files, set `include` in `scout.config.json`.

An existing `scout.config.json` is unchanged.
