# 4 · Chrome extension

| In this folder | What it is |
| --- | --- |
| `MICO360-Tasks-Chrome-Extension-<version>.zip` | The extension for Chrome and Edge 116 or later (Manifest V3) |

## Install without the Web Store

1. Unzip the file into a folder that will stay where it is.
2. Open `chrome://extensions` (in Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the unzipped folder.
5. Click the MICO360 icon and sign in.

## Update it

Chrome doesn't update an extension loaded this way. When the server has a newer version, the
extension says so at the top of the app ("A newer version of MICO360 Tasks… is available") and in
**Settings → About**, which also shows both versions.

1. Unzip the new file **over the same folder**, replacing the old files.
2. Open `chrome://extensions` and press **Reload** on MICO360 Tasks.

You stay signed in, and changes waiting to sync are kept. (Loading it from a different folder
installs a second copy, which starts signed out.)

## Publish to the Chrome Web Store

Upload the zip as it is in the Chrome Web Store developer dashboard. It contains only the
extension's own files (no tests, no source maps).

## Which server it uses

- **Live system:** it connects to `https://task.mico360.com` out of the box.
- **Windows office server:** on the sign-in screen choose **Advanced: change server** and enter
  `http://localhost:4000` on the server computer, or the office network address on other
  computers. Chrome asks once for access to that address.

Plain `http://` is accepted only for this computer and private office-network addresses. Anything
on the internet must use `https://`.

To rebuild: `node tools/release/build-release.mjs extension`.
