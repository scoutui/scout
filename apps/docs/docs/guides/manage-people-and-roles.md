---
description: "Name the dashboard's first admins, give people the Viewer, Editor or Admin role, remove people, and end the access of people who leave."
sidebar_label: "Manage people and roles"
---

# Manage people and roles

Everyone who signs in to the dashboard has a role, which decides what they can change:

| Role | What they can do |
| --- | --- |
| Viewer | Look at repos, packages, components, governance and the charts shared with everyone. |
| Editor | Also upload scans, create a repo's CI upload token, make charts and change their own, and change governance and tags. |
| Admin | Also change or delete anyone's chart, open private ones, set people's roles, remove people and [remove scans and delete repos](/docs/guides/dashboard/repos#remove-a-scan-or-delete-a-repo). |

People who sign in for the first time are Viewers. Everyone who had signed in before you upgraded to a dashboard with roles is an Editor. CI jobs that upload with a repo's [CI upload token](/docs/guides/run-in-ci) don't need a role.

## Name the first admins

The dashboard needs at least one admin setting, or it won't start. Name your admins by email, by a group in your sign-in provider, or both.

Named admins become Admins at their next browser sign-in. After you upgrade to a dashboard with roles, nobody is an Admin until one of them signs in again, so have them sign out of the dashboard and sign in again.

Admins named either way show on **People** as **Admin (set at install)** or **Admin (from SSO group)**, and you can't change their role there. To change it, change the setting or the group.

### By email

```yaml title="values.yaml"
auth:
  admins:
    - ana@example.com
    - sam@example.com
```

With [your own chart](/docs/guides/deploy-with-your-own-chart), set `SCOUTUI_ADMINS` on the web server to the addresses, separated by commas: `ana@example.com,sam@example.com`.

An address counts only when your sign-in provider marked the email verified the last time that person signed in to the dashboard in a browser. Some providers, such as authentik, don't mark emails verified unless you set them up to. If yours doesn't, name a group instead.

Letter case doesn't matter, but otherwise the address must be exactly the one your provider sends.

### By group

```yaml title="values.yaml"
auth:
  adminGroup: scout-admins
```

With your own chart, set `SCOUTUI_ADMIN_GROUP` on the web server to the group's name: `scout-admins`.

Members of the group are Admins. The dashboard reads a person's groups from the `groups` field of the provider's userinfo response, so the provider must include that field for the scopes in [step 1 of Deploy the dashboard](/docs/guides/deploy-the-dashboard#1-register-the-dashboard-with-your-identity-provider).

Some providers, such as Okta, send groups only when the dashboard asks for the `groups` scope. For those, ask for it as well:

```yaml title="values.yaml"
auth:
  adminGroup: scout-admins
  oidc:
    extraScopes: [groups]
```

With your own chart, also set `OIDC_EXTRA_SCOPES` on the web server to `groups`. Add it only if your provider needs it: some providers, such as Google, turn sign-in away when the dashboard asks for a scope they don't know.

In Okta, also add a groups claim to the dashboard's application. On its **Sign On** tab, edit **OpenID Connect ID Token**, set **Groups claim type** to **Filter**, keep the claim name `groups`, and choose a filter that matches the groups you name, such as **Starts with** `scout-` for `scout-admins` and `scout-editors`.

The dashboard checks the group each time someone signs in to it in a browser. Someone you add to the group becomes an Admin at their next browser sign-in. Someone you take out of it stops being one at their next browser sign-in, or straight away if an Admin also [removes them](#remove-someone) on **People**.

### If someone you named isn't an Admin {#if-someone-you-named-isnt-an-admin}

First check that their address or group is in the setting. Then look at the web server's `[auth]` lines from when the person signed in. With the Scout chart, this shows them:

```bash
kubectl logs deploy/scout | grep '\[auth\]'
```

- `[auth] ana@example.com is in SCOUTUI_ADMINS, but the sign-in provider didn't mark the email verified, so they aren't an Admin.` Set your provider up to mark emails verified, or name a group instead.
- `[auth] Couldn't read ana@example.com's groups, so they get no role from SCOUTUI_ADMIN_GROUP or SCOUTUI_EDITOR_GROUP until they sign in again: <reason>` Fix what the reason names.
- **No `[auth]` line.** The setting doesn't match what the provider sends. For a group, check that the provider sends the `groups` field ([By group](#by-group)), and set `auth.adminGroup` or `SCOUTUI_ADMIN_GROUP` to the group exactly as it appears there, letter case included: some providers send a path or an ID instead of the name. For an email, check that the address is the one the provider sends.

Then have the person sign out of the dashboard and sign in again.

## Give Editors by group

Name a group in your sign-in provider whose members are Editors:

```yaml title="values.yaml"
auth:
  adminGroup: scout-admins
  editorGroup: scout-editors
```

With your own chart, set `SCOUTUI_EDITOR_GROUP` on the web server to the group's name: `scout-editors`.

The dashboard reads it from the same `groups` field as the admin group, at each browser sign-in, so set your provider up the same way ([By group](#by-group)). Members show on **People** as **Editor (from SSO group)**, and you can't change their role there: change the group instead. Someone in both groups is an Admin, and so is someone you made an Admin on **People**.

The editor group doesn't count as an admin setting: you still need `auth.admins` or `auth.adminGroup`.

## Take roles from groups only

If people ask your sign-in provider for access, you can make its groups the only place roles come from, so nobody gets a role without going through it:

```yaml title="values.yaml"
auth:
  adminGroup: scout-admins
  editorGroup: scout-editors
  rolesFromGroupsOnly: true
```

With your own chart, set `SCOUTUI_ROLES_FROM_GROUPS_ONLY` on the web server to `true`.

Then:

- Members of the admin group are Admins, members of the editor group are Editors, and everyone else who signs in is a Viewer.
- Admins named by email in `auth.admins` or `SCOUTUI_ADMINS` are still Admins, so you can keep one to fall back on if the groups stop arriving.
- Nobody's role can be changed on **People**. You can still [remove people](#remove-someone).
- Roles you set on **People** before don't count, but they're kept: turn the setting off and they're back.

It needs `auth.adminGroup` or `auth.editorGroup`, or the upgrade fails with `auth.rolesFromGroupsOnly is on, so set auth.adminGroup or auth.editorGroup to a group in your sign-in provider.` With your own chart, the web server won't start and logs `[startup] failed: SCOUTUI_ROLES_FROM_GROUPS_ONLY is on, so set SCOUTUI_ADMIN_GROUP or SCOUTUI_EDITOR_GROUP to a group in your sign-in provider.`

## Change someone's role

1. Open the account menu, your initials at the right of the top bar, and select **Settings**. Only Admins see it.
2. Under **People**, choose the person's new role in the **Role** column.

The new role counts from their next click in the dashboard or their next upload, without signing in again.

People appear on the list once they have signed in. You can't change or remove yourself, change a role that comes from `auth.admins` or a group, or change any role when [roles come from groups only](#take-roles-from-groups-only).

## Remove someone

Press **Remove** on the person's row and confirm. Removing someone signs them out everywhere, in the browser and the CLI, and takes them off the list. You can remove people whose role comes from a group too, but not Admins named by email.

If your sign-in provider still lets them in, they come back the next time they sign in: as a Viewer, or with the role their group gives them. To keep someone out, first stop your provider letting them in, or [restrict who can sign in](/docs/guides/deploy-the-dashboard#restrict-who-can-sign-in), then remove them.

## When someone leaves

1. Stop your sign-in provider letting them in.
2. [Remove them](#remove-someone) on **People**, which ends their browser and CLI sign-ins straight away. For an Admin named by email, first take their address out of `auth.admins` or `SCOUTUI_ADMINS` and redeploy.
3. Set up your provider's sign-out notifications, so a leaver's sign-ins end on their own when the provider signs them out: see [End sessions when people sign out of the provider](/docs/guides/deploy-the-dashboard#end-sessions-when-people-sign-out-of-the-provider). Without them, and without a removal, sign-ins a leaver already has keep working: a browser session for up to 12 hours, and a CLI sign-in for up to 90 days, or until it goes 30 days unused.

## See who changed what

Once there's been a change or a removal, **History** on the **Settings** page lists the most recent role changes, people removed, scans removed and repos deleted, newest first, each with who made it and when. Changes to the role settings and to people's groups aren't in it.
