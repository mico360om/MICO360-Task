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

The access token is kept in `chrome.storage.session` (memory only); the 30-day refresh token lives
in `chrome.storage.local`. The app tab and the service worker share one token refresh at a time
(Web Locks), and an ended session returns to the sign-in screen. No `tabs` permission is needed —
the open app tab is found with `chrome.runtime.getContexts` (Chrome 116+).

## Structure

```
app/            full-page app (app.html, app.js router+shell, app.css, dom.js, components.js, theme.js)
app/screens/    one module per screen (export function XScreen(ctx))
src/            shared logic: api.js, read-cache.js, router.js, queue.js, auth.js, config.js, chat.js, …
background/     service-worker.js (opens the app, badge count, background queue flush)
```

## Tests

`npm test` (Vitest) covers the logic — router, read-cache, offline queue + write mapping, auth /
session / locks, due dates, summaries, chat helpers, config — plus DOM smoke tests of the main
screens.
