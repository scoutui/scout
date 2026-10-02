---
"@scoutui/web-app": patch
---

Every page now sends a Content-Security-Policy, so browsers only run scripts the dashboard sent.

Behind more than one proxy, such as a CDN in front of the ingress, set `SCOUTUI_TRUSTED_PROXY_HOPS` to the number of proxies that add an address to `X-Forwarded-For`, so rate limits apply to each client instead of everyone at once. It defaults to 1, and the deploy guide shows how to check it.
