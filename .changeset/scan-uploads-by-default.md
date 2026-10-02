---
"@scoutui/cli": patch
---

`scout scan` now uploads to the dashboard. To scan without uploading, run `scout scan --dry-run`: it writes `scout-scan.json` next to the config and doesn't contact the dashboard.

- `--upload`, `--output` and `--commit-date` are gone, and so is the config's `output` field. A config with a field Scout doesn't use, such as `output` or a misspelt name, stops the scan with a line naming the field.
- An upload no longer writes a scan file.
- New configs point `$schema` at the schema published with the CLI, so editors suggest its fields. In an existing `scout.config.json`, change `$schema` to `https://unpkg.com/@scoutui/cli/schema/config.schema.json`.
- The summary after a scan is shorter, and its counts match the dashboard's.
