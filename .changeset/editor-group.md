---
"@scoutui/web-app": minor
---

New: set `SCOUTUI_EDITOR_GROUP` (chart: `auth.editorGroup`) to a group in your sign-in provider, and its members are Editors, checked at each browser sign-in like the admin group. They show on **People** as **Editor (from SSO group)**, and their role can't be changed there. It doesn't count as an admin setting.

New: set `SCOUTUI_ROLES_FROM_GROUPS_ONLY=true` (chart: `auth.rolesFromGroupsOnly`) to take roles only from your groups and `SCOUTUI_ADMINS`. Nobody's role can be changed on **People**, anyone in neither group is a Viewer, and roles set on **People** before are kept for if you turn it off. It needs `SCOUTUI_ADMIN_GROUP` or `SCOUTUI_EDITOR_GROUP`, or the web server won't start.

The `[auth]` line logged when the dashboard can't read someone's groups now reads `Couldn't read <email>'s groups, so they get no role from SCOUTUI_ADMIN_GROUP or SCOUTUI_EDITOR_GROUP until they sign in again: <reason>`.
