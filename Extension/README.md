# MICO360 Tasks — Chrome Extension

A full, offline-capable Chrome extension (MV3, plain JS — no build step) that mirrors the web app's
screens. Clicking the toolbar icon opens the app in a full-page tab.

## Screens

Dashboard · My Tasks · Projects · Board (Kanban) · Task detail · Calendar · Chat · Notifications ·
Settings — a sidebar + hash-routed single-page app under `app/`.

## Offline

- **App shell** always loads (it's packaged locally).
- **Reads** go through a read-through cache (`src/read-cache.js`) — your tasks/projects/board/chat
  stay viewable with no connection, marked "offline · saved".
- **Writes** made offline (move a card, add a task, comment, mark read, send a chat…) are queued
  durably (`src/queue.js`) and replayed automatically on reconnect by the background service worker
  (every minute, and when the app tab reconnects). Each queued change belongs to the user who made
  it, carries an `Idempotency-Key`, and is only replayed for that user; changes that keep failing
  are listed under **Settings → Sync** (retry / discard) instead of being dropped.
- **Sign-out** revokes the session on the server and wipes the queue, the cache and the
  notification markers from the device.

## Load it (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `Extension/` folder.
3. Click the MICO360 icon to open the app; sign in.

## Point it at your backend

Defaults to production: `https://task.mico360.com/api/v1` (web app `https://task.mico360.com`).
To use another server, click **Advanced: change server** on the sign-in screen, or change it later
under **Settings → Backend**. Only `https://` addresses are accepted — plain `http://` only for this
computer or a private office-network address such as a self-hosted Windows server
(`http://192.168.1.20:4000`). Chrome asks for access to any non-production host
(declared as optional host permissions), and switching servers signs you out and wipes the device's
cached data and queued changes so tokens never follow a host change.

## Session & permissions

It needs Chrome 116 or later (`minimum_chrome_version`). The access token is kept in
`chrome.storage.session` (memory only, never on disk); the 30-day refresh token lives in
`chrome.storage.local`. The app tab and the service worker share one token refresh at a time
(Web Locks), and an ended session returns to the sign-in screen. No `tabs` permission is needed —
the open app tab is found with `chrome.runtime.getContexts` (Chrome 116+).

Permissions: `storage` (settings, the session, offline copies and the sync queue), `alarms` (the
one-minute background check), `notifications` (the unread alert). There is no `unlimitedStorage`:
Chrome's 10 MB is plenty for the 200 offline copies kept (`src/read-cache.js`), and when storage is
full those copies make room for changes waiting to sync, never the other way round.

## Structure

```
app/            full-page app (app.html, app.js router+shell, app.css, dom.js, components.js, theme.js,
                dialog.js modal dialogs + focus, menu.js menu buttons)
app/screens/    one module per screen (export function XScreen(ctx))
src/            shared logic: api.js, read-cache.js, router.js, queue.js, auth.js, config.js, chat.js,
                version.js, …
background/     service-worker.js (opens the app, badge count, background queue flush)
```

## Keyboard

Board cards are buttons: Tab to one, Enter or Space opens it, and its "⋯" button ("Move to…") lists
the other columns (arrows to choose, Enter to move, Escape to close). The task drawer is a modal
dialog: focus moves into it and stays there, Escape closes it, and focus goes back to the card.

## Versions and updates

Settings → About shows the extension's version and the server's (`GET /version`). A zip install
(no Web Store) is told when the server is newer, with the steps to update and a link to the web
app's About page; the notice at the top of the app can be dismissed for that version.

## Tests

- `npm test` (Vitest) covers the logic — router, read-cache, offline queue + write mapping, auth /
  session / locks, due dates, summaries, chat helpers, config, versions — plus DOM tests of the
  screens (jsdom), keyboard use and the drawer dialog. `src/shared-copies.test.js` checks that the
  copies of the web's due-date rules and the server's repeat summaries still give the same answers.
- `npm run lint` (ESLint; also part of the root `npm run lint`).
- `npm run test:e2e` runs the browser checks in `tools/extension-e2e/` — headless Chrome loads this
  folder unpacked and drives it against a local server (default `http://localhost:4000`, which must
  allow `chrome-extension://*` in `CORS_ORIGINS`): sign-in, board and keyboard, the drawer dialog,
  versions, edit conflicts, repeating tasks, reports and exports. Settings are at the top of
  `tools/extension-e2e/lib.mjs`.
