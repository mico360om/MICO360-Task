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

## Fast path — one command (`deploy.sh`)

After creating an **empty** MySQL database in hPanel (Step 1 below), the single
script `deploy.sh` (in the backend app root) does everything else: configures
`DATABASE_URL`, installs deps, generates the Prisma client, builds, applies all
migrations to **create the tables**, and creates the single admin. Run it on the
server, inside the Node.js app environment, from the backend app root:

```bash
ADMIN_PASSWORD='Welcome@123' DB_USER='u116607139_tasks' DB_PASSWORD='YOUR_DB_PASS' DB_NAME='u116607139_tasks' bash deploy.sh
```

- Re-deploy when env vars are already set in hPanel: `ADMIN_PASSWORD='…' bash deploy.sh`
- Reset to a clean single-account state: prefix `RESET_DATA=1` (⚠️ wipes all data).
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
npx prisma migrate deploy
```

This applies the committed migrations in `prisma/migrations` to the prod DB.
(If `prisma` isn't found, run `npm install` in the app root first, or use
`npx prisma@5 migrate deploy`.)

## Step 4 — Create the first admin (once)

Still over SSH, from the app root:

```bash
ADMIN_EMAIL=you@mico360.com ADMIN_USERNAME=admin ADMIN_PASSWORD='a-strong-password' node dist/src/scripts/bootstrap.js
```

It's idempotent — it only creates an admin if none exists. (If the compiled
script isn't present, run `npm run bootstrap` with the same env vars.)

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
  served as static files at the domain root; `/api`, `/socket.io` and
  `/uploads` proxy to this Node backend. See `deploy/nginx/` for the
  reference reverse-proxy config if you move off Hostinger's managed proxy.
- **Email is optional.** With `MAILJET_*` blank the app runs; OTP,
  password-reset and invite emails simply won't send until you add rotated
  Mailjet keys. Sign-in with an existing user does not need email.
- **Chrome extension CORS (optional):** to let the packed extension call the
  live API, append its origin to `CORS_ORIGINS`, e.g.
  `https://task.mico360.com,chrome-extension://<your-extension-id>`.
- **Secrets:** the JWT secrets in `.env.production` are freshly generated for
  this deploy. Keep them private; never commit them. `.env` / `.env.*` are
  git-ignored (only `.env.example` is tracked).
