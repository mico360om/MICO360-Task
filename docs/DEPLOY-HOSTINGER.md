# Deploying MICO360 Tasks backend on Hostinger (task.mico360.com)

This is the runbook for the **503 Service Unavailable** you hit. The build
succeeded — the app was crashing on startup because required environment
variables were not set. Follow the steps below to fix it.

## What the 503 actually was

The Node process logged, on a restart loop:

```
Error: Invalid environment configuration:
  - DATABASE_URL: Required
  - JWT_ACCESS_SECRET: Required
  - JWT_REFRESH_SECRET: Required
```

`src/config/env.ts` validates the environment at startup and throws if these
are missing. When the app exits, LiteSpeed has no live backend to proxy to and
serves its own **"503 — the server is temporarily busy"** page. Fix = supply
the environment variables, then restart.

---

## Release package

`Installer/MICO360-Tasks-Server-Hostinger-<version>.zip` (built by `tools/release/build-release.mjs`)
contains everything for this runbook. `backend/` is the Node.js app root, with a `package-lock.json`
so `deploy.sh` installs the tested dependency versions with `npm ci`. `public_html/` is the built
web app for the site's web root, including `.well-known/`. `deploy/` holds the security-header
snippets.

## Fast path — one command (`deploy.sh`)

After creating an **empty** MySQL database in hPanel (Step 1 below), the single
script `deploy.sh` (in the backend app root) does everything else: configures
`DATABASE_URL`, installs deps, generates the Prisma client, builds, records any
migrations an existing database already contains, applies the rest to **create the
tables**, and creates the single admin. Run it on the server, inside the Node.js app
environment, from the backend app root:

```bash
ADMIN_PASSWORD='<a strong password>' DB_USER='u116607139_tasks' DB_PASSWORD='<database password>' DB_NAME='u116607139_tasks' bash deploy.sh
```

- Values given on the command line always win over an existing `.env`; changed values are
  written back to `.env` (quoted, so spaces and `<…>` are safe). Passwords may contain any
  character — they are URL-encoded into `DATABASE_URL`.
- Re-deploy when everything is already configured: `bash deploy.sh` (`ADMIN_PASSWORD` is only
  needed while no admin exists).
- Reset to a clean single-account state (⚠️ wipes all data):
  `RESET_DATA=1 CONFIRM_RESET=<database name> ADMIN_PASSWORD='…' bash deploy.sh`.
  The script refuses without the matching `CONFIRM_RESET` and takes a `mysqldump` backup to
  `~/mico360-data/backups/` first.
- Uploaded files are stored in `~/mico360-data/uploads` (outside the app folder) unless
  `UPLOAD_DIR` is set to another absolute path, so a redeploy into a new folder keeps them.
  Include that folder in backups.
- JWT secrets are auto-generated on first run and written to `.env`; copy them into
  hPanel Environment Variables so they stay stable across future deploys.

Then restart the Node app and verify `curl -i https://task.mico360.com/api/v1/health`.
The manual equivalent of these steps is documented below.

---

## Step 1 — Create the MySQL database

hPanel → **Databases → MySQL Databases**:

1. Create a database (e.g. `u116607139_tasks`).
2. Create a user (e.g. `u116607139_tasks`) with a strong password.
3. Add the user to the database with **ALL PRIVILEGES**.
4. Note the host — on Hostinger it is normally `localhost` (port `3306`).

Build the connection string:

```
mysql://u116607139_tasks:YOUR_DB_PASSWORD@localhost:3306/u116607139_tasks
```

## Step 2 — Set the environment variables

The exact values are prepared in `Web Portal/backend/.env.production`
(git-ignored). Two equivalent ways to apply them:

