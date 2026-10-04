---
description: "Name the dashboard's first admins, give people the Viewer, Editor or Admin role, remove people, and end the access of people who leave."
sidebar_label: "Manage people and roles"
---

# Manage people and roles

Everyone who signs in to the dashboard has a role, which decides what they can change:

| Role | What they can do |
| --- | --- |
| Viewer | Look at repos, packages, components and saved charts. |
| Editor | Also upload scans, and change charts, governance and tags. |
| Admin | Also set people's roles and remove people. |

People who sign in for the first time are Viewers. Everyone who had signed in before you upgraded to a dashboard with roles is an Editor. CI jobs that upload with the dashboard's [upload token](/docs/guides/run-in-ci) don't need a role.

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

The dashboard checks the group each time someone signs in to it in a browser. Someone you add to the group becomes an Admin at their next browser sign-in. Someone you take out of it stops being one at their next browser sign-in, or straight away if an Admin also [removes them](#remove-someone) on **People**.

### If someone you named isn't an Admin {#if-someone-you-named-isnt-an-admin}

First check that their address or group is in the setting. Then look at the web server's `[auth]` lines from when the person signed in. With the Scout chart, this shows them:

```bash
kubectl logs deploy/scout | grep '\[auth\]'
```

- `[auth] ana@example.com is in SCOUTUI_ADMINS, but the sign-in provider didn't mark the email verified, so they aren't an Admin.` Set your provider up to mark emails verified, or name a group instead.
- `[auth] Couldn't check whether ana@example.com is in SCOUTUI_ADMIN_GROUP, so they aren't an Admin until they sign in again: <reason>` Fix what the reason names.
- **No `[auth]` line.** The setting doesn't match what the provider sends. For a group, check that the provider sends the `groups` field ([By group](#by-group)), and set `auth.adminGroup` or `SCOUTUI_ADMIN_GROUP` to the group exactly as it appears there, letter case included: some providers send a path or an ID instead of the name. For an email, check that the address is the one the provider sends.

Then have the person sign out of the dashboard and sign in again.

## Change someone's role

1. Open the account menu, your initials at the right of the top bar, and select **Settings**. Only Admins see it.
2. Under **People**, choose the person's new role in the **Role** column.

The new role counts from their next click in the dashboard or their next upload, without signing in again.

People appear on the list once they have signed in. You can't change or remove yourself.

## Remove someone

Press **Remove** on the person's row and confirm. Removing someone signs them out everywhere, in the browser and the CLI, and takes them off the list. You can remove group Admins too, but not Admins named by email.

If your sign-in provider still lets them in, they come back the next time they sign in: as a Viewer, or as an Admin if they're still in the admin group. To keep someone out, first stop your provider letting them in, or [restrict who can sign in](/docs/guides/deploy-the-dashboard#restrict-who-can-sign-in), then remove them.

## When someone leaves

1. Stop your sign-in provider letting them in.
2. [Remove them](#remove-someone) on **People**, which ends their browser and CLI sign-ins straight away. For an Admin named by email, first take their address out of `auth.admins` or `SCOUTUI_ADMINS` and redeploy.
3. Set up your provider's sign-out notifications, so a leaver's sign-ins end on their own when the provider signs them out: see [End sessions when people sign out of the provider](/docs/guides/deploy-the-dashboard#end-sessions-when-people-sign-out-of-the-provider). Without them, and without a removal, sign-ins a leaver already has keep working: a browser session for up to 12 hours, and a CLI sign-in for up to 90 days, or until it goes 30 days unused.

## See who changed what

Once there's been a change or a removal, **History** under **People** lists the 20 most recent role changes and removals, newest first, each with who made it and when. Changes to the admin settings aren't in it.
