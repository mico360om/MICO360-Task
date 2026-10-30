# Backups

MICO360 Tasks makes its own backup copies. This page says what they hold, where they are kept, how to
download one, how to send them to Google Drive, and — step by step — how to restore one.

**Restoring replaces data, so it is never a button in the app.** It is done deliberately, on the server,
with the restore tool described below — ideally with someone who has done it before.

## What a copy holds

- **The whole database**: every table — tasks, projects, meetings and minutes, inspections, chat, users,
  settings, the audit log. It is read as one moment, so the copy is consistent even while people work.
- **Every uploaded file**: attachments, pictures, project logos, chat and meeting files (the `UPLOAD_DIR`
  folder).
- A list of contents with checksums, so the restore can prove every table and every file came back exactly.

Not in a copy:

- the Android app file (the downloads folder) — it is in every release package;
- **the server's settings** (`.env`, the hPanel environment variables, or the Windows server's
  `config\server.env`). Keep those somewhere safe as well: a restored database on a *new* server needs
  the same `SECRETS_ENCRYPTION_KEY` (or, without one, the same `JWT_ACCESS_SECRET`) to read the stored AI
  provider keys and the Google Drive connection. Other settings can be made again.

## When copies are made

- **Every night from 02:00, company time** (Oman time unless `COMPANY_TIMEZONE` says otherwise). If the
  server was off at 02:00, the copy is made as soon as it is running again that day.
- The nightly copy is on for both real servers — the Hostinger site and the Windows server run with
  `NODE_ENV=production` — and off on development, QA and test servers (their copies would land in the
  repository). `BACKUP_NIGHTLY=true` / `false` says otherwise.
- If a nightly copy fails, it is tried again an hour later, three tries a night. When the third fails, every
  administrator gets an email (if email is set up) and System Settings shows the reason — also when the
  server was stopped part-way through a copy (a restart, a deployment, too little memory). A copy that
  works is quiet.
- If no new copy has been made for a day and a half (the server isn't running at night, say), System
  Settings says so and the administrators get **one** email about it; the next good copy resets it.
- A copy still running after 3 hours is stopped and counts as a failed try, so a stuck disk can't block
  the next ones.
- An administrator can make one at any time: **System Settings → Backups → Back up now**. It takes a few
  minutes on a busy server; the page says when it is ready.
- On Hostinger the app can be paused when nobody uses it. The cron job in
  [DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md) (Step 6) keeps it running, so the nightly copy happens.

For scale: a test company with 129,000 rows and 150 MB of files made a **152 MB copy in about
8 seconds** and restored it in about 30 seconds on an ordinary PC.

## What is kept

- **The last 7 nights**, plus **one copy a week for the 4 weeks before** (the last copy of each week,
  following the company week in System Settings) — so about five weeks back.
- **The 3 newest copies made with "Back up now"**, on top of those. Pressing it never pushes out a
  nightly copy — useful if you press it *after* noticing a mistake.
- Older copies are deleted automatically: on the server **and** in Google Drive.

Room needed: about 14 copies, each roughly the size of the uploaded files plus the compressed database.
System Settings → Backups shows how many copies are kept on the server and how much room they take in
all.

Before each copy the server checks the free disk space (it needs about the uploads plus the database,
and a fifth more). **On shared hosting such as Hostinger, that check may see the whole disk of the
shared machine rather than your plan's own limit**, so it can pass while the plan is nearly full; the
copy then fails with "The server's disk is full." and the administrators are told. Look at the plan's
use now and then in hPanel: the website's **Dashboard** shows *Disk usage* (and *Inodes*, the number of
files) against the plan's limit; **Files → File Manager** shows what `mico360-data/backups` takes. If it
gets close, upgrade the plan or remove old uploads — not the newest backup copies.

## Where they are kept

In a private folder on the server, **never** one the website serves:

| Server | Folder |
| --- | --- |
| Hostinger (task.mico360.com) | `~/mico360-data/backups`, beside `~/mico360-data/uploads` |
| Windows server | `backups` in the data folder (default `%LOCALAPPDATA%\MICO360 Tasks Server\backups`) |

The folder is `BACKUP_DIR` when that setting is filled in; otherwise it is a `backups` folder beside the
uploads folder. The server refuses to put copies inside the uploads folder or the web app, and — on a
real server (`NODE_ENV=production`) — inside the app folder, which a new deployment replaces: each copy
then fails with that reason in System Settings (and the nightly failure email). Set `BACKUP_DIR`, or an
absolute `UPLOAD_DIR` outside the app, to fix it. On other servers System Settings only warns. Copies are named
`mico360-tasks-backup-<date>-<time>-<code>.tar.gz` (`.tar.gz.enc` when encrypted). Only files with
these names are ever deleted — the Windows tray's own `mico360-….sql` dumps are left alone.

## Downloading a copy

System Settings → **Backups** (administrators only) lists the kept copies: date, size, nightly / weekly /
Back up now, and whether it reached Google Drive. **Download** saves the file straight to your computer
(the link works once, for two minutes). Every download is recorded in the Audit Logs (module
`backups`). A copy holds everything, including password hashes — keep downloaded copies private.

