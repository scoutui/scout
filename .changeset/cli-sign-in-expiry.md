---
"@scoutui/web-app": minor
---

CLI sign-ins now end after 30 days without use or 90 days after signing in, so sign-ins already older than 90 days stop working on upgrade, and a back-channel logout from the identity provider ends them too.
