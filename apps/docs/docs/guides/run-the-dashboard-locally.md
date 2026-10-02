---
description: "Run the Scout dashboard and its worker on your machine with Postgres and the dev sign-in, then sign the CLI in and upload a scan."
sidebar_label: "Run the dashboard locally"
---

# Run the dashboard locally

Run the dashboard at `http://localhost:3000` on your own machine, sign in without an identity provider, and upload a scan to it. Use this to try the dashboard before your team deploys one, or to work on the dashboard itself.

The dashboard runs as two processes from a clone of the Scout repository: the web server, and the *worker*, which processes uploaded scans so they appear in the dashboard. [How the CLI and the dashboard fit together](/docs/explanation/cli-and-dashboard#after-upload) explains more.

You need Node.js 24, Yarn through Corepack (run `corepack enable` once), Docker for Postgres, and `openssl`. Run every command from the root of your clone unless a step says otherwise.

## 1. Install and build

```bash
yarn install
yarn turbo run worker:build --filter=@scoutui/web-app
```

The second command builds the packages the dashboard depends on, then the worker. Run it again after you pull new changes.

## 2. Start Postgres

```bash
docker compose up -d db
```

## 3. Configure the environment

Copy the example settings file, then generate a session secret:

```bash
cp apps/web-app/.env.local.example apps/web-app/.env.local
openssl rand -base64 32   # for AUTH_SECRET
```

Edit `apps/web-app/.env.local`: keep `DATABASE_URL` as it is, paste the secret, and choose a dev password. Leave everything else as the example has it. The three lines you set look like this:

```ini title="apps/web-app/.env.local"
DATABASE_URL=postgres://scout:scout@localhost:5432/scout
AUTH_SECRET=<generated secret>
DEV_AUTH_PASSWORD=letmein
```

`DEV_AUTH_PASSWORD` turns on the *dev sign-in*, which accepts any email address with this password. It only works under `yarn dev`; a shared dashboard needs a real identity provider, as set up in [Deploy the dashboard](/docs/guides/deploy-the-dashboard).

## 4. Start the dashboard

In one terminal:

```bash
cd apps/web-app
yarn dev
```

It applies any database migrations on start, so there is no separate migrate step. Leave it running once it prints `✓ Ready`.

## 5. Start the worker

In a second terminal:

```bash
cd apps/web-app
DATABASE_URL=postgres://scout:scout@localhost:5432/scout yarn worker:start
```

The worker doesn't read `.env.local`, so pass `DATABASE_URL` on the command line. Leave it running once it prints `[worker] started`.

## 6. Sign in to the dashboard

Open `http://localhost:3000`, enter any email address and your dev password, and press **Dev sign-in**. You land on the repos list, which is empty until the first upload.

## 7. Sign the CLI in

In a repo that has its dependencies and the CLI installed and a `scout.config.json` (see [Scan your first repo](/docs/tutorials/scan-your-first-repo)), run:

```bash
npx scout auth login --host http://localhost:3000
```

Include `http://`; without a scheme the CLI assumes `https://`. The CLI opens your browser at an approval page showing the same code as the terminal. Press **Approve**, and the terminal prints `✓ Signed in as` with your email. [Authenticate the CLI for uploads](/docs/guides/authenticate-uploads) covers checking and switching hosts.

## Verify

In the same repo, scan and upload. `scan` takes only a commit that's pushed to the remote's default branch, with no uncommitted changes apart from a new `scout.config.json` and scan file. If you added the CLI to `package.json`, commit and push that change, lockfile included, before you upload. [Upload flags](/docs/reference/cli#upload-flags) lists everything the upload checks.

`--host` sends the upload to your local dashboard even if the CLI has a different default host:

```bash
npx scout scan --host http://localhost:3000
```

The output ends with a link to your repo's page in the dashboard:

```
Uploaded scan 01M3A0D4GX9AGSDJJ0P6P9N7Q3 → http://localhost:3000/repos/storefront
```

## If something goes wrong

- **The CLI ends with `Error: The dashboard is still processing the scan after 5 minutes.`** The worker isn't running. Start it (step 5) and the waiting upload is processed.
- **The worker prints `[worker] couldn't start:` and exits.** Check that Postgres is running (step 2) and that you passed `DATABASE_URL` on the command line. If the line mentions `EADDRINUSE`, port 3001 (the worker's health check) is in use; set `WORKER_HEALTH_PORT=3101` on the same command line.
- **`yarn dev` starts on a port other than 3000.** Something else holds port 3000; the `Local:` line shows the port it chose. Stop the other process and restart, or use the printed address in every step.

## Next

- [Explore the dashboard](/docs/tutorials/explore-the-dashboard) walks through the repo page, a component's calls, tags and a migration, starting from this setup.
- [Deploy the dashboard](/docs/guides/deploy-the-dashboard) runs a shared dashboard for your team.
