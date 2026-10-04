---
"@scoutui/web-app": patch
---

When the database refuses the connection, the web server and the worker log why they couldn't start, such as `[worker] couldn't start: connect ECONNREFUSED 127.0.0.1:5432`. Before, a database at `localhost` left the reason empty.
