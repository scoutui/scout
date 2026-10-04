---
"@scoutui/web-app": patch
---

The allowed email domains rule (`OIDC_ALLOWED_DOMAINS`, chart `auth.oidc.allowedDomains`) now counts your sign-in provider's verified mark only when the provider's email is the one the dashboard has on record for that person, ignoring letter case. Admin emails already worked this way.
