# Hosting the live version at task.mico360.com

Single-domain setup: **nginx** on `task.mico360.com` serves the built web app and reverse-proxies
`/api`, `/socket.io` and `/uploads` to the backend (Fastify on `:4000`). The frontend therefore
calls the API **same-origin** (`/api/v1`) — no CORS gymnastics. See
[`deploy/nginx/task.mico360.com.conf`](../deploy/nginx/task.mico360.com.conf) and
[`DEPLOYMENT.md`](DEPLOYMENT.md) (build/DB/ops details) alongside this.

```
Browser ── https://task.mico360.com ──► nginx ─┬─ /            → /var/www/task.mico360.com (web app)
                                                ├─ /api/*       → 127.0.0.1:4000  (Fastify API)
                                                ├─ /socket.io/* → 127.0.0.1:4000  (realtime, WS)
                                                └─ /uploads/*   → 127.0.0.1:4000  (attachments)
```

## 1. DNS

Create one record at your DNS provider, pointing the subdomain at the server's public IP:

| Type | Name | Value |
|------|------|-------|
| `A` | `task` (→ `task.mico360.com`) | your server's IPv4 |
| `AAAA` _(optional)_ | `task` | your server's IPv6 |

If you front it with Cloudflare, you can proxy it (orange cloud) and use Cloudflare TLS instead of
certbot in step 4 — then nginx can listen on 80 only. Verify propagation: `dig +short task.mico360.com`.

## 2. Backend environment (`Web Portal/backend/.env`)

Set these production values (full list in [`DEPLOYMENT.md`](DEPLOYMENT.md); never commit `.env`):

```dotenv
NODE_ENV=production
PORT=4000
API_BASE_URL=https://task.mico360.com      # absolute URLs for uploads/emails
APP_URL=https://task.mico360.com           # base for password-reset links
CORS_ORIGINS=https://task.mico360.com      # the web origin (the extension uses host permissions, not CORS)
DATABASE_URL=mysql://USER:PASS@DB_HOST:3306/mico360
JWT_ACCESS_SECRET=<long random>            # generate: openssl rand -hex 32
JWT_REFRESH_SECRET=<different long random>
MAILJET_API_KEY=<key>
MAILJET_SECRET_KEY=<rotated secret>        # rotate the one shared during planning
MAIL_FROM="MICO360 Tasks <no-reply@mico360.com>"
```

## 3. Build & run

```bash
npm ci
npm run build                              # frontend build picks up .env.production → VITE_API_URL=/api/v1
npx --workspace @mico360/backend prisma migrate deploy
# first run only — create the admin:
ADMIN_EMAIL=you@mico360.com ADMIN_USERNAME=admin ADMIN_PASSWORD='a-strong-password' \
  npm run bootstrap --workspace @mico360/backend

# Deploy the web build where nginx serves it:
sudo mkdir -p /var/www/task.mico360.com
sudo cp -r "Web Portal/frontend/dist/." /var/www/task.mico360.com/

# Run the API as a long-lived service (pm2 or systemd):
pm2 start "Web Portal/backend/dist/src/server.js" --name mico360-api   # binds PORT=4000
```

## 4. nginx + TLS

```bash
sudo cp deploy/nginx/task.mico360.com.conf /etc/nginx/sites-available/task.mico360.com
sudo ln -s /etc/nginx/sites-available/task.mico360.com /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot

# Issue the certificate (webroot matches the ACME location in the conf):
sudo certbot certonly --webroot -w /var/www/certbot -d task.mico360.com
#   (or simply:  sudo certbot --nginx -d task.mico360.com  to let certbot edit nginx)

sudo nginx -t && sudo systemctl reload nginx
```

certbot installs a renewal timer automatically; confirm with `sudo certbot renew --dry-run`.

## 5. Verify

- `https://task.mico360.com` loads the app (HTTP redirects to HTTPS).
- `https://task.mico360.com/api/v1/health` returns `200`.
- Sign in → dashboard loads; open a board → realtime works (WebSocket upgrade over `/socket.io`).
- An uploaded attachment opens at `https://task.mico360.com/uploads/...`.

## 6. The other surfaces (already pointed at this domain)

- **Android app** — the production flavor now targets `https://task.mico360.com/api/v1`
  (`src/lib/flavors.json` + `eas.json`), and deep links resolve `https://task.mico360.com/...`
  (`RootNavigator`). Build: `APP_ENV=production npx eas build --platform android --profile production`.
- **Chrome extension** — `https://task.mico360.com/*` is in `manifest.json` host permissions; after
  install, set **Settings → Backend → API base URL** to `https://task.mico360.com/api/v1` (and Web
  app URL to `https://task.mico360.com`). Publishing to a fixed backend? change the defaults in
  `Extension/src/config.js`.

## 7. Notes

- Terminate TLS at nginx (or Cloudflare) — never expose `:4000` publicly.
- For accurate client IPs in rate-limiting behind the proxy, enable Fastify `trustProxy`.
- Multi-instance API needs the Socket.IO Redis adapter and shared/object storage for uploads
  (see [`DEPLOYMENT.md`](DEPLOYMENT.md) §5 and [`CD.md`](CD.md)).
