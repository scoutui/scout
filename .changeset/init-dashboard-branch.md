---
"@scoutui/cli": patch
---

`scout init` now asks for your dashboard's address, the repository's name on the dashboard (suggesting `owner/name` from the git remote) and the branch the dashboard tracks, and saves them in `scout.config.json`. With several remotes and none called `origin` or `upstream`, it asks which one the dashboard follows and saves the answer in that clone's git config as `scout.remote`. It no longer asks for an output path. `scout auth login`, `status` and `logout` read the dashboard's address from `scout.config.json`, so teammates don't have to type it. In a clone with an `upstream` remote, the scan records that remote instead of `origin`, and a remote address with a password or token in it is recorded without them.
