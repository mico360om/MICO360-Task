# MICO360 Tasks — Chrome Extension

A full, offline-capable Chrome extension (MV3, plain JS — no build step) that mirrors the web app's
screens. Clicking the toolbar icon opens a popup to add a task from any page; its "Open MICO360 Tasks"
button opens the full app in a tab.

## Quick capture (the popup)

Open it with the toolbar icon, the keyboard shortcut (Ctrl+Shift+K, ⌘⇧K on a Mac; change it at
`chrome://extensions/shortcuts`) or the right-click menu's **Add to MICO360 Tasks** on a selection, a
link or the page (what you clicked fills the title and description). The form is the web's New task
form in short: title, project (the one the page shows, else the last one used), column, priority,
due date, "Assign me" or people from the project's team, and the description, with:

- **Describe it in plain English** (`POST /ai/parse-task`): suggested details to review — nothing
  changes until you choose, and what you set yourself starts unticked. Without AI set up it shows
  the server's own message.
- **Pictures and files**: pasted (Ctrl+V), dropped or chosen; they go up once the task exists.
- **Add this page**: the page's title and address go into the description (`activeTab`).
- **Offline**: the task waits in the sync queue like any other change. Files can't wait offline,
  so the popup asks first and can save the task without them.
- The form not sent yet is kept while the browser is open (a popup closes when you click outside
  it), and **Recently added** lists the last five tasks added here.

## The side panel

Chrome's side panel shows the app in short beside any page (`app/panel.html`, the same app,
session, offline copies and sync queue; built for 320–400 px). Open it with the side-panel button
in the popup's header or in the app's top bar, or a keyboard command you choose at
`chrome://extensions/shortcuts` ("Open the side panel" — no key is set for you). The toolbar
button still opens the popup.

- **Today**: what is overdue and due today for you, and what you finished today, by the company's
  calendar day (the rules of My Tasks and the web), with **Mark done**.
- **My Tasks**: the full list with its search, filters, sort and **Mark done**.
- **Add a task**: the popup's New task form (offline it waits in the queue with its own key, as in
  the popup). It keeps what you typed while the panel is open and when it opens again; there is no
  "Add this page" here, because Chrome lets the extension read the page only from the popup or the
  right-click menu.
- A task opens its panel inside the side panel (full width); a page the side panel doesn't show (a
  board, a meeting, Settings) opens in the full app page, and **Open MICO360 Tasks** opens it too.
- No live connection: the lists read themselves again every minute while the side panel is shown,
  and when it is shown again. Signing out in the app or popup signs the side panel out too; it asks
  you to sign in through the full app.
- The `sidePanel` permission shows no install warning (Chrome's own list is checked by
  `tools/extension-e2e/sidepanel.mjs`).

## Screens

Dashboard · My Tasks · Projects · Board (Kanban) · Task detail · Calendar · Chat · Notifications ·
Settings — a sidebar + hash-routed single-page app under `app/`.

- **Projects** show each project's picture (its image, else its icon or initials on its colour),
  code and own number, status in words, and **Open dashboard on the web**.
- **Board** cards show what the web's do: the due day ("Overdue" in company time), subtasks,
  comments, files, people, milestone and a blocked column. **Add a task to …** on any column (or
  **New task**) opens the New task form there, on the board's day.
- **My Tasks** can be filtered by project and sorted (due date, priority, progress, title), and
  **Mark done** moves a task to its project's Done column.
- **Chat** lists Favorites, every project's channel, direct messages and the Archive; each row's
  "⋯" adds it to favorites, mutes it or archives it, and **New direct message** starts one. An open
  conversation reads itself again every 12 seconds while it is on screen (no live connection), and
  at once when you come back to the tab; what you are typing stays. It shows files, the message a
  reply answers and reactions, loads older messages, and sends text (Enter), files and pasted or
  dropped pictures (online only). Each message keeps one clientId through every try, so the server
  never stores it twice. The server is told which direct messages reached this device
  ("Delivered").
