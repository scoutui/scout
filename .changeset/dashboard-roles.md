---
"@scoutui/web-app": minor
---

Adds roles. Viewers can look at everything; Editors can also upload scans and change charts, governance and tags; Admins can also set people's roles on Settings → People, where they can remove someone too. Everyone who has already signed in becomes an Editor; people who sign in for the first time are Viewers.

Before upgrading, set `SCOUTUI_ADMINS` (chart `auth.admins`) to your admins' email addresses, or `SCOUTUI_ADMIN_GROUP` (chart `auth.adminGroup`) to a group in your sign-in provider. The dashboard won't start without one of them. An email counts only when your sign-in provider marks it verified.
