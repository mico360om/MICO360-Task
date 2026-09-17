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
  durably (`src/queue.js`) and replayed automatically on reconnect (also swept by the background
  service worker every minute).

## Load it (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `Extension/` folder.
3. Click the MICO360 icon to open the app; sign in.

## Point it at your backend

Defaults to `http://localhost:4000/api/v1`. In the app go to **Settings → Backend** and set your
API + web-app URLs (saved to `chrome.storage`), then reload. For an `https://` backend, the manifest
already declares the optional `https://*/*` host permission.

## Structure

```
app/            full-page app (app.html, app.js router+shell, app.css, dom.js, components.js, theme.js)
app/screens/    one module per screen (export function XScreen(ctx))
src/            shared logic: api.js, read-cache.js, router.js, queue.js, auth.js, config.js, chat.js, …
background/     service-worker.js (opens the app, badge count, background queue flush)
```

## Tests

`npm test` (Vitest) covers the pure logic — router, read-cache, offline write mapping, auth,
summaries, chat helpers, config.
