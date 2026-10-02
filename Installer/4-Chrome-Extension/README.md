# 4 · Chrome extension

| In this folder | What it is |
| --- | --- |
| `MICO360-Tasks-Chrome-Extension-0.3.0.zip` | The extension for Chrome and Edge (Manifest V3, version 0.3.0) |

## Install without the Web Store

1. Unzip the file into a folder that will stay where it is.
2. Open `chrome://extensions` (in Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the unzipped folder.
5. Click the MICO360 icon and sign in.

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