An unencrypted copy is a normal `.tar.gz`: 7-Zip or Windows' `tar` can open it to look inside
(`manifest.json`, `database/<table>.jsonl`, `files/…`).

## Encrypting the copies (optional)

Set `BACKUP_ENCRYPTION_KEY` to a long passphrase (16 characters or more) and restart. From then on every
copy is encrypted (AES-256), on the server and in Google Drive; System Settings says so.

> **Write the key down in two safe places away from the server** (for example a password manager and a
> sealed paper copy). Without it, **no encrypted copy can ever be restored** — nobody, including us, can
> open them. If the server is lost, the key on it is lost with it.

If you change the key, keep the old one until the old copies have gone (about five weeks): each copy
needs the key that was set when it was made. Copies made before the key was set stay unencrypted.

## Google Drive (one-time setup)

Each new copy can also go to the owner's own Google Drive, into a folder called **MICO360 Tasks
backups**. The app asks only for Google's `drive.file` permission: it can see and change **only the files
it puts there** — nothing else in the Drive. The same 7 + 4 (+ 3) rule is applied there.

### 1. Make the Google sign-in for the app (once, in Google Cloud)

1. Go to <https://console.cloud.google.com>, signed in with the owner's Google account. Create a project,
   e.g. **MICO360 Tasks**.
2. **APIs & Services → Library**: search for **Google Drive API** and press **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience):
   - User type: **External**.
   - App name **MICO360 Tasks**, support email and developer email: the owner's.
   - Scopes (Data access): add **`.../auth/drive.file`** only.
   - **Audience → Publishing status: press "Publish app" so it says "In production".** While it says
     "Testing", Google stops the connection after 7 days and backups stop reaching Drive. With only the
     `drive.file` scope Google does not need to review the app.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name **MICO360 Tasks server**.
   - **Authorized redirect URIs**: `https://task.mico360.com/api/v1/backups/google/callback`
     (for the Windows server see below).
   - Press **Create** and copy the **Client ID** and **Client secret**.

### 2. Give them to the server

- **Hostinger**: hPanel → Websites → task.mico360.com → Node.js → **Environment variables**: add
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with the two values, then **Restart**.
- **Windows server**: tray icon → **Edit server settings**, add the two lines, save, then **Restart the
  server**. Google only accepts `https://` addresses or `localhost` for this, so also add
  `http://localhost:<port>/api/v1/backups/google/callback` as a second redirect URI in step 1.4, put
  `GOOGLE_REDIRECT_URI=http://localhost:<port>/api/v1/backups/google/callback` in the settings, and do the
  connecting below **on the server computer itself**, at `http://localhost:<port>`.

The client secret is a secret: keep it out of emails and chats.

### 3. Connect

System Settings → Backups → **Connect Google Drive** → choose the owner's Google account → **Allow**.
You come back to System Settings: "Google Drive is connected", "Connected as <the account>". The next copy
goes to Drive too, and each copy in the list shows ✓ Sent to Google Drive.

- The connection is stored encrypted on the server (with `SECRETS_ENCRYPTION_KEY`).
- **Disconnect** stops new copies going to Drive and takes the app's access back at Google; copies already
  in Drive stay there.
- If the owner removes the app's access in their Google account (or the Google client is deleted),
  System Settings says "Google Drive no longer accepts this connection" and the administrators get an
  email after the next nightly copy. Press **Connect again**.
- If someone deletes the folder in Drive, the next copy makes it again.

## Restoring a copy

The restore tool puts a copy into a database **that you name**, and its files into a folder that you
name. The safe way, described here, is **side by side**: restore into a *new* database and a *new* files
folder, then point the app at them and restart. The live data is not touched until you switch, so you can
switch back.

What the tool does: it checks the whole copy against its checksums first (a damaged or incomplete copy is
refused before anything changes), refuses a database that already holds tables (unless `--force`, which
wipes it) and a files folder that already holds files (unless `--force-files` — asked for separately),
refuses a copy made by a newer version of the app (update the app first), creates the tables
exactly as they were when the copy was made, loads every table, writes every file, then reads everything
back and compares it with the copy. It ends with "✔ Restored … Every table and file was read back and
matches the copy."

To check a copy without restoring it (no database needed):
`npm run backup:restore -- <copy file> --check` (add `--key-file <file>` for an encrypted copy).

### On Hostinger (task.mico360.com)

1. **Make an empty database**: hPanel → Databases → **MySQL Databases** → create one (for example
   `u116607139_restored`) and add the app's existing database user to it with **All privileges**. (The
   tool can't create databases on Hostinger.)
2. **Have the copy on the server**: the copies are already in `~/mico360-data/backups`. For a downloaded
   copy, upload it there with hPanel → File Manager.
3. **Open SSH** (hPanel → Advanced → SSH Access) with the Node.js environment active, as for `deploy.sh`,
   and go to the app's folder (the one with `server.mjs`).
