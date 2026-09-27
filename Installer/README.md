# MICO360 Tasks 0.2.0 — release packages

Built from this repository by `node tools/release/build-release.mjs` (Windows installer, Hostinger
package, extension) and `bash tools/release/build-apk.sh` (Android). The binaries are not committed
to git; rebuild them with those commands. `SHA256SUMS.txt` lists the checksum of every file.

| File | For | Install |
| --- | --- | --- |
| `MICO360-Tasks-Server-Setup-0.2.0.exe` | Windows 10/11 (64-bit): a complete MICO360 Tasks server on one computer | Run it; see below |
| `MICO360-Tasks-0.2.0.apk` | Android 6.0+ phones | Copy to the phone and open it (allow "install unknown apps" once) |
| `MICO360-Tasks-Chrome-Extension-0.2.0.zip` | Chrome / Edge | Upload to the Chrome Web Store, or unzip and "Load unpacked" |
| `MICO360-Tasks-Server-Hostinger-0.2.0.zip` | Hostinger or any Linux host with Node.js 20+ and MySQL 8 | See its `README.txt` and `docs/DEPLOY-HOSTINGER.md` |

## Windows server — `MICO360-Tasks-Server-Setup-0.2.0.exe`

Everything is included: Node.js, MySQL 8.0, the API and the web app. No administrator rights are
needed.
1. Run the installer.
2. Choose the folders, the port, and whether other computers and phones on the office network may
   connect.
3. Create the first administrator.
4. MICO360 Tasks opens at `http://localhost:4000`, and a tray icon lets you open it, show the office
   network address, back up the database, edit settings, restart or stop.

Updating means running a newer Setup; your data is kept. Uninstall from Windows Settings → Apps.
The full guide, including silent installs, is [docs/WINDOWS-SERVER.md](../docs/WINDOWS-SERVER.md).

## Android app — `MICO360-Tasks-0.2.0.apk`

Package `com.mico360.tasks`, version 0.2.0 (build 2). It is signed with the same key as 0.1.0, so it
installs as an update.
- It connects to `https://task.mico360.com` by default.
- To use a Windows server on the office network, tap **Server: … · Change** on the sign-in screen and
  enter its address, for example `192.168.1.20:4000`.

## Chrome extension — `MICO360-Tasks-Chrome-Extension-0.2.0.zip`

Manifest V3, version 0.2.0. It connects to `https://task.mico360.com` by default. For a Windows
server, choose **Advanced: change server** on its sign-in screen:
- `http://localhost:4000` on the server computer itself;
- the office network address on other computers.

To install without the Web Store:
1. Unzip the file.
2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Click **Load unpacked** and choose the unzipped folder.

## Hostinger server — `MICO360-Tasks-Server-Hostinger-0.2.0.zip`

- `backend/`: the API source for `deploy.sh`. It includes a `package-lock.json`, so the install is
  reproducible with `npm ci`.
- `public_html/`: the built web app, including `.well-known/assetlinks.json`.
- `deploy/`: the nginx and `.htaccess` security headers.
- `docs/`: the runbooks.

Before go-live, set the rotated Mailjet keys, `MAILJET_WEBHOOK_TOKEN`, `SECRETS_ENCRYPTION_KEY` and
`TRUST_PROXY=loopback`.

## What's new in 0.2.0

- All 115 findings from the September 2026 audit are fixed: security, data correctness, Arabic and
  time zones, email, the mobile app and the extension.
- New self-contained Windows server with its own installer, tray launcher and backups.
- The Android app and the Chrome extension can connect to an office-network server.
- New databases get the built-in ADMIN and EMPLOYEE roles from a migration. Before this, an
  administrator on a brand-new installation couldn't add staff.
- Arabic text in the Chrome extension takes its own reading direction, so names like
  "مشروع الإطلاق 2026" display correctly.

## How these builds were tested (27 September 2026)

- **Unit and component tests**: backend 1,120 · web 490 · Android 310 · extension 169, all passing,
  with typecheck and lint clean.
- **Windows installer**:
  - Silent install, then start: the server answered in about 20 s.
  - Upgrade over a running server: it stopped the server, kept the data and applied the new
    migration on start.
  - Interactive wizard (welcome → options → administrator → install → finish), driven through the
    real window controls.
  - Silent and interactive uninstall, with the data kept or deleted.
  - After each install, `tools/release/verify-server.mjs` passed 48 of 48 checks. They cover the web
    app and its security headers, sign-in, users, Arabic projects and tasks, attachments, CSV/PDF/Excel
    reports, chat with live updates, meetings with an Arabic minutes PDF, and permissions.
- **Web app on the Windows server** (browser): sign in, dashboard, board, and a new Arabic task with
  an assignee; no console errors.
- **Android APK** on an Android 14 emulator against the Windows server:
  - An insecure public `http://` address is refused.
  - Switching to the office server and signing in work.
  - The dashboard, projects and board show Arabic names.
  - A task created on the phone arrived on the server correctly.
  - A task created on the server appeared live on the phone.
  - The server and session were remembered after a restart.
- **Chrome extension zip** in Chrome 154:
  - It loaded as an unpacked extension and its service worker started.
  - Switching to the Windows server and signing in over CORS worked.
  - Projects and board showed the Arabic data correctly, with no script errors.
- **Hostinger package** on a clean folder and a fresh MySQL 8.0 database:
  - `npm ci` from the package lockfile, then build.
  - `migrate deploy` applied 8 migrations; the drift check found no difference.
  - Bootstrap, then the acceptance test passed 48 of 48.
  - The roles migration was also applied to a database originally built with `db push`.
