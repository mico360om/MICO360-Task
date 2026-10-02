# MICO360 Tasks Server for Windows

`Installer/2-Windows-Office-Server/MICO360-Tasks-Server-Setup-<version>.exe` installs a complete MICO360 Tasks server on one
Windows 10/11 (64-bit) computer: the web app, the API that the phone app and Chrome extension use,
and its own MySQL database. Node.js, MySQL 8.0 and the Microsoft C++ runtime are bundled, so nothing
else needs installing. Administrator rights are not needed: the installer is per-user, like the
Chrome or VS Code user installers.

Use it to run MICO360 Tasks inside an office without a hosting account. For the public site
(task.mico360.com) use the Hostinger package instead ([DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md)).

## Install

1. Run `MICO360-Tasks-Server-Setup-<version>.exe`. The wizard asks for:
   - **Program folder** — default `%LOCALAPPDATA%\Programs\MICO360 Tasks Server`.
   - **Data folder** — the database, uploaded files, backups, logs and settings. Default
     `%LOCALAPPDATA%\MICO360 Tasks Server`. Keep it outside the program folder; choose a disk that
     is backed up.
   - **Web address port** — default 4000.
   - **Office network** — tick "Allow other computers and phones on the office network to connect"
     to let colleagues and the phone app reach this computer. Untick it to keep the server private
     to this computer.
   - **The first administrator** — name, email, username and password (8+ characters with a letter
     and a digit). Everyone else is added later from **Users** in the web app.
2. Setup copies the files (about 400 MB), creates the database and the administrator (about a
   minute), and adds Start-menu shortcuts and an Apps & features entry.
3. On **Finish** the server starts and the web app opens at `http://localhost:4000`.

When Windows asks whether **Node.js** may use the network, allow **private networks** (only needed
when office-network access is on).

## Daily use

The server runs while the **tray icon** (MICO360 check mark, next to the clock) is present. Start it
from the Start menu → **MICO360 Tasks Server**. Right-click the tray icon for:

| Menu item | What it does |
| --- | --- |
| Open MICO360 Tasks | Opens `http://localhost:<port>` |
| Office network address… | Shows (and copies) the address for other computers and phones, e.g. `http://192.168.1.20:4000` |
| Back up the database now | Writes `backups\mico360-<date>-<time>.sql` in the data folder |
| Open data folder / Open logs folder | Explorer at those folders |
| Edit server settings | Opens `config\server.env` in Notepad (see below) |
| Restart the server | Restarts the web server, e.g. after changing settings |
| Stop the server and exit | Stops the web server and shuts MySQL down cleanly |

The server also does timed work while it runs, even when nobody has the web app or phone app open:
it makes the copies of recurring tasks set to repeat "on each date", and it sends due-date
reminders. Leave it running, or choose the start-at-sign-in option.

If the web server stops unexpectedly it is restarted automatically (up to three times in ten
minutes). Setup's "Start the server automatically when I sign in to Windows" option starts it in the
tray at sign-in without opening a browser.

### Connecting the phone app and the Chrome extension

- **Android app**: staff can install it from the server itself — open the office network address
  in the phone's browser and tap **Download for Android** on the sign-in page (the installer includes
  the APK). In the app, tap **Server: task.mico360.com · Change** on the sign-in screen, enter the
  office network address (e.g. `192.168.1.20:4000`) and tap **Use this server**. The app checks that
  the server answers before it switches.
- **Chrome extension**: on its sign-in screen choose **Advanced: change server** and enter
  `http://localhost:4000` on this computer, or the office network address on other computers. Chrome
  asks once for access to that address.

Plain `http://` is accepted only for this computer and private office-network addresses (10.x,
172.16–31.x, 192.168.x, `*.local`). Anything on the internet must use `https://`.

## Settings (`config\server.env`)

Edit with the tray icon → **Edit server settings**, save, then **Restart the server**.

