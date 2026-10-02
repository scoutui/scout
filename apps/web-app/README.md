# Scout dashboard

The [Scout](https://scoutui.dev) dashboard collects scans from your repos and keeps their history, so a design-system team can see which components are used where, plan migrations and follow adoption over time. [Explore the dashboard](https://scoutui.dev/docs/tutorials/explore-the-dashboard) is a guided first look.

## Run it

The dashboard is a Next.js web server plus a worker that processes uploaded scans, both from one image: `ghcr.io/scoutui/scout-web-app`. They need Postgres, and people sign in through your OpenID Connect provider.

- [Run the dashboard locally](https://scoutui.dev/docs/guides/run-the-dashboard-locally): try it on your machine with a built-in dev sign-in.
- [Deploy the dashboard](https://scoutui.dev/docs/guides/deploy-the-dashboard): host it for your team with the [Helm chart](../../charts/scout).

To fill it, people and CI jobs upload scans with the [Scout CLI](../../packages/cli): `scout scan`.

## Work on it

Read [CONTRIBUTING.md](../../CONTRIBUTING.md) first to set up the repository. Then, from the repository root, start Postgres and apply the migrations:

```bash
docker compose up -d db
export DATABASE_URL=postgres://scout:scout@localhost:5432/scout
yarn workspace @scoutui/web-app db:migrate
```

Run the web server and the worker in two terminals, both with `DATABASE_URL` set. The web server also needs the sign-in settings from [Run the dashboard locally](https://scoutui.dev/docs/guides/run-the-dashboard-locally).

```bash
yarn turbo run dev --filter=@scoutui/web-app --env-mode=loose
```

```bash
yarn turbo run worker:start --filter=@scoutui/web-app
```

The second command bundles the worker before it starts, so restart it after you change worker code.

Stop the dev server before you run the full check or delete `.next`: the check builds the app, and changing `.next` under a running server breaks it until you restart.

The tests that need a database skip unless `DATABASE_URL` is set. The tests create their own databases on that server and drop them afterwards, so the user in the URL needs permission to create databases:

```bash
yarn turbo run test --filter=@scoutui/web-app
```

The read models behind the pages live in [`@scoutui/web-shared`](../../packages/web-shared).
