# scout chart

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
