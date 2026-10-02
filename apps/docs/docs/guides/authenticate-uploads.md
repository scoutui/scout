---
description: "Sign the Scout CLI in to a dashboard so scout scan uploads as you, and control which dashboard your uploads go to."
sidebar_label: "Authenticate uploads"
---

# Authenticate the CLI for uploads

Sign the CLI in to your dashboard so `scout scan` can upload scans as you. For uploads from a CI job, where nobody can open a browser, see [Run a scan and upload in CI](/docs/guides/run-in-ci) instead.

You need the CLI installed ([Install the CLI](/docs/guides/install)) and a running dashboard ([Run the dashboard locally](/docs/guides/run-the-dashboard-locally) or [Deploy the dashboard](/docs/guides/deploy-the-dashboard)).

## Sign in

1. Run `auth login` with the dashboard's full address:

   ```bash
   npx scout auth login --host https://scout.example.com
   ```

   Without a scheme the CLI assumes `https://`, so write a local dashboard out in full as `http://localhost:3000`. The CLI accepts plain `http://` only for `localhost`, `127.0.0.1` and `[::1]`, because anywhere else it would send your session unencrypted.

2. The CLI prints a code and opens your browser:

   ```
   To authorize this device, open:
     https://scout.example.com/login/device
   Code: HJKM-4TQX
   Opened your browser…
   ```

   The CLI opens only a link on the host you're signing in to. If no browser opens, open the link yourself with your code on the end:

   ```
   https://scout.example.com/login/device?code=HJKM-4TQX
   ```

3. In the browser, sign in to the dashboard if it asks you to. Check that **Device code** matches the code in your terminal and that **Signed in as** shows the account you want to upload as, then press **Approve**.
   - If **Signed in as** shows the wrong account, press **Use another account**. The dashboard signs you out in the browser. Sign in as the right account and you come back to the same code.
   - If you didn't start this sign-in, press **Deny**. The terminal prints `Authorization was declined.`

4. The terminal finishes with:

   ```
   ✓ Signed in as dev@acme.test
   ```

The CLI saves your session in the system keychain. When it can't use one, for example on Windows, it saves the session in a file instead and warns:

```
Warning: Couldn't save your session to the system keychain, so it was saved to ~/.config/scoutui/hosts.json instead.
```

[Where the session is saved](/docs/reference/cli#where-the-session-is-saved) has the details.

Your sign-in ends when the first of these happens:

- You run `auth logout`.
- You don't use it for 30 days. Every upload and every `auth status` counts as use.
- 90 days pass since you signed in, however often you use it.
- You sign out of your identity provider, if the dashboard [receives back-channel logouts](/docs/guides/deploy-the-dashboard#end-sessions-when-people-sign-out-of-the-provider) from it.

When it ends, `scan` and `auth status` tell you to sign in again (see [Check or end your sign-in](#check-or-end-your-sign-in)). Don't use a personal sign-in in CI: it ends after 90 days at most. Use a CI upload token instead: see [Run a scan and upload in CI](/docs/guides/run-in-ci).

## Name the host you upload to

`scan` sends the scan to the first of these that is set: the `--host` flag, the `SCOUTUI_HOST` environment variable, the `host` field in `scout.config.json`, and finally your default host.

Your default host is the first dashboard you signed in to, and signing in to another one doesn't change it. If you use more than one dashboard, name the host every time: add `"host": "https://scout.example.com"` to the repo's `scout.config.json`, or pass `--host` to `scan`.

The `auth` commands read the same `host` from `scout.config.json` in the current directory, so in a repo whose config names the dashboard, `npx scout auth login` needs no `--host`. `scout init` writes it when you give it the dashboard's address. [Host resolution](/docs/reference/cli#host-resolution) in the CLI reference has the full order.

## Check or end your sign-in

```bash
npx scout auth status --host https://scout.example.com
```

```
Signed in as dev@acme.test to https://scout.example.com (session saved in the system keychain).
```

If the dashboard stops accepting your session, `auth status` prints this instead, and `scan` fails with the same message:

```
Error: Session for https://scout.example.com is no longer valid. Run `scout auth login --host https://scout.example.com`.
```

Run the `auth login` command it names. If `auth status` prints `Error: Couldn't reach <host>. Check your connection and try again.`, you are still signed in: check your network and try again.

To sign out, run `npx scout auth logout --host <url>`. It ends the session on the dashboard, removes it from your computer and prints `Signed out of <url>.` If the dashboard can't be reached, your session stays saved so you can try again.

To upload as a different account, sign out, then sign in again. If the approval page still shows the old account, press **Use another account**.

## Verify

Install the repo's dependencies first. Without them, `scan` refuses with `Error: Couldn't upload the scan: some dependencies aren't installed. Install them and try again.`

`scan` also takes only a commit that's pushed to the remote's default branch, with no uncommitted changes apart from a new `scout.config.json` and scan file. If you added the CLI to `package.json`, commit and push that change, lockfile included, before you upload. [Upload flags](/docs/reference/cli#upload-flags) lists everything the upload checks.

Then scan and upload with the host named:

```bash
npx scout scan --host https://scout.example.com
```

The output ends with the uploaded scan and your repo's page:

```
Uploaded scan 01M3A0D4GX9AGSDJJ0P6P9N7Q3 → https://scout.example.com/repos/storefront
```

For every `auth` flag and exit code, see the [CLI reference](/docs/reference/cli#auth).
