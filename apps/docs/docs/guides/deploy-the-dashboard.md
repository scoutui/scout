---
description: "Deploy the Scout dashboard and its worker to Kubernetes with the Helm chart, an OIDC identity provider and Postgres, then keep it running through upgrades."
sidebar_label: "Deploy the dashboard"
---

# Deploy the dashboard

Run a shared dashboard for your team on Kubernetes with the Scout Helm chart. The chart runs the web server, the *worker* (which [processes uploaded scans](/docs/explanation/cli-and-dashboard#after-upload) so they appear in the dashboard) and, unless you bring your own, a Postgres database. To try the dashboard on your own machine first, see [Run the dashboard locally](/docs/guides/run-the-dashboard-locally).

You need:

- A Kubernetes cluster with an ingress controller, and a TLS certificate for the dashboard's host.
- Helm 3, `kubectl` and `openssl`.
- An identity provider that speaks OpenID Connect (OIDC), such as Keycloak, Authentik, Zitadel, Okta or Google. A deployed dashboard has no dev sign-in. GitHub sign-in is not OIDC and does not work.

The examples use the host `scout.example.com` and the Helm release name `scout`.

## 1. Register the dashboard with your identity provider

Create a client for the dashboard in your identity provider:

1. Make it a confidential client, so it has a client secret.
2. Set the redirect URI to `https://scout.example.com/api/auth/callback/oidc`.
3. Allow the scopes `openid`, `email` and `profile`.
4. Note the issuer URL, the client ID and the client secret.

## 2. Create the Secret

Create a Kubernetes Secret with these three keys. The dashboard reads them by name, so keep the names exactly as shown:

```bash
kubectl create secret generic scout-secret \
  --from-literal=AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=OIDC_CLIENT_SECRET="<client secret from your identity provider>" \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"
```

`POSTGRES_PASSWORD` must not contain `@`, `:`, `/`, `?`, `#` or `%`; `openssl rand -hex` makes one that doesn't. On a GitOps cluster, create the same Secret with your own tooling instead.

## 3. Write the values

```yaml title="values.yaml"
ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: 42m
    nginx.ingress.kubernetes.io/proxy-read-timeout: "240"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "240"
  hosts:
    - host: scout.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - hosts: [scout.example.com]
      secretName: scout-tls

auth:
  # The dashboard's external address. It must match the redirect URI's host.
  url: "https://scout.example.com"
  sessionSecretRef:
    name: scout-secret
  oidc:
    issuerUrl: "https://sso.example.com/realms/acme"
    clientId: "scout"
    clientSecretRef:
      name: scout-secret
  admins: ["you@example.com"]

postgresql:
  enabled: true
  auth:
    existingSecret: scout-secret
```

Adjust the `ingress` block to your ingress controller and certificate. Whichever controller you use, it must accept request bodies of at least 42 MiB and wait at least 240 seconds for a response, or large uploads fail. The annotations above set that for ingress-nginx.

Use the address people reach the dashboard on for `auth.url`.

Set `auth.admins` to your admins' email addresses, or `auth.adminGroup` to a group in your sign-in provider: see [Name the first admins](/docs/guides/manage-people-and-roles#name-the-first-admins).

`postgresql.enabled: true` runs a bundled Postgres: a single pod with no backups or failover, which keeps its data on a 2Gi volume. For production, consider [your own Postgres](#use-your-own-postgres) instead.

:::warning
To give the bundled database a different volume size or storage class, set `postgresql.persistence.size` or `postgresql.persistence.storageClass` before the first install. Changing either later makes `helm upgrade` fail.
:::

## 4. Install the chart

```bash
helm install scout oci://ghcr.io/scoutui/charts/scout \
  --version <chart version> \
  -f values.yaml
```

`helm show chart oci://ghcr.io/scoutui/charts/scout` prints the latest chart version.

The web server applies database migrations when it starts, so there is no separate migrate step. Check that both processes started:

```bash
kubectl logs deploy/scout | grep '\[startup\]'
kubectl logs deploy/scout-worker | grep '\[worker\]'
```

The web server logs `[startup] migrations: ...` and the worker logs `[worker] started`. A process that can't start logs `[startup] failed:` or `[worker] couldn't start:` with the reason. If the worker isn't running, the dashboard accepts uploads but never shows them, and the CLI ends with `Error: The dashboard is still processing the scan after 5 minutes.`.

## 5. Verify

Open `https://scout.example.com` and press **Sign in with SSO**. After signing in with your provider you land on the repos list. If you don't:

- **The provider reports a redirect URI error.** The redirect URI from step 1 doesn't match `auth.url`.
- **`Your account doesn't have access to this dashboard. Ask your dashboard administrator to add you.`** Your [sign-in restrictions](#restrict-who-can-sign-in) turned the account away. The web server logs `[auth] sign-in denied for` with the email and the reason.
- **`Sign-in didn't complete. Try again.`** The web server's logs give the reason. A wrong `auth.oidc.issuerUrl` or client secret is the usual cause.

Then upload a scan from a repo that has its dependencies installed and the CLI set up. `scan` takes only a commit that's pushed to the remote's default branch, with no uncommitted changes apart from a new `scout.config.json` and scan file. If you added the CLI to `package.json`, commit and push that change, lockfile included, before you upload. [Upload flags](/docs/reference/cli#upload-flags) lists everything the upload checks.

Sign the CLI in, then scan and upload:

```bash
npx scout auth login --host https://scout.example.com
npx scout scan --host https://scout.example.com
```

The upload ends with `Uploaded the scan of <commit>: https://scout.example.com/repos/storefront`, and the repo appears on the repos list. If it stops with `Error: You can view this dashboard but not upload to it. Ask an Admin to make you an Editor.`, the dashboard didn't make you an Admin: see [If someone you named isn't an Admin](/docs/guides/manage-people-and-roles#if-someone-you-named-isnt-an-admin).

## Let CI upload

For CI jobs that upload without anyone signing in, add a `SCOUTUI_CI_UPLOAD_TOKEN` key to the Secret and restart the web server so it reads it:

```bash
token=$(openssl rand -hex 32)
kubectl patch secret scout-secret \
  -p "{\"stringData\":{\"SCOUTUI_CI_UPLOAD_TOKEN\":\"$token\"}}"
kubectl rollout restart deploy/scout
echo "$token"
```

Store the printed token as a secret in your CI system. [Run a scan and upload in CI](/docs/guides/run-in-ci) covers the rest.

## Upgrade

Upgrade the dashboard before your teams upgrade the CLI ([Upgrade Scout](/docs/guides/upgrade-scout)).

Some chart versions need a step of their own. Before you upgrade, download the new version and read every entry in `scout/CHANGELOG.md` newer than the version you run:

```bash
helm pull oci://ghcr.io/scoutui/charts/scout --version <chart version> --untar
```

The dashboard needs `auth.admins` or `auth.adminGroup`. If your values set neither, add one first ([Name the first admins](/docs/guides/manage-people-and-roles#name-the-first-admins)), or the upgrade fails with `Set auth.admins to your admins' email addresses, or auth.adminGroup to a group in your sign-in provider.`

Then upgrade with your values file:

```bash
helm upgrade scout oci://ghcr.io/scoutui/charts/scout \
  --version <chart version> \
  -f values.yaml
```

Migrations run when the new pods start. Some versions rebuild existing scans, which the worker does by itself unless the version's CHANGELOG entry says otherwise. While it does, some pages may show **Preparing scan data** ([what that means](/docs/explanation/cli-and-dashboard#scan-preparing)).

Admins named in `auth.admins` or `auth.adminGroup` become Admins at their next browser sign-in, so once the upgrade is done, have them sign out of the dashboard and sign in again.

### Retry scans that failed to rebuild

When a rebuild fails, pages say a repo's latest scan couldn't be prepared, or show **Scan data couldn't be prepared**. The same steps also retry chart numbers shown as **Numbers may be out of date**.

Fix the cause, then queue the failed rebuilds again. The rebuild command isn't in the container image, so run it from a clone of the Scout repository at the commit your image was built from, with Node.js 24. A different commit may find nothing to retry.

1. Find the commit the running web server's image was built from:

   ```bash
   image=$(kubectl get pods -l app.kubernetes.io/instance=scout,app.kubernetes.io/component=web-app \
     -o jsonpath='{.items[0].status.containerStatuses[0].imageID}')
   docker buildx imagetools inspect "${image#docker-pullable://}" \
     --format '{{ index .Image.Config.Labels "org.opencontainers.image.revision" }}'
   ```

2. Check out that commit, then install and build:

   ```bash
   git checkout <commit>
   corepack enable
   yarn install
   yarn turbo run build --filter=@scoutui/web-shared
   ```

3. In a second terminal, forward a local port to the bundled Postgres (skip this with your own Postgres):

   ```bash
   kubectl port-forward svc/scout-postgresql 15432:5432
   ```

4. Queue the failed rebuilds and wait for the worker to finish them. `<password>` is `POSTGRES_PASSWORD` from your Secret. With your own Postgres, put its host, port, user and database name in the URL, and end it with `?sslmode=<mode>` if you set `database.sslMode`.

   ```bash
   DATABASE_URL="postgres://scout:<password>@localhost:15432/scout" \
     yarn workspace @scoutui/web-app db:rebuild --retry-failed --wait
   ```

The command prints progress until every rebuild is ready, and lists any that fail again. If it stops with `No worker has claimed a job; is the worker running?`, check the worker's pod. `--help` lists the other options.

## If you need to

### Use your own Postgres

Create the database and a user that owns it. The dashboard creates its tables when it starts. Put that user's password in the Secret as `POSTGRES_PASSWORD`, then replace the `postgresql` block in your values:

```yaml title="values.yaml"
postgresql:
  enabled: false

database:
  host: postgres.internal.example.com
  port: 5432
  user: scout
  name: scout
  passwordSecretRef:
    name: scout-secret
```

### Connect to your Postgres over TLS

Managed services such as Amazon RDS (PostgreSQL 15 and later) require TLS by default, and reject the dashboard with `no pg_hba.conf entry ... no encryption` without it. Set `database.sslMode` next to `database.host`:

| `database.sslMode` | What the dashboard does |
| --- | --- |
| `verify-full` | Encrypts, and checks the server's certificate and host name against the certificate authorities Node.js trusts. Use it when your provider's certificate comes from a public authority, or once you [trust your provider's own authority](#trust-your-databases-certificate-authority). |
| `no-verify` | Encrypts without checking the certificate, so an impostor server would go unnoticed. Use it only when your provider signs with its own authority, as Amazon RDS and Google Cloud SQL do, and you haven't added that authority. `verify-full` fails there with `unable to verify the first certificate`. |
| `disable`, or unset | Connects without TLS. |

Set `verify-full` or `no-verify`. `require`, `prefer` and `verify-ca` behave like `verify-full`.

### Trust your database's certificate authority

To use `database.sslMode: verify-full` with a provider that signs with its own authority, such as Amazon RDS, give Node.js that authority's certificate. Put the provider's CA bundle in a ConfigMap:

```bash
kubectl create configmap db-ca --from-file=ca.pem=<path to the CA bundle>
```

Then mount it into the web server and the worker, and point `NODE_EXTRA_CA_CERTS` at it. The worker takes none of the web server's settings, so repeat them under `worker`:

```yaml title="values.yaml"
database:
  sslMode: verify-full

extraVolumes:
  - name: db-ca
    configMap:
      name: db-ca
extraVolumeMounts:
  - name: db-ca
    mountPath: /etc/db-ca
    readOnly: true
extraEnv:
  - name: NODE_EXTRA_CA_CERTS
    value: /etc/db-ca/ca.pem

worker:
  extraVolumes:
    - name: db-ca
      configMap:
        name: db-ca
  extraVolumeMounts:
    - name: db-ca
      mountPath: /etc/db-ca
      readOnly: true
  extraEnv:
    - name: NODE_EXTRA_CA_CERTS
      value: /etc/db-ca/ca.pem
```

### Add environment variables or volumes

`extraEnv`, `extraEnvFrom`, `extraVolumes` and `extraVolumeMounts` take the standard Kubernetes container and pod fields. At the top level they add to the web server, and under `worker` to the worker. The previous section shows them in use.

### Schedule the pods onto specific nodes

`nodeSelector`, `tolerations` and `affinity` take the standard Kubernetes pod fields. Set them at the top level for the web server, under `worker` for the worker, and under `postgresql` for the bundled database.

### Limit network traffic to the pods

Set `networkPolicy.enabled: true` to add NetworkPolicies that let traffic reach the web server only on its HTTP port, the worker only on its health port, and the bundled Postgres only from the web and worker pods. Outbound traffic isn't limited. Your cluster's network plugin must enforce NetworkPolicy, or the policies do nothing. With them on, a pod you run yourself, such as one for `pg_dump`, can't reach the bundled Postgres.

### Restrict who can sign in

Without a restriction, anyone your provider can authenticate can sign in. That's fine when your provider only lets your people use the application, for example by assigning them to it in Keycloak, authentik or Okta. With a public provider such as Google, it means anyone with a Google account.

To let in only your own email domains, set `auth.oidc.allowedDomains` to them, separated by commas, such as `"acme.com,acme.co.uk"`. The provider must mark the email as verified.

### Check client addresses behind a proxy

CLI sign-in and CI uploads are rate limited per client address. The dashboard reads that address from the `X-Forwarded-For` header, which proxies in front of it add to. If it reads the wrong entry, every caller may share one limit, or a caller can choose their own address to get around it.

1. Count the proxies in front of the dashboard that add an address to `X-Forwarded-For`. The default, 1, fits an ingress controller that adds the address it saw. With only an ingress controller in front of the dashboard, the default is right: skip to step 2 to check it.
   - A CDN or tunnel in front of the ingress, such as Cloudflare, adds one.
   - A cloud HTTP load balancer usually adds one.
   - A TCP load balancer adds none, so don't count it.
   - ingress-nginx replaces the header instead of adding to it, unless you set both `use-forwarded-headers` and `compute-full-forwarded-for` to `"true"` in its ConfigMap. Until you do, no count helps behind another proxy.

   If the count isn't 1, set it:

   ```yaml title="values.yaml"
   extraEnv:
     - name: SCOUTUI_TRUSTED_PROXY_HOPS
       value: "2"
   ```

2. From a machine outside your network, send sign-in requests until one is rejected. Each request carries a made-up address, `203.0.113.1`, the way a caller trying to dodge the limit would:

   ```bash
   for i in $(seq 1 500); do
     code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
       -H 'X-Forwarded-For: 203.0.113.1' \
       "https://scout.example.com/api/auth/cli/device-code")
     [ "$code" = 429 ] && echo "rejected after $i requests" && break
   done
   kubectl logs deploy/scout | grep '\[rate-limit\] rejected route=device-code'
   ```

3. Read the address at the end of the log line, `key=device-code:<address>`:
   - **Your machine's public address:** the count is right.
   - **`203.0.113.1`:** the count is too high, so callers can choose their own address. Lower it.
   - **A cluster or load balancer address:** the count is too low, or a proxy replaced the header instead of adding to it. Raise the count, or fix that proxy.

The check uses up that address's CLI sign-in limit for ten minutes, so run it before people start signing in.

### End sessions when people sign out of the provider

A browser session lasts up to 12 hours. A CLI sign-in lasts until 30 days pass without use, or 90 days after sign-in. Both keep working after the person signs out of the provider or loses access to it. If your provider sends OIDC back-channel logouts (Keycloak, Authentik and Zitadel do; Okta, Google and GitLab don't), the dashboard ends that person's browser sessions and CLI sign-ins when they sign out. Register this URL with the provider:

```text
https://scout.example.com/api/auth/backchannel-logout
```

- **Keycloak:** set **Backchannel logout URL** on the client.
- **Authentik** (2025.8 or later): on the OAuth2 provider, set **Logout URI** to the URL and **Logout Method** to **Back-channel**, and select a **Signing Key**.

:::warning
The provider must sign logout tokens with an asymmetric key (RSA or EC) that it publishes. Otherwise sign-in still works, but the dashboard rejects every logout. Authentik, for example, signs with the client secret when no **Signing Key** is selected. Check that your provider publishes at least one key:

```bash
curl -s "https://sso.example.com/realms/acme/.well-known/openid-configuration" \
  | jq -r .jwks_uri | xargs curl -s | jq '.keys | length'
```

A count of `0` means you need to set up a signing key on the provider.
:::

### Size the pods

- **Memory.** The web server, the worker and the bundled Postgres each default to a 1Gi limit (`resources.limits.memory`, `worker.resources.limits.memory`, `postgresql.resources.limits.memory`). Raise it if pods are killed for running out of memory.
- **Database connections.** Keep web replicas × `database.poolMax` (default 10), plus worker replicas × `worker.databasePoolMax` (default and minimum 3), plus one per pod starting during a rollout, below your database's connection limit.

### Reset a repository's remote {#reset-a-repositorys-remote}

When a repository is renamed or moved, the dashboard refuses its uploads with `Couldn't upload the scan: <repoId> on the dashboard comes from <address>.` Clear the remote it has for that `repoId`:

```bash
kubectl exec scout-postgresql-0 -- \
  psql -U scout -d scout -c "UPDATE repos SET git_remote = NULL WHERE repo_id = '<repoId>';"
```

It prints `UPDATE 1`. The next upload under that `repoId` records the remote it comes from, so make it from a clone of the renamed or moved repository. With your own Postgres, run the same statement against your database.

Clones made before the move still have the old address, so their uploads are refused after this; update them with `git remote set-url <remote> <new address>`.

### Check what the image contains

Each released image carries an SPDX software bill of materials and build provenance for each architecture. Read the bill of materials with:

```bash
docker buildx imagetools inspect ghcr.io/scoutui/scout-web-app:<version> \
  --format '{{ json (index .SBOM "linux/amd64").SPDX }}'
```

Replace `.SBOM` with `.Provenance` to see how and from which commit the image was built.

### Uninstall

`helm uninstall scout` leaves the bundled database's volume claim, `data-scout-postgresql-0`, in place. Installing again under the same release name picks up the same data. That database still expects the password it was created with, so keep the Secret too. To discard the data, delete the claim by hand.

### Deploy the image under a different chart

[Deploy the dashboard with your own chart](/docs/guides/deploy-with-your-own-chart) lists what the image needs from a chart other than this one.