| Setting | Meaning |
| --- | --- |
| `PORT` | Web address port. |
| `HOST` | `0.0.0.0` = this computer and the office network; `127.0.0.1` = this computer only. |
| `APP_URL`, `API_BASE_URL` | The address people use; it appears in emailed links (password reset). |
| `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAIL_FROM` | Email. Without keys, sign-in codes, password-reset emails and meeting invitations are off; password sign-in works. |
| `COMPANY_TIMEZONE` | Company time zone for due dates and reports (default `Asia/Muscat`). |
| `UPLOAD_DIR` | Optional other folder for uploaded files. |

`DATABASE_URL`, the `JWT_*` secrets and `SECRETS_ENCRYPTION_KEY` were generated for this server.
Changing a JWT secret signs everyone out. Never change `SECRETS_ENCRYPTION_KEY`, because stored AI
provider keys can't be read afterwards. Keep this file private.

## Data, backups and moving to another computer

The data folder holds everything: `mysql\` (the database), `uploads\` (attachments and pictures),
`backups\`, `logs\` and `config\`. For a complete backup, use **Back up the database now** and copy
the `uploads` folder. For a full copy of a stopped server, stop it and copy the whole data folder.

To move to another computer, stop the server, copy the data folder, run Setup on the new computer
and choose the copied folder as its data folder. Setup finds the existing database and keeps it.

## Updating

Run the newer Setup. It finds the installation, stops the running server, replaces the program files
and keeps the data folder. The database is updated (migrations) the next time the server starts.

## Uninstall

Windows Settings → Apps → **MICO360 Tasks Server** → Uninstall, or Start menu → **Uninstall MICO360
Tasks Server**. The data folder is kept unless you tick "Also delete all data".

## Scripted installs (IT)

```bat
set MICO360_ADMIN_EMAIL=admin@example.com
set MICO360_ADMIN_USERNAME=admin
set MICO360_ADMIN_PASSWORD=<strong password>
MICO360-Tasks-Server-Setup-<version>.exe /S /D=C:\MICO360\Server /DATA=D:\MICO360Data /PORT=4000
```

Options: `/S` silent · `/D=` program folder · `/DATA=` data folder · `/PORT=` · `/LOCALONLY` (this
computer only) · `/NODESKTOP` · `/NOSHORTCUTS` · `/AUTOSTART` · `/LAUNCH` (start after installing).
The administrator is read from the environment, never from the command line. Exit code 0 means
installed; the log is `%TEMP%\MICO360TasksServer-setup.log`.

- Stop the server: `"MICO360 Tasks Server.exe" --stop`.
- Start it without a browser: `"MICO360 Tasks Server.exe" --no-browser`.
- Silent uninstall: `Uninstall.exe /S` (add `/DELETEDATA` to remove the data folder too).

## Troubleshooting

- **"Port 4000 is already used by another program"**: change `PORT` in `config\server.env`, or close
  the other program.
- **Other computers can't connect**: check that `HOST=0.0.0.0`, that Windows Firewall allows Node.js
  on private networks, and that the device uses the address shown under **Office network address…**.
- **Logs** (tray icon → Open logs folder):
  - `launcher.log`: start, stop and set-up steps.
  - `server.log`: the web server.
  - `mysql-error.log`: the database.
  - `migrate.log`: database updates.

## How it is built

`tools/release/build-release.mjs windows` assembles the payload:
- `node\` (Node.js runtime);
- `mysql\` (MySQL 8.0 server and client tools plus the Visual C++ runtime);
- `app\backend` (compiled API, production dependencies and the Prisma engines for Windows);
- `app\web` (the built web app, served by the API through `WEB_ROOT`, with the Android APK under
  `downloads\`).

The launcher (`MICO360 Tasks Server.exe`), `Uninstall.exe` and Setup are small C# programs in
`tools/release/windows` for the .NET Framework 4.x built into Windows. Setup carries the payload as
an embedded zip.
