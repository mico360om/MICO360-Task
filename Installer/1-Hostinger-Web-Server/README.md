# 1 · Hostinger web server — https://task.mico360.com

The live system on the internet. The Android app and the Chrome extension connect to this address
by default.

| In this folder | What it is |
| --- | --- |
| `MICO360-Tasks-Server-Hostinger-0.4.0.zip` | The server package: `backend/` (the API), `public_html/` (the web app), `deploy/` (security headers) and `docs/` |
| `environment.txt` | The live server's settings, ready to upload as its `.env`. **Private:** it holds this system's secret keys. It is not in git; keep it out of emails and chats. |
| `environment.example.txt` | The same settings without the secrets. `environment.txt` was made from it. |

The server starts with an empty database and one administrator: **khurram@prolens-team.com**
(username `khurram`). There are no test users, projects or tasks. Everyone else is added from
**Users** in the web app.

## First deployment

1. **Create the database.** hPanel → Databases → MySQL Databases:
   - create a database and a user with a strong password;
   - add the user to the database with **All Privileges**;
   - note the database name, the user name and the password.
2. **Upload the package.** Extract the zip, then:
   - upload `backend/` as the Node.js app root (hPanel → Websites → task.mico360.com → Advanced →
     Node.js). The app starts with `npm start`, which runs `dist/src/server.js`;
   - upload the contents of `public_html/`, including `.well-known/`, to the site's web root;
   - merge `deploy/hostinger/htaccess-security-headers.txt` into the web root's existing
     `.htaccess` (add to the file, don't replace it).
3. **Upload the settings.** Upload `environment.txt` into the app root and rename it to `.env`.
   Do not add `PORT`: Hostinger sets the port itself.
4. **Run the deployment command.** Open SSH (hPanel → Advanced → SSH Access), go to the app root
   with the Node.js environment active, and run this with your own values:

   ```bash
   DB_NAME='<database name>' DB_USER='<database user>' DB_PASSWORD='<database password>' ADMIN_PASSWORD='<your admin password>' bash deploy.sh
   ```

   It installs the tested dependency versions, builds the app, creates the tables and creates the
   administrator. The admin password needs 8 or more characters with a letter and a number. It is
   used once and not stored.
5. **Restart and check.** Restart the Node.js app in hPanel, then:
   - open `https://task.mico360.com/api/v1/health`; it should answer `"status":"ok"`;
   - open `https://task.mico360.com` and sign in as the administrator.
6. **Add the cron job.** hPanel → Advanced → Cron Jobs → Custom, every 15 minutes (`*/15 * * * *`):

   ```bash
   curl -fsS -o /dev/null https://task.mico360.com/api/v1/health
   ```

   Hostinger may stop an idle app. This keeps recurring tasks, reminders and the nightly
   carry-forward running when nobody has the site open.

## Still to set by you

- **Email.** Add your rotated Mailjet keys to `.env` as `MAILJET_API_KEY` and `MAILJET_SECRET_KEY`,
  then restart. Without them, sign-in works with a password, but email sign-in codes, password-reset
  emails and meeting invitations are off. Put the `MAILJET_WEBHOOK_TOKEN` value from `.env` into
  Mailjet's event-webhook address ([docs/EMAIL.md](../../docs/EMAIL.md)).
- **Phone app download from the site.** The site package's `public_html/downloads/MICO360-Tasks.apk`
  is the app; once `public_html/` is uploaded, the sign-in page's **Download for Android** button
  downloads `https://task.mico360.com/downloads/MICO360-Tasks.apk`. Nothing to set in `.env`. To
  publish a new build later, replace that one file (same name) — the address never changes. If the
  package was built without the APK, upload `../3-Android-App/MICO360-Tasks-0.4.0.apk` there under
  that name; until the file is there the button says "Not available yet".
- **Keep the settings across redeploys (recommended).** Copy every line of `.env` into hPanel →
  Node.js → Environment variables. Hostinger can redeploy into a fresh folder, and a new folder
  has no `.env`.

## If the live database already holds test data

This wipes everything and leaves only the administrator. It refuses to run without the exact
database name, and it writes a backup to `~/mico360-data/backups/` first.

```bash
RESET_DATA=1 CONFIRM_RESET='<database name>' ADMIN_PASSWORD='<your admin password>' bash deploy.sh
```

## Later updates

Upload the new `backend/` and `public_html/`, keep `.env`, run `bash deploy.sh` and restart. The
database is updated in place and your data is kept.

## Deploying from GitHub instead

Hostinger can build the app straight from the GitHub repository (hPanel → Websites → Node.js →
import a Git repository) instead of the package in this folder. Use these settings:

| Setting | Value |
| --- | --- |
| Repository / branch | `mico360om/MICO360-Task`, branch **`fix/audit-findings`** (the 0.4.0 code; `main` is still the older version until it is merged) |
| Node.js version | **22.x** (20.x works only from 20.19 on: an older Node 20 stops the server at start) |
| Root directory | the repository root |
| Build command | `npm run build` (it generates the database client, then builds the server and the web app) |
| Start command | `npm start` (it brings the database up to date, then starts the server) |

Environment variables (hPanel → the Node.js app → Environment variables):

- every line of `environment.txt` in this folder;
- `DATABASE_URL=mysql://<user>:<password>@localhost:3306/<database>`. If the password has special
  characters such as `@ : / # %`, write them URL-encoded, for example `@` as `%40`;
- `WEB_ROOT=../frontend/dist`, so the same app serves the web pages;
- `UPLOAD_DIR=/home/<your hPanel user>/mico360-data/uploads`, a folder outside the app, so
  uploaded files survive each redeploy;
- don't set `PORT`: Hostinger sets it.

On the first deployment only, create the administrator once over SSH, from the app's folder:

```bash
ADMIN_EMAIL='khurram@prolens-team.com' ADMIN_USERNAME='khurram' ADMIN_PASSWORD='<your admin password>' npm run bootstrap --workspace @mico360/backend
```

Coming from 0.3.0? Back up the database first. The first start applies the four new migrations, and
your data is kept.

The phone app is not in GitHub. To make **Download for Android** work, copy
`../3-Android-App/MICO360-Tasks-0.4.0.apk` to `Web Portal/frontend/dist/downloads/MICO360-Tasks.apk`
in the app's folder after each deployment. Each build replaces that folder.

## Do not run on the live server

- `tools/release/verify-server.mjs` (the acceptance test): it creates test users, projects and
  tasks. It is for a test install.
- The demo seed is not in this package. In the source it refuses to run in production or on a
  database with real accounts.

The full runbook, with every setting and the manual steps, is
[docs/DEPLOY-HOSTINGER.md](../../docs/DEPLOY-HOSTINGER.md).
