# 3 · Android app

| In this folder | What it is |
| --- | --- |
| `MICO360-Tasks-0.3.0.apk` | The Android app for phones with Android 6.0 or newer (about 70 MB) |

Package `com.mico360.tasks`, version 0.3.0 (build 3). It is signed with the same key as 0.1.0 and
0.2.0, so it installs as an update over them.

## Install on a phone

1. Copy the APK to the phone, or download it there.
2. Open it and allow **Install unknown apps** when Android asks (once).
3. Open **MICO360 Tasks** and sign in.

## Which server it uses

- **Live system:** it connects to `https://task.mico360.com` out of the box. Nothing to change.
- **Windows office server:** tap **Server: … · Change** on the sign-in screen, enter the office
  network address (for example `192.168.1.20:4000`) and tap **Use this server**. The app checks
  that the server answers before it switches.

## Giving it to staff

- **From the live site:** upload this APK to the web server as
  `public_html/downloads/MICO360-Tasks.apk` and set `ANDROID_APP_URL=/downloads/MICO360-Tasks.apk`
  (see `../1-Hostinger-Web-Server/README.md`). The sign-in page's **Download for Android** button
  then serves it.
- **From an office server:** nothing to do. The Windows installer already includes this APK, and
  the office server's sign-in page offers it.

## Not included

- **Push notifications** need a Firebase service-account key on the server (`FCM_SERVICE_ACCOUNT_JSON`
  or `FCM_SERVICE_ACCOUNT_FILE`). Without it the app still shows notifications when it is open.
- **Google Play:** this APK is for direct installation. A Play Store release needs an app bundle
  and a Play Console account ([Android App/RELEASE.md](../../Android%20App/RELEASE.md)).

To rebuild: `MICO360_KEYSTORE_PASSWORD='…' bash tools/release/build-apk.sh` (needs the release
keystore, which is kept out of git).
