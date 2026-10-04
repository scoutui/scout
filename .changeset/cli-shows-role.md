---
"@scoutui/cli": minor
---

`scout auth login` and `scout auth status` show your role on the dashboard: Viewer, Editor or Admin. If you're a Viewer, `scout scan` and `scout backfill` stop before scanning with "You can view this dashboard but not upload to it. Ask an admin to make you an Editor." The same line appears if your role changes during a scan or backfill. Older CLIs also stop before scanning with that line; if the role changes during an upload, they say the dashboard returned an error.