4. **Give the tool the database address**: the hPanel environment variables are not visible in SSH, so
   make a private settings file, then put the `DATABASE_URL` value from hPanel into it (and
   `BACKUP_ENCRYPTION_KEY`, if copies are encrypted):

   ```bash
   install -m 600 /dev/null ~/restore.env
   nano ~/restore.env        # DATABASE_URL=mysql://…   (one setting per line)
   ```

5. **Check the copy**, then **restore it**:

   ```bash
   npm run backup:restore -- ~/mico360-data/backups/<copy file> --check --env-file ~/restore.env
   npm run backup:restore -- ~/mico360-data/backups/<copy file> --into u116607139_restored --files-into ~/mico360-data/uploads-restored --env-file ~/restore.env
   ```

6. **Switch**: hPanel → Node.js → Environment variables: change `DATABASE_URL` to end in
   `/u116607139_restored`, and `UPLOAD_DIR` to `/home/<your hPanel user>/mico360-data/uploads-restored`.
   Press **Restart**. If the restored copy came from an older version of the app, the start-up brings it up
   to date by itself.
7. **Check** the site: sign in, open a few projects and tasks with attachments.
8. Delete `~/restore.env` (`rm ~/restore.env`). Keep the old database and the old uploads folder until you
   are sure; then delete them in hPanel / File Manager.

### On the Windows server

The server must be running (its database is used). Below, `<program>` is the program folder (default
`%LOCALAPPDATA%\Programs\MICO360 Tasks Server`), `<data>` the data folder (default
`%LOCALAPPDATA%\MICO360 Tasks Server`) and `<port>` the database port `MICO360_MYSQL_PORT` in
`<data>\config\server.env`. Open **Command Prompt**:

1. **Make an empty database** with the bundled MySQL:

   ```bat
   "<program>\mysql\bin\mysql.exe" --defaults-extra-file="<data>\config\mysql-admin.cnf" --host=127.0.0.1 --port=<port> -e "CREATE DATABASE mico360_restored CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON mico360_restored.* TO 'mico360'@'localhost'; GRANT ALL PRIVILEGES ON mico360_restored.* TO 'mico360'@'127.0.0.1';"
   ```

2. **Restore** (the copies are in `<data>\backups`; a downloaded copy can be anywhere):

   ```bat
   "<program>\node\node.exe" "<program>\app\backend\dist\src\scripts\backup-restore.js" "<data>\backups\<copy file>" --into mico360_restored --files-into "<data>\uploads-restored" --env-file "<data>\config\server.env"
   ```

3. **Switch**: tray icon → **Edit server settings**: change the end of `DATABASE_URL` from `/mico360` to
   `/mico360_restored`, and set `UPLOAD_DIR=<data>\uploads-restored`. Save, then tray icon → **Restart the
   server**.
4. Check the app; keep the old database and `uploads` folder until you are sure.

### Replacing the live database in place (only with help)

`--into <the live database> --force` wipes that database and restores the copy into it. Stop the app first.
The tool refuses the live database without `--force`, and with it waits 10 seconds (press Ctrl+C to
stop). Writing the files into the live uploads folder needs `--force-files` as well. Prefer the
side-by-side way above.

If a restore stops part-way (the disk fills, the connection drops), the tool says so: the database you
restored into — and the files folder, when files were written — then hold only part of the copy. Don't
use them: empty them (or make a new, empty database and folder) and run the restore again.

### Messages you may see

| Message | What to do |
| --- | --- |
| The database "…" is not empty | Make a new, empty database (step 1), or add `--force` to wipe that one. |
| The folder … is not empty | Give a new, empty folder to `--files-into`, or add `--force-files` to write into that one. |
| … now holds only part of the copy | The restore stopped part-way (the reason comes first). Empty that database (and folder), or use new ones, and restore again. |
| The database "…" doesn't exist, and it couldn't be made here | Create it first (step 1). |
| This copy was made by a newer version of MICO360 Tasks | Update the app first, then restore. |
| This copy is locked with a backup key | Add `--key-file <file with the key>`, or `BACKUP_ENCRYPTION_KEY` in the settings file. |
| That backup key does not open this copy | Use the key that was set when the copy was made. |
| The backup file is incomplete / damaged | Use another copy (the day before, or the Google Drive one). |

## Settings

| Setting | Meaning |
| --- | --- |
| `BACKUP_DIR` | Where copies are kept. Blank = `backups` beside `UPLOAD_DIR`. Must be private, outside the app. |
| `BACKUP_ENCRYPTION_KEY` | Optional passphrase (16+ characters) that encrypts every copy. See the warning above. |
| `BACKUP_NIGHTLY` | Blank = on when `NODE_ENV=production` (the Hostinger site, the Windows server), off on other servers. `true` / `false` says otherwise. Back up now works either way. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Google sign-in made in "Google Drive (one-time setup)". Blank = no Google Drive. |
| `GOOGLE_REDIRECT_URI` | Only when it differs from `API_BASE_URL` + `/api/v1/backups/google/callback` (the Windows server). |

`npm run backup:create` makes a copy from the command line, the same as Back up now (on the Windows
server: `"<program>\node\node.exe" "<program>\app\backend\dist\src\scripts\backup-create.js" --env-file
"<data>\config\server.env"`).