**A. hPanel UI (persists across redeploys — preferred)**
hPanel → **Websites → task.mico360.com → Advanced → Node.js →
Environment variables**, and add each `KEY = VALUE` from that file. At minimum:

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your Step 1 string |
| `JWT_ACCESS_SECRET` | (from `.env.production`) |
| `JWT_REFRESH_SECRET` | (from `.env.production`) |
| `API_BASE_URL` | `https://task.mico360.com` |
| `APP_URL` | `https://task.mico360.com` |
| `CORS_ORIGINS` | `https://task.mico360.com` |
| `TRUST_PROXY` | `loopback` (Hostinger's proxy runs on the same machine; without it every user shares one rate limit) |
| `SECRETS_ENCRYPTION_KEY` | 32+ random characters — encrypts AI provider keys at rest. Set it before go-live and never change it afterwards. |
| `UPLOAD_DIR` | an absolute folder outside the app, e.g. `/home/<user>/mico360-data/uploads` |
| `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` | the **rotated** Mailjet keys — without them sign-in codes, password-reset links and meeting invitations are disabled (the API answers 503 `EMAIL_NOT_CONFIGURED`) |
| `MAILJET_WEBHOOK_TOKEN` | a random secret; also put it in Mailjet's event-webhook URL (see `docs/EMAIL.md`). In production the webhook refuses every event until it is set. |

Optional: `FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_FILE` (Firebase service-account key —
turns on phone push), `ACCOUNT_LOCK_MINUTES` (first lockout length, default 15), `RATE_LIMIT_MAX` /
`AUTH_RATE_LIMIT_MAX` (per-minute limits, default 600 / 20), `AI_ALLOW_PRIVATE_HOSTS=true` (only for
an AI provider on the internal network, e.g. a local Ollama), `AI_USER_REQUESTS_PER_MINUTE` /
`AI_USER_REQUESTS_PER_DAY` (per-user AI budget, default 10 / 200).

**B. Upload a `.env` file**
Copy `Web Portal/backend/.env.production` into the Node.js app root (the
`nodejs/` folder that contains `dist/`) and rename it to `.env`. `dotenv/config`
loads it on boot. If Hostinger redeploys into a fresh versioned folder, re-copy
it — which is why the hPanel UI (option A) is more durable.

> Do **not** set `PORT`. Hostinger injects the port the app must listen on;
> `dotenv` won't override it, but a hardcoded `PORT` can break the proxy.

## Step 3 — Create the database tables (once)

Open **SSH** (hPanel → Advanced → SSH Access) and, from the Node.js app root:

```bash
npx prisma generate
node scripts/baseline-migrations.mjs          # lists migrations this database already contains
npx prisma migrate resolve --applied <name>   # once per name listed (none on an empty database)
npx prisma migrate deploy
```

This applies the committed migrations in `prisma/migrations` to the prod DB. The baseline step
matters for a database originally created with `prisma db push` (no migration history) — it
records what already exists so `migrate deploy` only adds what is missing, such as
`projects.ownerId` / `projects.imageUrl`. The `seed_builtin_roles` migration adds the ADMIN and
EMPLOYEE roles when they are missing; without them a brand-new database couldn't have staff added.
It is safe on databases that already have them. (If `prisma` isn't found, run `npm install` in the app
root first.)

## Step 4 — Create the first admin (once)

Still over SSH, from the app root:

```bash
ADMIN_EMAIL=you@mico360.com ADMIN_USERNAME=admin ADMIN_PASSWORD='<a strong password>' node dist/src/scripts/bootstrap.js
```

It's idempotent — it only creates an admin if no **active** admin exists. The password must be
at least 8 characters with a letter and a number. (If the compiled script isn't present, run
`npm run bootstrap` with the same env vars.) To reset a lost admin password later, use
`node dist/src/scripts/make-admin.js` with `ADMIN_EMAIL` and `ADMIN_PASSWORD` — the password is
required; there is no default.

## Step 5 — Restart and verify

Restart the Node.js app (hPanel Node.js panel → **Restart**). Then:

```bash
curl -i https://task.mico360.com/api/v1/health
```

Expect `200 OK`. Load `https://task.mico360.com` in a browser and sign in with
the admin from Step 4.

---

## Notes

- **Frontend:** the React build (`Web Portal/frontend`, `npm run build`) is
  served as static files at the domain root; `/api`, `/socket.io`, `/uploads`
  and `/email-assets` proxy to this Node backend. Copy the whole `dist/` folder,
  including `dist/.well-known/assetlinks.json` (Android password-reset links).
  See `deploy/nginx/` for the reference reverse-proxy config if you move off
  Hostinger's managed proxy.
- **Security headers:** merge `deploy/hostinger/htaccess-security-headers.txt`
  into the web root's existing `.htaccess` (don't replace the file). It adds
  HSTS, frame and content-type protection, a content security policy, and makes
  browsers always revalidate `index.html` after a deploy.
- **Email:** with `MAILJET_*` blank the app still runs and password sign-in works,
  but sign-in codes, password-reset links and meeting invitations are refused
  (503) instead of silently not arriving, and the startup log says so. Set the
  rotated keys before go-live.
- **Chrome extension CORS (optional):** to let the packed extension call the
  live API, append its origin to `CORS_ORIGINS`, e.g.
  `https://task.mico360.com,chrome-extension://<your-extension-id>`.
- **Secrets:** the JWT secrets in `.env.production` are freshly generated for
  this deploy. Keep them private; never commit them. `.env` / `.env.*` are
  git-ignored (only `.env.example` is tracked).
