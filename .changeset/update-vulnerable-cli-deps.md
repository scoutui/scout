---
"@scoutui/cli": patch
---

Updates the YAML, URL and glob libraries bundled into the CLI to versions without known vulnerabilities. A crafted `pnpm-workspace.yaml` could make `scout scan` use excessive CPU, and the URL library used for config validation could misread some hosts.