- **Notifications** read themselves again when you come back to the tab or the unread count
  changes. **Settings → Notifications** has the web's preferences (which kinds to get, how early a
  "due soon" reminder comes, the two morning emails), saved on the server, and this device's desktop
  alerts: on or off, and whether one may say what the newest notification is about (off until you
  choose it; a click then opens that item).

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
one-minute background check), `notifications` (the desktop alert when something new arrives),
`unlimitedStorage` (installed
copies already have it: without it, an app tab left open for days can fill Chrome's 10 MB with
offline copies, and the next renewal of the sign-in could not be saved). The offline copies are
still capped at 200 (`src/read-cache.js`), and when storage is full they make room for changes
waiting to sync, never the other way round. `contextMenus` (the right-click item), `activeTab`
(the page the popup is opened on, for "Add this page") and `sidePanel` (the side panel) show no
install warning; there is no content script.

## Structure

```
app/            full-page app (app.html, app.js router+shell, app.css, dom.js, components.js, theme.js,
                dialog.js modal dialogs + focus, menu.js menu buttons, new-task-dialog.js,
                notification-settings.js); panel.html + panel-shell.js: the same app in Chrome's
                side panel (Today = screens/today.js, My Tasks, Add a task)
app/screens/    one module per screen (export function XScreen(ctx))
app/chat/       the chat inbox, a conversation and one message
src/            shared logic: api.js, read-cache.js, router.js, queue.js, auth.js, config.js, chat.js,
                version.js, project-identity.js, task-cards.js, background-poll.js, …
popup/          the toolbar popup: popup.html/js/css and quick-add-form.js/.css (the New task form,
                also the board's New task dialog)
background/     service-worker.js (right-click menu, badge count and desktop alert, background queue
                flush)
```

## Keyboard

Board cards are buttons: Tab to one, Enter or Space opens it, and its "⋯" button ("Move to…") lists
the other columns (arrows to choose, Enter to move, Escape to close). The task drawer is a modal
dialog: focus moves into it and stays there, Escape closes it, and focus goes back to the card.
The board's New task dialog works the same way (Ctrl+Enter creates the task; Escape asks before
discarding what was typed), and focus goes back to the button that opened it.

## Versions and updates

Settings → About shows the extension's version and the server's (`GET /version`). When the server
is newer it says that not every website update needs a new extension, and how to update a zip
install (no Web Store). There is no "newer version" banner.

## Tests

- `npm test` (Vitest) covers the logic — router, read-cache, offline queue + write mapping, auth /
  session / locks, due dates, summaries, chat helpers, config, versions — plus DOM tests of the
  screens (jsdom), keyboard use and the drawer dialog, and the popup. `src/shared-copies.test.js`
  and `src/clipboard-files.dom.test.js` check that the copies of the web's due-date rules, the
  server's repeat summaries and the web's pasted-file rules still give the same answers, as
  `src/chat-stage5.test.js` does for the web's chat rules (`lib/chat-model.ts`).
- `npm run lint` (ESLint; also part of the root `npm run lint`).
- `npm run test:e2e` runs the browser checks in `tools/extension-e2e/` — headless Chrome loads this
  folder unpacked and drives it against a local server (default `http://localhost:4000`, which must
  allow `chrome-extension://*` in `CORS_ORIGINS`): sign-in, board and keyboard, the drawer dialog,
  versions, edit conflicts, repeating tasks, reports and exports, the quick-capture popup, the
  board, My Tasks and Projects (`lists.mjs`), chat, search, the calendar and meetings
  (`stage6.mjs`), and the side panel (`sidepanel.mjs`: its page at 400, 360 and 320 px — Today, Mark
  done, a task's panel, My Tasks, Add a task, pages it doesn't show, reading again — then Chrome's
  real side panel opened by a click on the app's and the popup's buttons, the install warnings, and
  sign-out). Settings are at the top of `tools/extension-e2e/lib.mjs`.
