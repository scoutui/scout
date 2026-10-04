---
"@scoutui/web-app": minor
---

Removes `SCOUTUI_REQUIRED_GROUP` (chart `auth.requiredGroup`), the group people had to be in to sign in. To limit who can sign in, assign people to the dashboard's application in your sign-in provider, or set `OIDC_ALLOWED_DOMAINS` (chart `auth.oidc.allowedDomains`). People who sign in for the first time are Viewers until an Admin gives them another role on Settings → People.
