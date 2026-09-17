# MICO360 Tasks — Production Deployment

## Prerequisites

- **Node.js 20+**
- **MySQL 8** (managed instance or self-hosted)
- A place to run a long-lived Node process (VM, container, PaaS) behind an HTTPS reverse proxy
- A **Mailjet** account (for OTP, password-reset and notification emails)

## 1. Configure environment

Copy `Web Portal/backend/.env.example` to `Web Portal/backend/.env` and set real values. **Never commit `.env`.**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `mysql://user:pass@host:3306/mico360` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | long random strings (rotate periodically) |
| `JWT_ACCESS_TTL_SECONDS` | access-token lifetime (default `900` = 15 min; silently refreshed) |
| `JWT_REFRESH_TTL_SECONDS` | refresh-token lifetime — **default `2592000` = 30 days**, so web/mobile/extension stay signed in for a month without re-login |
| `CORS_ORIGINS` | comma-separated web/extension origins |
| `APP_URL` | public web app URL (used to build password-reset links) |
| `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` | from Mailjet; **rotate the secret shared during planning** |
| `MAIL_FROM` | a verified Mailjet sender |
| `UPLOAD_DIR` | local disk path for attachments (or swap the storage adapter for S3) |
| `UPLOAD_MAX_BYTES`, `UPLOAD_MAX_TOTAL_BYTES_PER_TASK`, `UPLOAD_ALLOWED_MIME` | upload limits |

## 2. Install & build

```bash
npm ci
npm run prisma:generate --workspace @mico360/backend
npm run build            # builds all workspaces
```

## 3. Database

Committed SQL migrations under `Web Portal/backend/prisma/migrations/` are the **source of
truth** for the production (MySQL) schema. Apply them with:

```bash
# Apply committed migrations to the production database (fresh or existing)
npx --workspace @mico360/backend prisma migrate deploy
```

CI exercises this exact command against a throwaway MySQL 8 before every merge, so a migration
that fails to apply fails the build rather than the deploy.

> **Baselining an existing production DB.** If your prod database predates migrations (its
> schema was created with `prisma db push`), baseline it **once** so `migrate deploy` doesn't
> try to recreate existing tables:
> ```bash
> npx --workspace @mico360/backend prisma migrate resolve --applied 0_init
> ```
> A brand-new/empty database needs no baselining — `migrate deploy` creates everything.

> **Dual-provider note (important for future schema changes).** Migrations are generated for
> **MySQL** (`prisma/schema.prisma`, the production provider — see `prisma/migrations/migration_lock.toml`).
> Local development runs on **PostgreSQL** (`prisma/schema.postgres.prisma`) and uses
> `prisma db push` (no migration history) — that's fine for local work. To author a **new**
> migration after editing the models, mirror the change into **both** schema files, then
> generate the migration against MySQL (e.g. the `docker-compose.yml` MySQL, or any MySQL 8):
> ```bash
> DATABASE_URL='mysql://root:mico@127.0.0.1:3306/mico360' \
>   npx --workspace @mico360/backend prisma migrate dev --name your_change
> ```
> Commit the new folder under `prisma/migrations/`. (Offline fallback without a DB:
> `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`.)

Do **not** run `db:seed` in production (it is dev sample data). Instead create the first admin:

```bash
ADMIN_EMAIL=you@company.com ADMIN_USERNAME=admin ADMIN_PASSWORD='a-strong-password-1' \
  npm run bootstrap --workspace @mico360/backend
```

`bootstrap` is idempotent — it does nothing if an admin already exists.

## 4. Run

```bash
node "Web Portal/backend/dist/src/server.js"   # API + Socket.IO on PORT (default 4000)
# or, from the backend folder:  npm start
```

Serve the built frontend (`Web Portal/frontend/dist`) as static files from your CDN/reverse proxy, and
point it at the API with `VITE_API_URL` at build time.

## 5. Operations

- **Health/monitoring**: `GET /api/v1/health` (liveness + uptime) and `GET /api/v1/metrics`
  (uptime, memory) — wire these into your uptime monitor.
- **Logs**: the server emits structured JSON log lines (one per event) — ship them to your
  aggregator (CloudWatch, Loki, Datadog, …).
- **Scaling Socket.IO**: to run more than one API instance, add the Redis adapter
  (`@socket.io/redis-adapter`) so real-time events fan out across instances (see `docs/CD.md`).
- **Uploads**: the default stores attachment files on local disk under `UPLOAD_DIR`. For
  multi-instance or durable storage, implement the `AttachmentStorage` port against S3/GCS and
  wire it in `server.ts` — no service changes needed.
- **TLS**: terminate HTTPS at your proxy; never expose the API over plain HTTP in production.

## 6. Chrome extension

Set the extension's API base to your production API URL, then package/publish `Extension/` via
the Chrome Web Store (or load unpacked for internal use). The extension keeps its own session:
it stores the access + refresh tokens and silently refreshes on a 401, so it stays signed in for
the full 30-day refresh window (matching web/mobile).

## 7. Mobile app (Android — Expo/EAS)

The app is a standalone Expo project under `Android App/` (not an npm workspace).

```bash
cd "Android App"
npm ci
npx expo export --platform android      # sanity bundle (CI does this)
npx eas build --platform android --profile production   # requires an Expo/EAS account
```

- Set the production API base via the `apiBaseUrl` value in `app.json`'s `extra` (or the EAS env).
- Profiles live in `eas.json` (dev/preview APK, production app-bundle + submit).
- **Sessions**: the app persists the session in the secure keystore and silently refreshes, so users
  stay signed in for 30 days. **Biometric sign-in**: users can enable fingerprint/face in Settings to
  unlock the app and to sign back in without a password (the refresh token is held behind the OS keystore).
- FCM push + Sentry are pluggable seams — wire real credentials before store release.
