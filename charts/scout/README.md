# Scout Helm chart

Deploys the [Scout](https://scoutui.dev) dashboard to Kubernetes: the web server people sign in to, the worker that processes uploaded scans, and optionally a bundled Postgres.

## Install

[Deploy the dashboard](https://scoutui.dev/docs/guides/deploy-the-dashboard) walks through registering Scout with your identity provider, creating the Secret and writing your values. Then install:

```bash
helm install scout oci://ghcr.io/scoutui/charts/scout --version <chart version> -f values.yaml
```

Before you upgrade, read the entries in [`CHANGELOG.md`](CHANGELOG.md) newer than the version you run. Some versions need a step of their own.

## Values you set

| Value | What it's for |
| --- | --- |
| `auth.url` | The address people reach the dashboard on |
| `auth.sessionSecretRef` | The Secret that holds the session key |
| `auth.oidc.issuerUrl`, `auth.oidc.clientId`, `auth.oidc.clientSecretRef` | Sign-in through your OpenID Connect provider |
| `ingress` | How traffic reaches the web server |
| `postgresql.enabled` or `database.host` | The bundled Postgres, or your own |
| `auth.requiredGroup`, `auth.oidc.allowedDomains` | Who may sign in, when your provider doesn't decide that itself |

[`values.yaml`](values.yaml) lists every value with its default.

## What runs

Both Deployments run the same image, `ghcr.io/scoutui/scout-web-app`, with different commands.

- **Web server** (`node apps/web-app/server.js`) serves the dashboard and receives uploads. It sits behind the Service and ingress, and its probes call `/api/health` on port 3000.
- **Worker** (`node apps/web-app/worker.cjs`) processes uploaded scans from a queue in Postgres, one at a time. It has no Service. Its probes use port 3001: `/live` answers while the process responds, and `/ready` answers once the schema is ready and the worker is processing. The startup probe uses `/live`, so a slow migration doesn't cause a restart loop.
- **Postgres** (with `postgresql.enabled: true`) is a single pod with a 2Gi volume and no backups or failover. For production, use [your own Postgres](https://scoutui.dev/docs/guides/deploy-the-dashboard#use-your-own-postgres).

Both processes apply database migrations when they start, under a lock, so only one runs them. With `database.migrateOnStart: false`, the worker waits for the schema, checking every 5 seconds, and never changes it itself.

## Shutdown

On shutdown, the worker stops taking new scans and returns the one it's processing to the queue. It has 30 seconds for that (`worker.shutdownTimeoutMs`) inside a 60-second grace period (`worker.terminationGracePeriodSeconds`), so keep the grace period longer. If a worker stops without returning its scan, another worker picks it up after 60 seconds.

The worker's liveness probe allows six failures 10 seconds apart. If one very large scan keeps the worker busy for longer, raise `worker.livenessProbe` and `worker.readinessProbe` together.

## Resources

- The web server, the worker and Postgres each default to a 1 GiB memory limit. The web and worker pods get a 64 MiB writable `/tmp`.
- The worker has its own settings (`worker.resources`, `worker.nodeMaxOldSpaceSizeMb`, `worker.replicaCount`). Its Node heap defaults to 819 MB, about 80% of its memory limit.
- Keep database connections below Postgres's `max_connections`, counting the extra pods a rolling update starts:

  ```text
  web pods × database.poolMax (default 10)
  + worker pods × worker.databasePoolMax (default and minimum 3)
  + one per pod that is starting
  + your other database clients
  ```

## Upload limits

The web server accepts an upload with `202` as soon as it's stored. The worker checks it afterwards, and an upload that turns out to be invalid or too large shows as failed in its status, which the CLI waits for and reports.

To change a limit, set it on both Deployments with `extraEnv` and `worker.extraEnv`. The web server and the worker refuse to start if a value isn't a positive whole number.

| Variable | Default | Read by | What it limits |
| --- | --- | --- | --- |
| `SCOUTUI_MAX_UPLOAD_BYTES` | 44040192 (42 MiB) | web | Size of an upload as sent; larger ones get `413` |
| `SCOUTUI_MAX_STORED_UPLOAD_BYTES` | same as above | web | Compressed size stored per upload; larger ones get `413` |
| `SCOUTUI_MAX_DECODED_ARTIFACT_BYTES` | 67108864 (64 MiB) | worker | Size of the scan once decompressed; larger ones fail |
| `SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS` | 180000 | web | Time to receive one upload; slower ones get `503` |
| `SCOUTUI_UPLOAD_RECEIVE_SLOTS` | 1 | web | Uploads each web pod receives at once |
| `SCOUTUI_UPLOAD_SLOT_WAIT_MS` | 60000 | web | How long an upload waits for a free slot before `503` |
| `SCOUTUI_MAX_QUEUED_UPLOADS` | no limit | web | Uploads waiting or being processed, across all pods; more get `503` |

`SCOUTUI_UPLOAD_SLOT_WAIT_MS` plus `SCOUTUI_UPLOAD_RECEIVE_TIMEOUT_MS` must be at most 270000, because Node drops a request that is still arriving after 300 seconds. The CLI retries a `503` itself. A `429` means the uploader hit the rate limit.

## Database

- With the bundled Postgres, the password comes from the Secret named by `postgresql.auth.existingSecret`, or one the chart generates, under the key `postgresql.auth.passwordKey`. With your own database, it comes from `database.passwordSecretRef`.
- The worker only needs the database. It doesn't read the sign-in or session secrets.

To see the upload queue, run this against the database:

```sql
SELECT state, count(*) FROM scan_jobs GROUP BY state ORDER BY state;
```

## Rebuilding scan data

Some upgrades change how the dashboard stores what it shows. The worker finds scans that need rebuilding when it starts and every 5 minutes, and rebuilds them newest first while the dashboard keeps serving what it has. An upgrade needs no manual step unless its [`CHANGELOG.md`](CHANGELOG.md) entry says so.

To rebuild by hand, follow [Retry scans that failed to rebuild](https://scoutui.dev/docs/guides/deploy-the-dashboard#retry-scans-that-failed-to-rebuild). It runs from a clone of the repository at the commit your image was built from, with `DATABASE_URL` pointing at the dashboard's database, and only queues the work for a running worker:

```bash
yarn turbo run build --filter=@scoutui/web-shared
yarn workspace @scoutui/web-app db:rebuild --wait
```

| Option | Effect |
| --- | --- |
| `--wait` | Waits for the rebuilds to finish, printing progress |
| `--timeout <seconds>` | How long `--wait` waits (default 1800) |
| `--scan <id>` | Rebuilds only this scan; repeat it for more |
| `--repair` | Also rebuilds scans that look up to date |
| `--retry-failed` | Tries failed rebuilds again, once you've fixed the cause |

With `--wait`, it exits `0` when every rebuild is done, `1` when any failed, and `2` when it ran out of time.

## Running the image under another chart

See [Deploy the image under a different chart](https://scoutui.dev/docs/guides/deploy-the-dashboard#deploy-the-image-under-a-different-chart). Keep the worker in its own Deployment, so a large scan can't take memory from the web server.
