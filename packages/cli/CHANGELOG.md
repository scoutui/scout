# @scoutui/cli

## 0.1.1

### Patch Changes

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan` now checks everything that would stop the upload before it scans, and stops with one line saying what to fix:

  - The commit must be on the branch the dashboard tracks, with no uncommitted changes and the clone's full history.
  - A commit the dashboard already has is skipped without scanning.

  Also:

  - `scout auth login` checks the CLI version before you sign in.
  - The upload and skip lines and the dashboard's warnings print under `--quiet`, and some errors link to a page that explains them.
  - A remote that uses an SSH host alias or a git `insteadOf` rewrite is recorded under its real address.
  - A package listed only in `peerDependencies` or `optionalDependencies` no longer stops the upload when it isn't installed.
  - An uploaded scan records the branch the dashboard tracks and where the commit sits on it (`repo.branch`, `repo.branchPosition`).
  - A CI job needs to know which branch the dashboard tracks: set `branch` in `scout.config.json`, or run `git remote set-head origin --auto` after checkout.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The package now includes a CycloneDX software bill of materials at `dist/sbom.cdx.json`, listing the third-party packages bundled into the CLI and the ones it installs. Each release also attaches it to its GitHub Release.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The package now includes Scout's MIT licence.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init` now suggests the same repository name for a Bitbucket Data Center or Azure DevOps clone whether its remote is SSH or HTTPS.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init` now asks for your dashboard's address, the repository's name on the dashboard (suggesting `owner/name` from the git remote) and the branch the dashboard tracks, and saves them in `scout.config.json`. With several remotes and none called `origin` or `upstream`, it asks which one the dashboard follows and saves the answer in that clone's git config as `scout.remote`. It no longer asks for an output path. `scout auth login`, `status` and `logout` read the dashboard's address from `scout.config.json`, so teammates don't have to type it. In a clone with an `upstream` remote, the scan records that remote instead of `origin`, and a remote address with a password or token in it is recorded without them.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout init` now suggests the owner and name for a clone whose SSH remote is an `ssh://` URL or uses a user other than `git`, as it does for other remotes.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Errors now print one line under `Error:`, without a stack trace, and warnings print under `Warning:` in plain words. Add `--debug`, or set `SCOUTUI_DEBUG=1`, to see the detail behind an error, such as the dashboard's reply, and the counts of usages the scan couldn't match. `scout scan` outside a git repository, in a repository with no commits, and `scout init` over an existing config now say what to do. A failed upload prints one line, and the CLI says once that it's waiting for the dashboard. In a shallow clone, the scan now warns and records no first commit, instead of recording the oldest fetched commit as the first.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Scan files no longer include `depth` on each occurrence. Nothing read it, and the dashboard reads scans with or without it. `scout scan` also no longer prints a "Walking" progress line, which counted a pass that did no work.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - If `scout scan` ever builds a scan file that fails its own format check, it now says in one line that this is a bug in Scout and where to report it, instead of printing a stack trace. It still exits with code `1` and writes no scan file. Scans are otherwise byte for byte the same.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - `scout scan` now uploads to the dashboard. To scan without uploading, run `scout scan --dry-run`: it writes `scout-scan.json` next to the config and doesn't contact the dashboard.

  - `--upload`, `--output` and `--commit-date` are gone, and so is the config's `output` field. A config with a field Scout doesn't use, such as `output` or a misspelt name, stops the scan with a line naming the field.
  - An upload no longer writes a scan file.
  - New configs point `$schema` at the schema published with the CLI, so editors suggest its fields. In an existing `scout.config.json`, change `$schema` to `https://unpkg.com/@scoutui/cli/schema/config.schema.json`.
  - The summary after a scan is shorter, and its counts match the dashboard's.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - Updates the YAML, URL and glob libraries bundled into the CLI to versions without known vulnerabilities. A crafted `pnpm-workspace.yaml` could make `scout scan` use excessive CPU, and the URL library used for config validation could misread some hosts.

- [`c4e7f2c`](https://github.com/scoutui/scout/commit/c4e7f2c723ddb91004f8d7a2cc0064d6634ac5ea) Thanks [@siggerzz](https://github.com/siggerzz)! - The CLI now protects your sign-in and your files more carefully:

  - Hosts must use `https://`. Plain `http://` still works for `localhost`, `127.0.0.1` and `[::1]`.
  - `auth login` opens your browser only for a link on the host you're signing in to. Otherwise, open the printed link yourself.
  - `scout scan --dry-run` won't write `scout-scan.json` through a symbolic link to a file outside the config's folder.

## 0.1.0

First public release. `scout scan` reads a React or Vue repository, web components included, and writes a JSON file that lists every component the repo uses and every place it uses it. `scout init` sets up a repo's `scout.config.json`, and after `scout auth login`, `scout scan --upload` sends each scan to your team's Scout dashboard.
