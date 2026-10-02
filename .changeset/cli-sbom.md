---
"@scoutui/cli": patch
---

The package now includes a CycloneDX software bill of materials at `dist/sbom.cdx.json`, listing the third-party packages bundled into the CLI and the ones it installs. Each release also attaches it to its GitHub Release.
