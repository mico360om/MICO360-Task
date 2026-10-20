# 1 · Hostinger web server — https://task.mico360.com

The live system on the internet. The Android app and the Chrome extension connect to this address
by default.

| In this folder | What it is |
| --- | --- |
| `MICO360-Tasks-Server-Hostinger-1.0.1.zip` | The server package: `backend/` (the API), `public_html/` (the web app), `deploy/` (security headers) and `docs/` |
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
  package was built without the APK, upload `../3-Android-App/MICO360-Tasks-1.0.1.apk` there under
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

Hostinger can build the app straight from the GitHub repository (hPanel → Websites → Add Website →
Node.js Web App, connected to GitHub) instead of the package in this folder. Use these settings:

| Setting | Value |
| --- | --- |
| Repository / branch | `mico360om/MICO360-Task`, branch **`main`** |
| Framework | **Fastify** (the server; it also serves the web app) |
| Node.js version | **22.x** (20.x works only from 20.19 on: an older Node 20 stops the server at start) |
| Root directory | leave empty: the repository root |
| Build script | `build`. It generates the database client, then builds the server and the web app |
| Output directory | leave empty |
| Entry file | `server.mjs`. It brings the database up to date, then starts the server, which serves the web pages too |
| Package manager | npm |

The repository's `.npmrc` (`include=dev`) makes the install bring the build tools (TypeScript, Vite)
even when `NODE_ENV=production` is among the environment variables. Without it the build stops with
"tsc: command not found".

Environment variables (hPanel → the Node.js app → Environment variables):

- every line of `environment.txt` in this folder;
- `DATABASE_URL=mysql://<user>:<password>@127.0.0.1:3306/<database>`. Use `127.0.0.1`, not
  `localhost`: on Hostinger, `localhost` can resolve to IPv6, which the database user isn't granted.
  If the password has special characters such as `@ : / # %`, write them URL-encoded, for example
  `@` as `%40`;
- `UPLOAD_DIR=/home/<your hPanel user>/mico360-data/uploads`, a folder outside the app, so
  uploaded files survive each redeploy;
- don't set `PORT`: Hostinger sets it. `WEB_ROOT` isn't needed: `server.mjs` serves the built web
  app.

**First administrator:** add `ADMIN_PASSWORD=<your admin password>` (8 or more characters with a
letter and a number) to the environment variables. On the next start `server.mjs` creates
`khurram@prolens-team.com` (username `khurram`) if no administrator exists yet; it never changes an
existing one. After you have signed in, delete `ADMIN_PASSWORD` from the variables. To use another
address or name, also set `ADMIN_EMAIL` and `ADMIN_USERNAME`. With SSH you can instead run this
once, from the app's folder:

```bash
ADMIN_EMAIL='khurram@prolens-team.com' ADMIN_USERNAME='khurram' ADMIN_PASSWORD='<your admin password>' npm run bootstrap --workspace @mico360/backend
```

Coming from 0.3.0? Back up the database first. The first start applies the four new migrations, and
your data is kept.

The phone app is not in GitHub. To make **Download for Android** work, upload the signed APK from
`../3-Android-App/` to `/home/<your hPanel user>/mico360-data/downloads/` under the name
`MICO360-Tasks.apk` (hPanel → File Manager). That folder sits beside `uploads/`, outside the app,
so every deployment keeps it; the server makes it at start-up and serves the file there at once,
before any copy in the web build. For a new release, replace that one file. (`DOWNLOADS_DIR` in the
environment variables names another folder, if ever needed.)

## Updating the live site

The live site is the GitHub-built Node.js app above. There are two ways to put a new version on it:

- **From GitHub:** hPanel → Websites → task.mico360.com → Node.js → **Redeploy**. It builds branch
  `main` again.
- **From a file:** `MICO360-Tasks-<version>-NodeApp-<commit>.zip` in this folder is the repository at
  that commit. It holds the same files the GitHub build uses: about 3.4 MB, with no `node_modules`
  and no `.env`. In the Node.js app's deployment settings:
  - upload it as an archive instead of using GitHub;
  - keep the settings in the table above: Node 22, build script `build`, entry file `server.mjs`,
    root directory empty;
  - leave the environment variables as they are.

  To make a new one: `git archive --format=zip -o <file>.zip <commit>`.

Then check `https://task.mico360.com/api/v1/projects/x/meetings-overview`. An answer of 401
(sign-in needed) means the new version is live; 404 means the old one is still running.

## Do not run on the live server

- `tools/release/verify-server.mjs` (the acceptance test): it creates test users, projects and
  tasks. It is for a test install.
- The demo seed is not in this package. In the source it refuses to run in production or on a
  database with real accounts.

The full runbook, with every setting and the manual steps, is
[docs/DEPLOY-HOSTINGER.md](../../docs/DEPLOY-HOSTINGER.md).
