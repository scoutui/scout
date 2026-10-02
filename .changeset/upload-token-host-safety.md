---
"@scoutui/cli": patch
---

The CLI now protects your sign-in and your files more carefully:

- Hosts must use `https://`. Plain `http://` still works for `localhost`, `127.0.0.1` and `[::1]`.
- `auth login` opens your browser only for a link on the host you're signing in to. Otherwise, open the printed link yourself.
- `scout scan --dry-run` won't write `scout-scan.json` through a symbolic link to a file outside the config's folder.
