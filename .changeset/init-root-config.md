---
"@scoutui/cli": patch
---

`scout init` run in a workspace package's folder no longer writes a second config when the repository root already has one. It writes nothing and names the root's config and the folder to run `scout scan` in: `This repository already has a config: ../../scout.config.json. Run scout scan in ../.. to use it.` To write a config somewhere else anyway, pass `--output`.
