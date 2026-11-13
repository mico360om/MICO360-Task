# Installable website (PWA) — short design

13 Nov 2026. MICO360 Tasks website (React/Vite). The server only serves the new static files. The Android app and Chrome extension are not changed (owner rule, 13 Nov).

## Intent
The owner asked for:
- PWA support: a manifest, icons, HTTPS, a safe service worker, install with standalone mode;
- an "Install App" button where supported, and "Add to Home Screen" steps on iPhone/iPad;
- prompts hidden once installed, and dismissible;
- an offline fallback page and an update notice;
- no sensitive data cached, and no change to login, permissions or features;
- tested on Android and iOS.

## Owner decisions
- **P1 Android:** "Install App" comes first. The "Download for Android" (APK, last signed 1.1.0) link moves to a quieter place, the sign-in page footer and About, until the native app is updated.
- **P2 Staff only:** the client portal (/client) gets no install offer and keeps not using the service worker.

## Approach (my call: extend what exists)
**Chosen:** extend `public/sw.js` + `src/lib/service-worker.ts`, which are live since 1.17. They are network-first for pages, keep only hashed `/assets/`, never touch `/api`, `/client`, `/uploads`, `/downloads`, `/socket.io` or `/email-assets`, and have a kill switch and `?nosw`.

**Rejected:**
- Workbox / vite-plugin-pwa: it replaces proven code and adds a dependency.
- Manifest only: it misses the button, the iPhone help and the update notice.

## What gets built
1. **Manifest** `/manifest.webmanifest`, linked only from staff pages (not /client or /privacy/client):
   - name "MICO360 Tasks", short name "MICO360";
   - `start_url` "/" (opens the person's usual start page), scope "/", display "standalone";
   - theme #8B1E1E, background from the page colour;
   - icons 192 and 512 PNG plus a 512 maskable, made once from the existing logo;
   - shortcuts: New task, My Tasks, Meetings.
   - Also: `apple-touch-icon` 180 PNG, `apple-mobile-web-app-capable` and its title, and a status-bar style that suits the brand.
   - The CSP (`lib/web-app.ts` and its deploy copies) is checked so the manifest and icons are allowed.
2. **Install offer:**
   - **Chrome, Edge and Android:** keep `beforeinstallprompt`. Show "Install App" in the account menu while the site is installable, and once a small card on the Dashboard: "Install MICO360 Tasks on this device", with Install / Not now.
   - **iPhone/iPad Safari** (including iPad in desktop mode): the same card and menu item open a short "Add to Home Screen" guide: Share → Add to Home Screen → Add, with simple icons. It also notes that the installed app asks you to sign in once.
   - **Hidden** when running installed (display-mode standalone or `navigator.standalone`), after `appinstalled`, and in browsers that can't install.
   - **"Not now"** hides the card on that device for 90 days. Storage calls are wrapped in try/catch, and the page works without storage. The menu item stays available.
3. **Offline page:** `/offline.html` (light and dark, brand, no data), kept by the worker when it installs. It's shown for a page load that fails with no saved page: "You're offline. This page needs a connection. Try again." It also says that open inspections keep working offline. The existing "last good page" behaviour stays first.
4. **Update notice:** when a newer version is live (the worker finds a new `sw.js`, or `build-info.json` changes, checked when the app regains focus and about every 30 minutes), a toast says "A new version of MICO360 Tasks is ready", with **Refresh** and **Later**.
   - Refresh reloads. Queued offline changes are kept, as today.
   - The existing quiet update on the next page change stays.
   - In installed mode, where there's no reload button, this toast is how people update.
5. **The worker:**
   - The cache version goes to v2. The NEVER list is unchanged.
   - Newly kept: the manifest, icons and the offline page only.
   - No API answers, files or personal data are ever stored.
   - The kill switch and `?nosw` keep working.
6. **Android APK link (P1):** removed from where it shows today (the website, plus the app's update notice if it's website-side) and placed on the sign-in page footer and About. The server's `/config` `androidAppUrl` stays, so the Android app and extension are unaffected.

## Not in scope
Push notifications to the installed app, an installable client portal, an app-store listing, and Android/extension changes.

## Constraints
- Web only, no server data changes, no migration.
- Must keep: login, sessions (including iPhone's separate storage when installed), permissions, offline inspections, the offline queue, update recovery, deep links and the share-link page.
- Never a real client or company name anywhere.

## Proof
- **Unit tests:** install-state logic (installable, iOS, iPad desktop mode, standalone, dismissed), the update check, and the worker's never-cache list, including offline.html and the manifest.
- **Android emulator** (Chrome, existing AVD recipe): installability with no errors (CDP `Page.getInstallabilityErrors`), install, open standalone, airplane mode shows the offline page and the last good page, then deploy a second build and see the update toast → Refresh.
- **Desktop Chrome/Edge:** install, the Dashboard card, Not now, the menu item, and hidden once installed.
- **iPhone/iPad:** WebKit with iPhone and iPad sizes shows the guide correctly. A real-device "Add to Home Screen" check is done by the owner after release (about 2 minutes); this PC can't run iOS.
- The full gate: suites, a fresh reviewer, the battery, el-check.
