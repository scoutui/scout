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

Admins named either way show on **People** as **Admin (set at install)** or **Admin (from SSO group)**, and you can't change or remove them there. To change them, change the setting or the group.

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

The dashboard checks the group each time someone signs in to it in a browser. Someone you add to the group becomes an Admin at their next browser sign-in. Someone you take out of it stays an Admin until their next browser sign-in.

### If someone you named isn't an Admin {#if-someone-you-named-isnt-an-admin}

First check that their address or group is in the setting. If it is, the web server logs the reason when the person signs in:

- `[auth] ana@example.com is in SCOUTUI_ADMINS, but the sign-in provider didn't mark the email verified, so they aren't an Admin.` Set your provider up to mark emails verified, or name a group instead.
- `[auth] Couldn't check whether ana@example.com is in SCOUTUI_ADMIN_GROUP, so they aren't an Admin until they sign in again: <reason>` Fix what the reason names.

Then have the person sign out of the dashboard and sign in again. With the Scout chart, `kubectl logs deploy/scout | grep '\[auth\]'` shows these lines.

## Change someone's role

1. Open the account menu, your initials at the right of the top bar, and select **Settings**. Only Admins see it.
2. Under **People**, choose the person's new role in the **Role** column.

The new role counts from their next click in the dashboard or their next upload, without signing in again.

People appear on the list once they have signed in. You can't change or remove yourself.

## Remove someone

Press **Remove** on the person's row and confirm. Removing someone signs them out everywhere, in the browser and the CLI, and takes them off the list.

If your sign-in provider still lets them in, they come back as a Viewer the next time they sign in. To keep someone out, first stop your provider letting them in, or [restrict who can sign in](/docs/guides/deploy-the-dashboard#restrict-who-can-sign-in), then remove them.

## When someone leaves

Once your provider stops letting someone in, they can't sign in to the dashboard again. Sessions they already have keep working, though: a browser session for up to 12 hours, and a CLI sign-in for up to 90 days, or until it goes 30 days unused. Their access ends sooner when:

- an Admin removes them on **People**, or
- your sign-in provider's sign-out notification for them reaches the dashboard.

Set up sign-out notifications, so that a leaver's access ends without anyone having to remove them: see [End sessions when people sign out of the provider](/docs/guides/deploy-the-dashboard#end-sessions-when-people-sign-out-of-the-provider).

An Admin you named can't be removed on **People**:

- **Named by email:** take their address out of `auth.admins` or `SCOUTUI_ADMINS` and redeploy, then remove them.
- **From the group:** they stay an Admin, because the dashboard checks the group only at a browser sign-in. Only a sign-out notification, or their sign-in running out, ends a CLI sign-in they already have.

## See who changed what

Once someone has changed a role, **History** under **People** lists the 20 most recent role changes and removals, newest first, each with who made it and when. Changes to the admin settings aren't in it.
