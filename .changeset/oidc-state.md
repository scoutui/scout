---
"@scoutui/web-app": patch
---

Fix: browser sign-in now sends a `state` to your sign-in provider as well as PKCE. Providers that require one, such as Okta, rejected the sign-in without it, and the dashboard showed `OAuthCallbackError`.
