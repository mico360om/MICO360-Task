# 1 · Hostinger web server — https://task.mico360.com

The live system on the internet. The Android app and the Chrome extension connect to this address
by default.

| In this folder | What it is |
| --- | --- |
| `MICO360-Tasks-Server-Hostinger-0.3.0.zip` | The server package: `backend/` (the API), `public_html/` (the web app), `deploy/` (security headers) and `docs/` |
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
- **Phone app download from the site (optional).** Upload
  `../3-Android-App/MICO360-Tasks-0.3.0.apk` as `public_html/downloads/MICO360-Tasks.apk`, add
  `ANDROID_APP_URL=/downloads/MICO360-Tasks.apk` to `.env`, and restart.
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

## Do not run on the live server

- `tools/release/verify-server.mjs` (the acceptance test): it creates test users, projects and
  tasks. It is for a test install.
- The demo seed is not in this package. In the source it refuses to run in production or on a
  database with real accounts.

The full runbook, with every setting and the manual steps, is
[docs/DEPLOY-HOSTINGER.md](../../docs/DEPLOY-HOSTINGER.md).
