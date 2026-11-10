# scout chart

## 0.12.0

- New: `auth.guestView`, which lets anyone view the dashboard without signing in, read-only. Every repo on the dashboard becomes public, so it's off by default. People can still sign in at `/login`. It takes effect from web app 0.9.0.

## 0.11.0

- Run web app 0.8.0 by default.

## 0.10.0

- Run web app 0.7.0 by default.

## 0.9.0

- New: `auth.oidc.extraScopes`, scopes for the dashboard to ask your sign-in provider for on top of `openid`, `profile` and `email`. Set it to `[groups]` when your provider sends groups only when asked, as Okta does, so `auth.adminGroup` works. It takes effect from web app 0.7.0.

## 0.8.0

- Run web app 0.6.0 by default.

## 0.7.0

- Run web app 0.5.0 by default.

## 0.6.0

- Run web app 0.4.0 by default.

## 0.5.0

- Run web app 0.3.0 by default.

## 0.4.0

- Removed: `auth.requiredGroup`. Take it out of your values before upgrading, or the upgrade fails. To limit who signs in, assign people to the dashboard's application in your sign-in provider, or set `auth.oidc.allowedDomains`.

## 0.3.0

- New: `auth.admins` (emails of people who are always Admins) and `auth.adminGroup` (a sign-in provider group whose members are Admins). Set at least one before upgrading, or the install fails with a message saying so. An email counts only when your provider marks it verified. Named admins become Admins at their next browser sign-in, so have them sign out and in again after upgrading.

## 0.2.0

- Run web app 0.2.0 by default.

## 0.1.5

- First public release. The chart runs the dashboard image `ghcr.io/scoutui/scout-web-app` and is published at `oci://ghcr.io/scoutui/charts/scout`. [Deploy the dashboard](https://scoutui.dev/docs/guides/deploy-the-dashboard) walks through installing it.
