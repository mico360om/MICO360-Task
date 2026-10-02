# 2 · Windows office server

A complete MICO360 Tasks server on one Windows 10/11 (64-bit) computer, for an office without a
hosting account. Node.js, MySQL 8.0, the API, the web app and the Android app are all inside the
installer. No administrator rights are needed.

| In this folder | What it is |
| --- | --- |
| `MICO360-Tasks-Server-Setup-0.3.0.exe` | The installer (about 175 MB) |

The server starts with an empty database and the one administrator you create in step 3. There are
no test users, projects or tasks.

## Install

1. Run `MICO360-Tasks-Server-Setup-0.3.0.exe`.
2. Choose:
   - the **program folder** and the **data folder** (put the data folder on a disk that is backed up);
   - the **port** (4000 unless something else uses it);
   - **Allow other computers and phones on the office network to connect**, if colleagues and
     phones should reach this computer.
3. Create the first administrator:
   - Email: `khurram@prolens-team.com`
   - Username: `khurram`
   - Password: your admin password (8 or more characters with a letter and a number).
4. Click **Finish**. The server starts and the web app opens at `http://localhost:4000`.

When Windows asks whether **Node.js** may use the network, allow **private networks**.

## Scripted install (IT)

The administrator comes from environment variables, never from the command line:

```bat
set MICO360_ADMIN_EMAIL=khurram@prolens-team.com
set MICO360_ADMIN_USERNAME=khurram
set MICO360_ADMIN_PASSWORD=<your admin password>
MICO360-Tasks-Server-Setup-0.3.0.exe /S /D=C:\MICO360\Server /DATA=D:\MICO360Data /PORT=4000 /AUTOSTART /LAUNCH
```

## After installing

- The server runs while its **tray icon** is present. Right-click it to open the app, show the
  **office network address**, back up the database, edit settings, restart or stop.
- **Phones:** open the office network address in the phone's browser and tap **Download for
  Android** on the sign-in page. In the app, tap **Server: … · Change** and enter that address.
- **Chrome extension:** on its sign-in screen choose **Advanced: change server** and enter
  `http://localhost:4000` on this computer, or the office network address on other computers.
- **Email:** add your Mailjet keys under tray icon → **Edit server settings**, then **Restart the
  server**. Without them, password sign-in works; email codes, password-reset emails and meeting
  invitations are off.

Updating means running a newer Setup; your data is kept. Uninstall from Windows Settings → Apps
(the data folder is kept unless you tick "Also delete all data").

The full guide, including settings, backups, moving to another computer and troubleshooting, is
[docs/WINDOWS-SERVER.md](../../docs/WINDOWS-SERVER.md).

## Antivirus note

The programs aren't code-signed yet, so an antivirus may warn about them. This build was scanned
with Kaspersky and found clean. For customers, sign the programs with a code-signing certificate.
