---
description: "Run the Scout dashboard image under your own Helm chart or a platform-provided one: the web server and the worker, their environment, migrations, memory, the proxy in front and secrets loaded from a file."
sidebar_label: "Deploy with your own chart"
---

# Deploy the dashboard with your own chart

Run the Scout dashboard under a Helm chart that you or your platform team maintain, instead of [the Scout chart](/docs/guides/deploy-the-dashboard). Follow these steps to run the image's web server and worker under your chart.

You need:

- A Postgres database, and a user that owns it. The dashboard creates its tables when it starts.
- A client for the dashboard in your OpenID Connect (OIDC) identity provider, set up as in [step 1 of Deploy the dashboard](/docs/guides/deploy-the-dashboard#1-register-the-dashboard-with-your-identity-provider). Note its issuer URL, client ID and client secret.
- A session key for the dashboard, such as the output of `openssl rand -base64 32`.

The examples use the host `scout.example.com`.

## 1. Pick the image

Use `ghcr.io/scoutui/scout-web-app:<version>`, where `<version>` comes from a [`web-app@<version>` release](https://github.com/scoutui/scout/releases). A release tag never changes once it's pushed, and covers linux/amd64 and linux/arm64. `latest` points at the newest release. `main` and `main-<commit>` are unreleased builds for linux/amd64 only.

## 2. Run the web server and the worker

Run two Deployments from the same image, each with at least one replica. The *worker* [processes uploaded scans](/docs/explanation/cli-and-dashboard#after-upload) so they appear in the dashboard.

| | Web server | Worker |
| --- | --- | --- |
| Command | The image's default | `node apps/web-app/worker.cjs` |
| Port | 3000, behind a Service and your ingress | 3001, for probes only. It needs no Service. |
| Startup probe | `GET /api/health`, allowing a few minutes for migrations | `GET /live` |
| Liveness probe | `GET /api/health` | `GET /live`. Allow about a minute of failures, as the Scout chart does (6 failures 10 seconds apart, each with a 5-second timeout): a very large scan can keep the worker from answering. |
| Readiness probe | `GET /api/health` | `GET /ready`, which succeeds once the worker is processing scans |

Without a worker, the dashboard accepts uploads but never shows them, and the CLI ends with `Error: The dashboard is still processing the scan after 5 minutes.`.

When the worker is stopped, it hands the scan it's processing back to the queue, which takes up to 30 seconds. Give its pods a termination grace period longer than that: the Scout chart uses 60 seconds. If a worker is killed before it finishes, another worker picks the scan up within a minute.

Both processes run as any non-root user with a read-only root filesystem, and in our tests neither wrote to disk. The Scout chart still mounts a small writable `/tmp` on each as a precaution, and you can do the same.

## 3. Set the environment

The web server needs:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `postgres://<user>:<password>@<host>:5432/<database>` |
| `AUTH_URL` | The address people reach the dashboard on, such as `https://scout.example.com`. It must match the host of the redirect URI you registered with your provider. |
| `AUTH_SECRET` | The session key |
| `OIDC_ISSUER_URL` | Your provider's issuer URL |
| `OIDC_CLIENT_ID` | The dashboard's client ID |
| `OIDC_CLIENT_SECRET` | The dashboard's client secret |
| `SCOUTUI_ADMINS`, `SCOUTUI_ADMIN_GROUP` | At least one: your admins' email addresses separated by commas, or a group in your sign-in provider whose members are Admins. See [Name the first admins](/docs/guides/manage-people-and-roles#name-the-first-admins). |
| `NODE_OPTIONS` | `--max-old-space-size=<megabytes>`, as in [step 5](#5-size-memory-and-the-database) |

The worker needs only `DATABASE_URL`, with the same value, and `NODE_OPTIONS`. It doesn't read the sign-in settings, so leave the session key and the client secret off it.

The password in `DATABASE_URL` must not contain `@`, `:`, `/`, `?`, `#` or `%`. `openssl rand -hex 24` makes one that doesn't. In Kubernetes, you can keep the password in a Secret and build the URL from it, as the Scout chart does:

```yaml title="Web server and worker containers"
env:
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: scout-secret
        key: POSTGRES_PASSWORD
  - name: DATABASE_URL
    value: "postgres://scout:$(POSTGRES_PASSWORD)@postgres.internal.example.com:5432/scout"
```

To connect over TLS, end the URL with `?sslmode=verify-full` or `?sslmode=no-verify`. [Connect to your Postgres over TLS](/docs/guides/deploy-the-dashboard#connect-to-your-postgres-over-tls) explains which to use, and [Trust your database's certificate authority](/docs/guides/deploy-the-dashboard#trust-your-databases-certificate-authority) how to add your provider's authority with `NODE_EXTRA_CA_CERTS` on both processes.

Optional settings on the web server:

| Variable | What it's for |
| --- | --- |
| `SCOUTUI_CI_UPLOAD_TOKEN` | A token that CI jobs upload with. See [Let CI upload](/docs/guides/deploy-the-dashboard#let-ci-upload). |
| `OIDC_ALLOWED_DOMAINS`, `SCOUTUI_REQUIRED_GROUP` | Who may sign in. See [Restrict who can sign in](/docs/guides/deploy-the-dashboard#restrict-who-can-sign-in), where they appear as `auth.oidc.allowedDomains` and `auth.requiredGroup`. |
| `SCOUTUI_TRUSTED_PROXY_HOPS` | The number of proxies in front of the dashboard. See [step 6](#6-configure-the-ingress-or-proxy). |
| `DATABASE_POOL_MAX` | Database connections per web server pod. Default 10. |

On the worker, `WORKER_DATABASE_POOL_MAX` sets its database connections per pod. It defaults to 3, which is also the minimum.

## 4. Let migrations run on start

Both processes apply pending database migrations when they start, before they report ready, so you need no separate migration job. They take a lock in the database first, so replicas that start together apply the migrations one at a time, and only the first finds any to apply.

Check the logs once the pods start:

- The web server logs `[startup] migrations: ...` with how many it applied, or `[startup] failed:` with the reason.
- The worker logs `[worker] started`, or `[worker] couldn't start:` with the reason.

To start without changing the schema, for example during a restore, set `MIGRATE_ON_START=false` on both processes. The worker then logs `[worker] waiting for database schema` until the schema is up to date, and `/ready` fails until then.

## 5. Size memory and the database

- **Memory.** Give each process a memory limit (the Scout chart uses 1 GiB), and set `NODE_OPTIONS=--max-old-space-size=<megabytes>` on both to about 80% of it, which is `819` for 1 GiB. Without it, Node.js keeps its heap to about 55% of the limit. In our tests, a 1 GiB worker processed scans at the 64 MiB upload limit with a peak of about 580 MiB, and Postgres ran within 512 MiB.
- **Database storage.** The database keeps every scan. A 5 MB `scout-scan.json` takes about 3.5 MiB, and a scan at the 64 MiB limit about 80 MiB. Each repo's latest scan takes a little more than twice as much. Size the database volume for the scan history you expect.
- **Database connections.** Keep this total below your database's connection limit:

  ```text
  web server pods × DATABASE_POOL_MAX (default 10)
  + worker pods × WORKER_DATABASE_POOL_MAX (default 3)
  + one per pod that is starting, for migrations
  + your other database clients
  ```

## 6. Configure the ingress or proxy

An upload can take up to 4 minutes: it waits up to a minute for the web server to start receiving it, then has 3 minutes to arrive. Whatever sits in front of the web server must:

- accept request bodies of at least 42 MiB, the largest upload the web server accepts;
- wait at least 240 seconds for the web server's response.

Otherwise the proxy rejects or cuts off large and slow uploads before the dashboard sees them. With ingress-nginx, for example, set these annotations on the Ingress:

```yaml title="Ingress"
metadata:
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: 42m
    nginx.ingress.kubernetes.io/proxy-read-timeout: "240"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "240"
```

CLI sign-in and CI uploads are rate limited per client address, which the web server reads from the `X-Forwarded-For` header. It assumes one proxy in front of it that adds to that header, such as an ingress controller. If there are more, set `SCOUTUI_TRUSTED_PROXY_HOPS` to the count on the web server. [Check client addresses behind a proxy](/docs/guides/deploy-the-dashboard#check-client-addresses-behind-a-proxy) shows how to count them, and how to check the result.

## 7. Verify

Open `https://scout.example.com`, sign in, and upload a scan, as in [step 5 of Deploy the dashboard](/docs/guides/deploy-the-dashboard#5-verify).

## Upgrade

Upgrade the dashboard before your teams upgrade the CLI ([Upgrade Scout](/docs/guides/upgrade-scout)).

Some upgrades need a step of their own. Each `web-app@<version>` release names the chart version that runs it. Before you upgrade, read the chart's [`CHANGELOG.md`](https://github.com/scoutui/scout/blob/main/charts/scout/CHANGELOG.md) from the version that runs your current image up to the one that runs the new image.

The web server needs `SCOUTUI_ADMINS` or `SCOUTUI_ADMIN_GROUP`. If you set neither, add one first, or it won't start and logs `[startup] failed: Set SCOUTUI_ADMINS to your admins' email addresses, or SCOUTUI_ADMIN_GROUP to a group in your sign-in provider.`

Then change the image tag on both Deployments. [Upgrade](/docs/guides/deploy-the-dashboard#upgrade) describes what happens to existing scans, and how to retry any that fail to rebuild.

## If you need to

### Load secrets from a file

If your platform puts secrets in a file inside the container instead of in environment variables, wrap each process's command in a shell that loads the file, and start Node.js with `exec`:

```yaml title="Web server container"
command: ["sh", "-c", "set -a && . /secrets/scout.env && exec node apps/web-app/server.js"]
```

```yaml title="Worker container"
command: ["sh", "-c", "set -a && . /secrets/scout.env && exec node apps/web-app/worker.cjs"]
```

- `set -a` exports every variable the file sets. Without it, Node.js sees only the variables that the file `export`s.
- `exec` replaces the shell with Node.js, so Node.js receives the stop signal. A shell that stays in place doesn't pass the signal on: the worker can't hand back its scan, and the pod waits out its whole grace period before it's killed.
- The file is shell syntax, one `KEY=value` per line, so put single quotes around a value that contains spaces, `$` or quotes. If the database password is only in the file, put the whole `DATABASE_URL` there too. Kubernetes fills in `$(POSTGRES_PASSWORD)` before the file is read, so it can't use a password from the file.

### Change an upload limit

Most deployments keep the defaults. To change a limit, set it on both processes: each checks every limit when it starts, and refuses to start if a value isn't a positive whole number.

| Variable | Default | Read by | What it limits |
| --- | --- | --- | --- |
| `SCOUTUI_MAX_UPLOAD_BYTES` | 44040192 (42 MiB) | Web server | Size of an upload as sent. Larger ones get `413`. |
| `SCOUTUI_MAX_STORED_UPLOAD_BYTES` | The value of `SCOUTUI_MAX_UPLOAD_BYTES` | Web server | Compressed size stored per upload. Larger ones get `413`. |
| `SCOUTUI_MAX_DECODED_ARTIFACT_BYTES` | 67108864 (64 MiB) | Worker | Size of the scan once decompressed. Larger ones fail. |
| `SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS` | 180000 | Web server | Time to receive one upload. Slower ones get `503`. |
| `SCOUTUI_UPLOAD_RECEIVE_SLOTS` | 1 | Web server | Uploads each web server pod receives at once. |
| `SCOUTUI_UPLOAD_SLOT_WAIT_MS` | 60000 | Web server | How long an upload waits for a free slot. Then it gets `503`. |
| `SCOUTUI_MAX_QUEUED_UPLOADS` | No limit | Web server | Uploads waiting or being processed, across all pods. More get `503`. |

The CLI retries a `503` by itself.

`SCOUTUI_UPLOAD_SLOT_WAIT_MS` plus `SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS` can be at most 270000, or both processes refuse to start. If you raise either, raise the proxy timeout from [step 6](#6-configure-the-ingress-or-proxy) to their sum. If you raise `SCOUTUI_MAX_UPLOAD_BYTES`, raise the proxy's body size limit to match.
