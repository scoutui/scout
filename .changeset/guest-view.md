---
"@scoutui/web-app": minor
---

Adds a guest view, off by default. Set `SCOUTUI_GUEST_VIEW=true`, or `auth.guestView: true` in the Helm chart, to let anyone view the dashboard without signing in, read-only. Guests see repos, packages, components and charts shared with everyone, and can't change anything. Turning it on makes every repo on the dashboard public. People still sign in at `/login`.
