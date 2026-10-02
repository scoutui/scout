---
"@scoutui/web-app": patch
---

When `SCOUTUI_UPLOAD_SLOT_WAIT_MS` plus `SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS` is over 270000 ms, the web server's startup error now shows both values and their total in milliseconds, and the most they can add up to. Before, the message ran its words together and left out a unit.
