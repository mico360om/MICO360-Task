# Chrome extension vs web portal: gap analysis

Date: 2026-10-21. Branch `feat/project-dashboard`. Versions compared: web portal and server 1.3.4,
Chrome extension 1.3.4 (`Extension/manifest.json:4`).

This is a read-only review of the code. Nothing was changed. In the paths below, `E` = `Extension/`,
`W` = `Web Portal/frontend/src` and `B` = `Web Portal/backend/src`. "Unverified" marks things I
inferred and did not run or confirm.

## Headline

- **Nothing is broken today.** Every endpoint, query parameter and request body the extension uses
  still exists on the server, with the same shape. The only stale field is `email` from
  `/users/directory`, which the server no longer sends.
- **The extension's code is frozen at 0.3.0.** Its last code change was `fa8ca87` on 2 October.
  Every release since then (0.4.0 to 1.3.4) only bumped `manifest.json` and `package.json`. So none of
  these reached the extension: the 0.4.0 redesigns (task drawer, task form, meetings, chat, calendar),
  the 1.0.0 features (version display, shortcuts, search), or any 1.x change (meeting link,
  attachments, pasting pictures, adding a task from any column).
- **The biggest risk is a sync problem.** Task edits never send `expectedVersion`, so an edit made in
  the extension, or replayed later from the offline queue, silently overwrites changes other people
  made. The web refuses such edits, and the Android app does too since 1.2.1.
- **The biggest missing feature is quick capture.** The extension has no popup, keyboard command,
  context menu, or way to paste a screenshot. Clicking the toolbar icon only opens a full-page copy
  of the app.
- **Manifest V3 compliance is good.** There is no remote code, no eval and no innerHTML, and
  permissions are minimal. Small items remain: `minimum_chrome_version`, a justification for
  `unlimitedStorage`, unused images shipped in the package, and showing the version in the UI.

---

## 1. What the extension does today

### 1.1 Surfaces

| Surface | Present? | Where |
|---|---|---|
| Toolbar action | Yes, with no popup. A click focuses an open app tab or opens a new one | `E background/service-worker.js:75-89,101` |
| Full-page app (hash-routed SPA) | Yes | `E app/app.html`, `E app/app.js` (routes `:40-52`, nav `:29-38`) |
| Background service worker (module) | Yes. Polls every minute (badge, desktop notification, flushes the queue) | `E background/service-worker.js` |
| Desktop notifications | Yes. Only an unread count; a click opens `#/notifications` | `E background/service-worker.js:51-60,103-107` |
| Popup, side panel, content scripts, context menu, commands, omnibox | **None** | `E manifest.json` |

### 1.2 Screens, features and the endpoints they call

| Screen (route) | File | Features | Endpoints |
|---|---|---|---|
| Sign in | `E app/screens/login.js` | Password sign-in. "Advanced: change server", which asks Chrome for the host permission and wipes data when the host changes | `POST /auth/login` (`:92-108`) |
| Dashboard `#/` | `E app/screens/dashboard.js` | Tiles: due today, overdue, in progress, completed today. Overdue and Upcoming lists | `GET /tasks/mine` (`:17`) |
| My Tasks `#/my-tasks` | `E app/screens/my-tasks.js` | Search on the device, priority chips, grouped by due day | `GET /tasks/mine` (`:41`) |
| Projects `#/projects` | `E app/screens/projects.js` | Grid of cards (code, status, name, description). A card opens its board | `GET /projects` (`:15`) |
| Board `#/board/:id?date=` | `E app/screens/board.js` | One board per day with previous/next/today and a date picker, a progress bar, drag-and-drop between columns, and "+ Add task" through `window.prompt` | `GET /projects/:id`, `/projects/:id/columns`, `/tasks?projectId&boardDate`, `/projects/:id/progress` (`:42-47`). `PATCH /tasks/:id/move` (`:168`), `POST /tasks` (`:189`) |
| Task drawer `#/task/:id` (overlay) | `E app/screens/task-detail.js` | Title, priority, due date, a full repeat editor, description, checklist (add, tick), "Assign me/Unassign me", comments, export to Excel/PDF | `GET /tasks/:id`, `/assignees`, `/checklist`, `/comments` (`:44-49`), `/users/directory` (`:55`). `PUT /tasks/:id` (`:290`), `PUT /checklist/:id` (`:306`), `POST /tasks/:id/checklist` (`:320`), `POST/DELETE /tasks/:id/assignees` (`:340-341`), `POST /tasks/:id/comments` (`:357`), `GET /tasks/:id/export.{xlsx,pdf}` (`:96`) |
| Calendar `#/calendar` | `E app/screens/calendar.js` | A list of my tasks grouped by due day (no meetings, no month or week grid) | `GET /tasks/mine` (`:17`) |
| Chat `#/chat`, `#/chat/:id` | `E app/screens/chat.js` | Inbox (one channel per project, plus DMs), a thread with text only, and a composer | `GET /projects`, `/conversations`, `/users/directory` (`:38-42`), `GET /projects/:id/chat` (`:77`), `GET /conversations/:id/messages` (`:98`), `POST /conversations/:id/read` (`:106`), `POST /conversations/:id/messages` (`:151`) |
| Notifications `#/notifications` | `E app/screens/notifications.js` | List. A click marks one read; "Mark all as read" | `GET /notifications` (`:13`), `PUT /notifications/:id/read` (`:25`), `POST /notifications/read-all` (`:37`) |
| Reports `#/reports` (admins only) | `E app/screens/reports.js` | Project and member filters, a period, tiles, status bars, a trend chart, tables, Excel/PDF/CSV export | `GET /reports/{projects,status,workload,completion,timeseries}` (`:49-55`), `GET /reports/<kind>.<fmt>` (`:105`) |
| Settings `#/settings` | `E app/screens/settings.js` | Theme, API and web-app addresses, sync (failed items with Retry/Discard), sign out | none (sign-out calls `POST /auth/logout` in `E src/session.js:33-41`) |
| Shell | `E app/app.js` | Online/offline status, pending/failed counts, unread badge (refreshed every 60 s, `:197`), the company time zone from `/config` (`:201-215`), screens reloaded when you return to the tab (`:185-189`) | `GET /notifications/unread-count` (`:280`), `GET /config` (`:203`) |

### 1.3 Shared modules

- `E src/auth.js`: the token store (access token in `chrome.storage.session`, refresh token in
  `local`, `:44-75`). It has one refresh shared through Web Locks (`:105-138`) and `authedFetch`,
  which has a 6 s timeout and is bound to the server that issued the session (`:103,150-177`).
- `E src/session.js`: starts, checks and ends a session (`:59-115`), and wipes data on sign-out (`:26-52`).
- `E src/read-cache.js`: reads from the network first and falls back to the cache when offline,
  with up to 200 entries (`:5,46-66`).
- `E src/queue.js`: the durable offline queue. Each item has an owner and an `Idempotency-Key`, a
  locked flush, and Retry/Discard when it fails. It covers ten kinds of change (`:109-143`).
- `E src/due-date.js` (the same rules as `W lib/due-date.ts:33-39`), `E src/summary.js`,
  `E src/recurrence.js`, `E src/reports.js`, `E src/chat.js`, `E src/notify.js`, `E src/router.js`.

**Dead code:**
- `E src/quick-add.js` is used only by tests. It is left over from a popup that no longer exists.
- `E src/sync-status.js` is never imported by the app.
- `unreadTotal` and `inSeries` are never called.
- These `api.js` methods are never called: `projects.members`, `tasks.remove`,
  `tasks.removeChecklistItem`, `tasks.tags`, `tasks.setTags` (`E src/api.js:73-99`).
- `icons/brand.png`, `brand-w.png` and `logo.png` (about 150 KB) are shipped but never referenced.

---

## 2. API compatibility

### 2.1 Every call, checked against the server

Status "OK" means the route exists with the same method and body, and the fields the extension
reads are still returned.

| Call | Extension | Server route | Fields read | Status / notes |
|---|---|---|---|---|
| `POST /auth/login {identifier,password}` | `login.js:92-108` | `B modules/auth/auth-routes.ts:30-35` | `accessToken`, `refreshToken`, `user.id` | OK. `user.email/username/roles/avatarUrl` are thrown away. No email-code sign-in |
| `POST /auth/refresh {refreshToken}` | `src/auth.js:113-134` | `auth-routes.ts:41-56` | `accessToken`, `refreshToken` | OK. `data.user` is ignored. A 403 counts as the session ending (see 2.3) |
| `POST /auth/logout {refreshToken}` | `src/session.js:33-41` | `auth-routes.ts:100-104` | none | OK |
| `GET /config` | `src/api.js:60`, `app.js:203` | `B app.ts:353-370` | `timeZone` | OK. `emailEnabled` and `serverTime` are ignored |
| `GET /users/directory` | `app.js:124`, `chat.js:41,99`, `task-detail.js:55` | `B modules/users/user-routes.ts:75-80` | `id, firstName, lastName, username`, **`email`** | **Stale field.** The directory has no `email`, so `me.email` falls back to the username (`app.js:126`) |
| `GET /projects` | `projects.js:15`, `chat.js:39` | `B modules/projects/project-routes.ts:65` | `id, code, name, status, description` | OK. `number`, `icon`, `imageUrl` and `color` are ignored (`Web Portal/backend/prisma/schema.prisma:169-182`) |
| `GET /projects/:id` | `board.js:43` | `project-routes.ts:76` | `name, code` | OK |
| `GET /projects/:id/columns` | `board.js:44` | `B modules/projects/column-routes.ts:37` | `id, name, category, position, enabled` | OK. Disabled columns are dropped, along with their tasks (`board.js:49`) |
| `GET /projects/:id/progress` | `board.js:46` | `project-routes.ts:83-89` | `completionPct, completed, total, overdue` | OK |
| `GET /tasks?projectId&boardDate` | `board.js:45`, `src/api.js:77-91` | `B modules/tasks/task-routes.ts:155-193` | `id, key, title, priority, columnId, columnCategory, completedAt, progress, recurrenceRule` | OK. The `assignees`, `counts`, `dueDate`, `isMilestone` and `version` that list rows carry are ignored |
| `GET /tasks/mine` | `dashboard.js:17`, `my-tasks.js:41`, `calendar.js:17` | `task-routes.ts:230-235` | as above plus `dueDate, description` | OK |
| `GET /tasks/:id` | `task-detail.js:45` | `task-routes.ts:259-266` | `key, title, description, priority, dueDate, recurrenceRule, recurrenceNextId` | OK. `version`, `meeting` (1.2.0), `isMilestone`, `startDate` and the hours fields are ignored |
| `GET /tasks/:id/assignees` | `task-detail.js:46` | `B modules/tasks/assignee-routes.ts:31` | `id, firstName, lastName, username, email` | OK |
| `GET /tasks/:id/checklist` | `task-detail.js:47` | `B modules/tasks/checklist-routes.ts:41-48` | `items[id,text,done], done, total` | OK |
| `GET /tasks/:id/comments` | `task-detail.js:48` | `B modules/tasks/comment-routes.ts:37` | `userId, body, createdAt` | OK. `parentId` (threaded replies) and `editedAt` are ignored (`B modules/tasks/comment-repository.ts:1-10`) |
| `POST /tasks` (+ Idempotency-Key) | `board.js:186-189`, `src/queue.js:120` | `task-routes.ts:268-306` | the created task | OK |
| `PATCH /tasks/:id/move {columnId,position}` | `board.js:168`, `queue.js:122-123` | `task-routes.ts:321-331` | none | OK |
| `PUT /tasks/:id <patch>` | `task-detail.js:290`, `queue.js:124-125` | `task-routes.ts:308-319` | **response ignored** | **Works, but last write wins.** It never sends `expectedVersion` or `scope` (`task-routes.ts:98-100`); see 6-H1 |
| `POST /tasks/:id/assignees {userIds}` | `task-detail.js:341`, `queue.js:126-127` | `assignee-routes.ts:37` | none | OK |
| `DELETE /tasks/:id/assignees/:userId` | `task-detail.js:340`, `queue.js:128-129` | `assignee-routes.ts:46` | none | OK |
| `POST /tasks/:id/comments {body}` | `task-detail.js:357`, `queue.js:130-131` | `comment-routes.ts:50` (`parentId` optional, `:10`) | none | OK |
| `POST /tasks/:id/checklist {text}` | `task-detail.js:320`, `queue.js:132-133` | `checklist-routes.ts:50` | the created item | OK |
| `PUT /checklist/:itemId {done}` | `task-detail.js:306`, `queue.js:134-135` | `checklist-routes.ts:61` | none | OK |
| `GET /tasks/:id/export.{xlsx,pdf}` | `task-detail.js:96` | `B modules/tasks/task-export-routes.ts:20` | blob + `Content-Disposition` | OK. Subject to the 6 s timeout (6-M4) |
| `GET /notifications` | `notifications.js:13` | `B modules/notifications/notification-routes.ts:20` (newest 100) | `id, title, body, readAt, createdAt` | OK. `entityType` and `entityId` are ignored |
| `GET /notifications/unread-count` | `app.js:280`, `service-worker.js:45` | `notification-routes.ts:34` | `count` | OK |
| `PUT /notifications/:id/read` (no body) | `queue.js:136-137` | `notification-routes.ts:38` | none | OK (no JSON content type on an empty body, `E src/auth.js:35-41`) |
| `POST /notifications/read-all` | `notifications.js:37` | `notification-routes.ts:43` | none | OK. Not queued offline |
| `GET /conversations` | `chat.js:40` | `B modules/chat/chat-routes.ts:62` | `conversation{id,kind,projectId}, participants[userId], unread, lastMessage` | OK. `prefs` (favorite/archived/muted, `B modules/chat/message-service.ts:71-79`) is ignored |
| `GET /projects/:id/chat` | `chat.js:77` | `chat-routes.ts:67-72` | `conversation.id` | OK |
| `GET /conversations/:id/messages` | `chat.js:98` | `chat-routes.ts:82-87` (paged with `before`, 50 by default) | `userId, body, createdAt, editedAt, deletedAt` | OK. Only the newest 50 load. `attachments`, `replyTo` and `reactions` are ignored (`message-service.ts:56-60`) |
| `POST /conversations/:id/messages {body}` (+ Idempotency-Key) | `chat.js:151`, `queue.js:138-139` | `chat-routes.ts:90-98` | none | OK. It never sends `clientId` (`chat-routes.ts:12-16`) |
| `POST /conversations/:id/read` | `chat.js:106` | `chat-routes.ts:125` | none | OK |
| `GET /reports/*` and `/reports/<kind>.<fmt>` | `reports.js:49-55,105`, `src/reports.js:43` | `B modules/reports/report-routes.ts:164-208` | as the web | OK. Exports are subject to the 6 s timeout |

### 2.2 Headers and request semantics

- **Optimistic version:** the server checks `expectedVersion` only when a client sends it
  (`B modules/tasks/task-service.ts:177-180`). The web sends it from the task form
  (`W components/task-form/TaskFormDialog.tsx:399`). The extension never sends it. If it is added,
  `task.version` must be updated from each PUT response. Today the response is thrown away
  (`task-detail.js:290`), so the second edit in a row would fail with 409.
- **Idempotency:** `Idempotency-Key` is sent on every queued POST (`queue.js:111-118`). That matches
  the server (`B lib/idempotency.ts`). Stored replies are kept for only 24 hours (`:35`), so an item
  that sits offline longer can create a duplicate if its first try reached the server. Chat can avoid
  this with `clientId`; creating a task can't.
- **Multipart (for future uploads):** `requestHeaders` adds `Content-Type: application/json` whenever
  there is a body (`E src/auth.js:35-41`). A `FormData` upload would then be sent with the wrong
  content type. This must be fixed before attachments are added.
- **Timeouts:** every call, including downloads, aborts after 6 s (`auth.js:19,167`; `api.js:48-52`).
  The web sets no timeout.
- **Non-JSON 200:** `raw()` turns a reply it can't parse into `{}` and caches it (`api.js:33-34`).
- **CORS:** production needs none. The `host_permissions` for `https://task.mico360.com/*` exempt the
  extension, as does a runtime-granted optional host. The server allows every method and exposes
  `Content-Disposition` (`B app.ts:264-269`). `CORS_ORIGINS` accepts `chrome-extension://*`
  (`B lib/cors-origins.ts`). That is only needed by the test harness, which stubs the permission
  prompt. The docs disagree: `docs/DEPLOY-HOSTINGER.md:232-234` says to add the extension's origin,
  while `docs/DOMAIN-SETUP.md:37` says host permissions cover it.

### 2.3 Auth, session and refresh: extension vs `W api/client.ts`

| Aspect | Extension | Web (`W api/client.ts`, which has uncommitted edits from another session) | Gap |
|---|---|---|---|
| Where tokens live | Access token in `storage.session` (memory), refresh token in `storage.local` (`src/auth.js:44-75`) | Auth store with local or session storage depending on "remember me" | Fine |
| One refresh across contexts | Web Lock `mico360:auth-refresh`, shared by tabs and the service worker (`auth.js:105-138`) | Web Lock `mico360-auth-refresh` (`client.ts:12-20`) | Equivalent |
| Waiting for another context's refresh | Uses the stored token if it differs from the failed one (`auth.js:110`) | `adoptNewerSession`, then a 250 ms wait and one retry (`client.ts:27-42,101-112`) | Fine (the lock makes the retry unnecessary) |
| Statuses that end the session | **400, 401, 403**, and the tokens are cleared (`auth.js:122`) | 400 and 401 only. 403 counts as a passing problem (`client.ts:79`) | **Align.** A 403 from a proxy or WAF signs the extension user out |
| Checking a 200 reply | Needs only `accessToken` (`auth.js:133`). A missing `refreshToken` keeps the spent one | Needs both tokens and `user.id` (`client.ts:50-53,72`) | **Align** |
| Lost refresh reply | The 6 s timeout keeps the old token. The server hands back the same new key for about 2 minutes (CHANGELOG 1.2.1) | Same server behaviour | Fine within 2 minutes |
| Profile | Only the id is kept. Name comes from the directory, roles from the JWT once at start-up (`app.js:122-135`) | `user` from the session | Keep `data.user` from login and refresh |
| Session ended | The tab reloads to sign-in with a notice and the queue is kept (`app.js:108-114`) | `logout('expired')` | Fine |

---

## 3. Manifest V3 compliance (`E manifest.json`)

| Check | Result |
|---|---|
| `manifest_version: 3`; `background.service_worker` with `type: module` | ✓ |
| Listeners registered at the top level of the worker (survives restarts) | ✓ (`service-worker.js:101-133`) |
| No remote code, `eval`, `new Function`, `innerHTML` or `document.write` | ✓ (searched `app`, `src`, `background`) |
| Content security policy | None declared, so the MV3 default applies (`script-src 'self'`). Inline styles are set through the CSSOM, which the default allows ✓ |
| `permissions`: `storage`, `alarms`, `notifications` | ✓ all used |
| `permissions`: `unlimitedStorage` | **Justify or drop.** The cache is capped at 200 entries (`src/read-cache.js:5`), and `storage.local` gets 10 MB since Chrome 114. The Chrome Web Store asks for a reason |
| `host_permissions`: only `https://task.mico360.com/*` | ✓ minimal |
| `optional_host_permissions`: `https://*/*`, `http://*/*` | Needed for self-hosted servers and requested one host at a time (`login.js:10-19`, `src/config.js:94-100`). The Web Store review needs a justification. Patterns ignore the port |
| No `tabs` permission (it uses `runtime.getContexts`) | ✓ but this needs Chrome 116 → **add `"minimum_chrome_version": "116"`**. The fallback to `storage.local` (`auth.js:45`) then becomes dead code |
| Alarms instead of timers in the worker (1 minute, above the 30 s floor) | ✓ (`service-worker.js:92-99`). `setInterval` is used only in the page (`app.js:197`) |
| Message passing | `onMessage` checks `sender.id` (`service-worker.js:124`). There is no `externally_connectable` ✓ |
| `web_accessible_resources` | None ✓ |
| Icons 16/48/128 at the right sizes | ✓ (checked the PNG headers). **Unused** `brand.png`, `brand-w.png` and `logo.png` are packaged, because `tools/release/build-release.mjs:424-426` copies the whole `icons/` folder |
| Version | `1.3.4`, written by `tools/release/release.mjs:117` and enforced by `B modules/about/release-consistency.test.ts:28-34` ✓. The version is **not shown anywhere** in the UI, while the web and Android do show theirs |
| Distribution | The Installer ships a zip for "Load unpacked" (`build-release.mjs:416-443`), so there is **no auto-update**. Whether a Web Store listing exists is unverified |
| Store-review items (not in the manifest) | A privacy-policy URL (the site has `/privacy`, `W App.tsx:83`), a reason for each permission, a single-purpose statement, and screenshots |
| Packaging trap | `build-release.mjs:424` copies only `app`, `background`, `icons` and `src`. A new `popup/` or `sidepanel/` folder must be added there, or the package breaks. The import check only covers `.js` imports |

---

## 4. Security

1. **Token storage: good.**
   - The access token never touches disk (`storage.session` has the default trusted-contexts access).
   - The refresh token sits unencrypted in the profile's `storage.local`. That is the same exposure as
     the web's "remember me" and is acceptable.
   - Tokens are only ever sent to the server that issued them (`auth.js:103,150-156`).
   - Tokens never appear in URLs. Downloads go through blob URLs (`E app/dom.js:76-83`).
2. **XSS: low risk today.**
   - There is no `innerHTML`. `el()` adds text nodes and sets attributes (`dom.js:13-39`).
   - The only `href` built from stored data is `appBase` in Settings, and that value is checked first
     (`settings.js:50`; `config.js:35-50`).
   - Future screens must check every server-supplied URL before setting `href` or `src` (allow
     `https:`, or the API origin for `/uploads/...`). That covers attachment links, meeting join links
     and avatars.
   - Formatted meeting notes are HTML cleaned by the server (CHANGELOG 1.1.0). If they are ever shown,
     build the DOM from an allow-list. Never assign them with `innerHTML`.
   - The default CSP also blocks `javascript:` URLs, which is a second line of defence.
3. **Message origin: good.** There are no content scripts, no `externally_connectable` and no
   `web_accessible_resources`, so no web page can reach the extension. The one runtime message is
   checked (`service-worker.js:124`).
4. **Leaking tokens to pages: not possible today.** Adding a context menu needs `contextMenus` plus
   `activeTab` (no install warning), and still no content script.
5. **http vs https.**
   - Plain `http://` is accepted only for loopback, private IPv4 ranges and `.local` names
     (`config.js:20-50`).
   - On those addresses, passwords and tokens cross the office network in clear text. This is
     documented as accepted (`E README.md`).
   - Tailscale/CGNAT `100.64/10` and IPv6 ULA addresses count as public, so they need https. That is fine.
6. **Unsynced changes of a previous user.**
   - When a session expires, the queue is kept on purpose.
   - If a different person then signs in, `startSession` clears only the cache (`session.js:59-68`).
   - The first person's queued comments and messages stay on the device, invisible, until that person
     signs in again. Low risk. Option: offer to discard them when someone else signs in.
7. **Desktop notifications show only a count** (`E src/notify.js:18-20`). That is private. Showing
   titles later should be a setting.

---

## 5. Feature gaps vs the web portal, ranked by value to an extension user

"Fit" says whether a gap belongs in an extension:
- **Yes:** build it in the extension.
- **Lite:** a small read-mostly version, with a link to the web for the rest.
- **Link:** only a deep link to the web.

The web's deep links:
- a task: `<appBase>/my-tasks?task=<id>` (`W lib/notification-links.ts:41-45`);
- a meeting: `/meetings/<id>`;
- a conversation: `/chat?conversation=<id>`;
- a board: `/board?project=<id>`;
- a project's dashboard: `/projects/<id>`.

| # | Gap | Web reference | Extension today | Fit |
|---|---|---|---|---|
| 1 | **Quick capture.** Add a task from anywhere: the toolbar popup or a keyboard command, "Add this page" (title and URL), a right-click on a selection or link, pasting or dropping a screenshot or files (1.3.1, 1.3.4), "Describe it" in plain English (`POST /ai/parse-task`), the current or last-used project, column, priority, due date and assignees | `W components/task-form/*`, `W lib/clipboard-files.ts`, `W api/attachments.ts`, `B modules/ai/ai-feature-routes.ts:35` | `window.prompt` on a board, title only (`board.js:183`) | **Yes, the core reason to have an extension** |
| 2 | **Notifications that open their item.** A task opens its drawer, a conversation opens its thread, a meeting opens on the web. The toolbar badge and in-app badge should agree. Optionally the latest title in the desktop alert | `W lib/notification-links.ts:9-16` | A click only marks it read | Yes |
| 3 | **Task drawer parity:** attachments (list, preview, upload, paste, delete); "From meeting" (1.2.0); milestone; start date; tags; a picker for any assignee; watch/unwatch; @mentions; threaded replies with edit/delete; activity history; delete (one copy or the whole series); editing the series; edit conflicts | `W components/task-drawer/*`, `B …/attachment-routes.ts`, `watcher-routes.ts`, `comment-routes.ts:44`, `activity-routes.ts:16` | Title, priority, due date, repeat, description, checklist, assign me, plain comments, export | Yes (all but the long forms) |
| 4 | **Search:** Ctrl+K over tasks, projects, people and pages (`GET /search`), plus an omnibox keyword | `W components/GlobalSearch.tsx`, `B modules/search/search-routes.ts:17` | Search on the device within My Tasks only | Yes |
| 5 | **My Tasks:** project filter, sort, quick "mark done" or move, saved views | `W pages/MyTasksPage.tsx`, `W components/SavedViewsBar.tsx` | Search and priority only | Yes (no bulk actions) |
| 6 | **Chat:** see new messages without leaving and coming back, show files and pictures, send files and pastes, reply quotes and reactions, load older messages, start a new DM, muted/archived/favorite | `W components/chat/*`, `B modules/chat/chat-routes.ts` | Text only, newest 50, no live updates | Lite |
| 7 | **Meetings:** "Up next" and today's meetings, Join link, RSVP, open on the web | `W pages/MeetingsPage.tsx`, `B modules/meetings/meeting-routes.ts:204`, `attendee-routes.ts:77` | Nothing | Lite (editing agendas, notes, minutes and the Final MOM stays on the web) |
| 8 | **Calendar:** `GET /calendar` with projected repeats, meetings, your own time zone and week start | `B modules/tasks/task-routes.ts:196-228`, `W lib/useDatePrefs.ts:19-27` | A list of my tasks only | Lite |
| 9 | **Board:** add a task in any column with the proper form (1.3.2); card badges (assignees, comment/file/checklist counts, due date, milestone); tasks in hidden columns; moving cards from the keyboard | `W components/KanbanBoard.tsx`, `KanbanColumn.tsx`, `TaskCard.tsx` | Drag only. Cards show title, key, priority and repeat | Yes |
| 10 | **Settings and account:** version of the extension and the server, "update available" for zip installs, notification preferences, email-code sign-in and forgotten password (when `emailEnabled`), date preferences | `B modules/about/about-routes.ts:21`, `B …/notification-routes.ts:25-32`, `B modules/auth/auth-routes.ts:108-136` | Theme, server, sync, sign out | Yes |
| 11 | **Projects:** number, picture or icon, readable status names | `W components/ProjectAvatar.tsx`, `W lib/project-icons.tsx` | Code, raw status (`PLANNING`), name | Yes. Link to the web dashboard |
| 12 | **Keyboard shortcuts and accessibility** (N, /, Esc, Ctrl+Enter; dialog semantics) | `docs/KEYBOARD-SHORTCUTS.md`, `W components/shortcuts/*` | None | Yes |
| 13 | **Side panel** (My Tasks and quick add beside any page) | none on the web | none | Optional (needs the `sidePanel` permission, Chrome 114+) |

**Don't port (link to the web):**
- administration: users, system settings, AI Management, audit logs;
- creating, editing or archiving projects, and managing members and columns;
- the meeting editor, Live notes, minutes and approving the Final MOM;
- profile picture and password change;
- release history (About);
- the project dashboard.

Reports already exist in the extension. Keep them.

---

## 6. Bugs and sync issues seen in the code

Severity: H = loses or overwrites data, or shows wrong state; M = wrong or confusing behaviour;
L = polish or performance.

- **H1 Silent overwrites.**
  - `PUT /tasks/:id` never carries `expectedVersion` (`task-detail.js:285-298`, `queue.js:124-125`).
  - A queued edit replays minutes or days later over newer changes.
  - Fix: read `version` from the task, send it, take the new version from each reply, and send one
    edit at a time.
  - Queued edits that hit `409 VERSION_CONFLICT` are already marked failed and shown in
    Settings → Sync (`queue.js:170-175`). That is the right place for them.
- **H2 The server's plain-language errors are hidden.**
  - `writeErrorMessage` shows only the text of a `QueueError` (`E app/components.js:20-22`).
  - Errors such as "This task was changed by someone else", `RECURRENCE_NOT_NEWEST`, date order and
    no permission all become "Could not save your change."
- **H3 Offline edits disappear from view.**
  - Cached reads don't layer the queued changes on top (`read-cache.js:46-66`; `board.js:38-57`).
  - A card moved offline jumps back after you go away and return. A task added offline exists only
    in memory (`board.js:191`).
  - Android fixed the same problem in 1.2.1.
- **M4 The 6 s timeout covers downloads too** (`auth.js:19,167`; `api.js:48-52`).
  - A large report PDF or Excel file can fail on a slow server (unverified for real data sizes).
  - On a slow connection, screens show "offline · saved" even though the server is reachable.
- **M5 The refresh treats 403 as the end of the session** (`auth.js:122`), and a 200 reply without
  `refreshToken` is accepted (`auth.js:133-134`). See 2.3.
- **M6 A non-JSON 200 is cached as `{}`** (`api.js:33-34`).
  - A proxy or portal page then makes screens throw on `.filter`/`.map`, and the good offline copy is
    overwritten.
  - It matters mostly for plain-http office servers.
  - Fix: check the content type and that `data` is present before caching.
- **M7 Notification state.**
  - A click doesn't open the item (`notifications.js:56-61`).
  - "Mark all" is neither queued nor reported when it fails (`:33-40`), so the screen says read while
    the server still says unread.
  - The toolbar badge updates only on the worker's 1-minute poll (`service-worker.js:38-69`), but the
    sidebar badge updates at once (`app.js:277-286`). The two can disagree for up to 60 s.
  - The desktop alert says "N new" but shows the total unread count (`service-worker.js:53-59`).
- **M8 No live updates.**
  - Only Board, Dashboard and Calendar reload when you return to the tab (`E src/router.js:55`).
  - An open chat thread never shows incoming messages.
  - My Tasks and Notifications stay stale.
  - The web gets live updates over socket.io. Whether the extension can use that is unverified:
    socket.io checks its CORS list, and websockets aren't covered by host permissions.
- **M9 Keyboard and screen readers.**
  - Board cards are `role=button tabindex=0`, but nothing handles Enter or Space (`board.js:130`).
  - Dragging is the only way to move a card.
  - The task drawer has no `role="dialog"` or `aria-modal`, doesn't close on Escape, doesn't move or
    trap focus, and doesn't return focus when closed (`task-detail.js:29-35`; `app.js:321-325`).
- **M10 Tasks in disabled columns vanish from the board** (`board.js:49,113`). Android fixed this in 1.2.1.
- **M11 Chat details.**
  - A message that is only a file shows an empty bubble (`chat.js:140-141`).
  - Only the newest 50 messages load (`B modules/chat/message-service.ts:121`).
  - Every project gets a channel row, even one with no conversation yet (`chat.js:55-62`).
  - Archived and muted conversations are ignored.
  - Sends carry no `clientId` (`chat.js:151`). After more than 24 hours offline, a send whose first
    try reached the server can be duplicated.
- **M12 Profile and role.**
  - `me.email` reads a field the directory doesn't return (`app.js:126`), so Settings shows the
    username (`settings.js:46`).
  - Roles are read from the access token once at start-up (`app.js:131-135`). If the tab starts
    offline after a browser restart, there is no access token yet, so an admin loses Reports until the
    page reloads.
- **L13 Temporary ids.**
  - Opening a card that hasn't synced yet fetches `/tasks/tmp-…`, which fails with a 404 and shows
    "Could not load" (`board.js:130,200`).
  - Ticking a checklist item added offline queues `PUT /checklist/tmp-…`. That always fails and ends
    up in Settings → Sync (`task-detail.js:300-331`).
- **L14 Adding a task through `window.prompt`** (`board.js:183`). It blocks the page, takes only a
  title, and always uses the first enabled column, which can be Backlog.
- **L15 Repeating tasks.** An edit can never apply to the whole series, and a whole-series delete is
  never offered (`task-routes.ts:100`; `W api/tasks.ts:98-120`).
- **L16 Settings.** Saving an address on the same server says "reload to apply" but doesn't reload
  (`settings.js:80-81`).
- **L17 Midnight.** `today` is fixed when a screen is built (`board.js:17`, `reports.js:18`). It
  updates only when you change route or return to the tab.
- **L18 Clock.** "x min ago" uses the device clock (`dom.js:52-62`). The web anchors its clock to
  `serverTime` from `/config`.
- **L19 Performance.**
  - `cache.prune()` reads all of storage at every start (`read-cache.js:21-29`; `app.js:116`).
  - Every GET rewrites its cache entry, and `storage.onChanged` then copies large task lists to every
    open context. The worker and each tab listen.
  - Every change re-renders the whole drawer or board (`task-detail.js:62-76`, `board.js:63-75`).
  - The drawer fetches the people directory every time it opens (`task-detail.js:55`).
- **L20 Sign-in messages.**
  - `403 ACCOUNT_INACTIVE` shows as "Invalid email or password" (`login.js:99`;
    `B modules/auth/errors.ts:28-30`).
  - The 423 lock message ignores `retryAfterSeconds` and the emailed-code option (`errors.ts:15-25`).
- **L21 Queue policy differs from the web.** A 403 is retried five times (`queue.js:173`), while the
  web marks it failed at once (`W lib/offline-replay.ts:29-37`).
- **Time zones: at parity for due dates.**
  - The company zone comes from `/config` and is cached (`app.js:201-215`).
  - The due-day rules are the same as the web's (`E src/due-date.js:38-44` = `W lib/due-date.ts:33-39`).
  - The first-run default is Asia/Muscat (`config.js:5`).
  - No drift test keeps the copies the same.
  - The per-user time zone and week start (`GET /users/me/preferences`) aren't used. The web uses
    them only on its Calendar.

---

## 7. Existing tests and how to test the extension

- **Unit and DOM tests:**
  - `E src/*.test.js` has 21 files and 207 tests. All passed on 21 Oct: `npx vitest run` in
    `Extension/`, Vitest 4.1.11, Node environment; `*.dom.test.js` use jsdom.
  - Covered: router, read cache, queue and how each write maps to a request, auth, session, locks,
    due dates, summaries, chat helpers, config, notifications, recurrence, reports. The DOM tests
    render the Board, Login, Settings, Chat, Task drawer, Dashboard and Reports screens
    (`E src/screens.dom.test.js`).
  - Not covered: `background/service-worker.js`, the routing glue in `app/app.js`, and the
    Notifications, Projects, Calendar and My Tasks screens.
  - There is no lint or type-check for the extension (`E package.json` has only `test`). Option: add
    `// @ts-check` with JSDoc, and ESLint.
  - The only check against other code is the release version (`release-consistency.test.ts`). The
    copies of `due-date`, `recurrence` and `summary` aren't compared with the web or the server.
- **Browser harness (outside the repo, not in git): `D:/mico-release/ext-test/`.**
  - `run.mjs` (113 lines): loads the unpacked extension, switches server, signs in, checks the
    Projects screen (Arabic names get `dir=auto`) and a board.
  - `recur.mjs`: recurring tasks (15 checks).
  - `reports.mjs`: reports and exports (20 checks).
  - How it works:
    - It starts headless Chrome with `--enable-unsafe-extension-debugging --remote-debugging-pipe`
      and calls CDP `Extensions.loadUnpacked`.
    - It stubs `chrome.permissions.request`, since the permission prompt can't be clicked.
    - It drives the pages through `Runtime.evaluate`.
  - What it needs:
    - a local API at `http://localhost:4000` that lists `chrome-extension://*` in `CORS_ORIGINS`
      (the stub doesn't really grant the host);
    - `U`/`P` environment variables;
    - `MSYS_NO_PATHCONV=1` under Git Bash.
  - Starter scripts are in `D:/mico-release/start-api-audit.mjs`. Screenshots go to `out-*`.
    `D:/mico-release/audit-tools/` holds only web harnesses.
- **How to test the coming work:**
  - Keep pure logic in `src/` with Vitest unit tests, and screens in jsdom DOM tests.
  - Move the harness into the repo (for example `tools/extension-e2e/`) and add these checks:
    - Popup: open `chrome-extension://<id>/popup/popup.html` as a tab.
    - Service worker: attach to the `service_worker` target and evaluate there. Call the
      context-menu and notification handlers, and read `chrome.action.getBadgeText`.
    - Offline: `Network.emulateNetworkConditions` on the page target.
    - Edit conflicts: change the task through the API between two extension edits.
    - Keyboard: `Input.dispatchKeyEvent`.
    - Accessibility: axe injected from the local package (unverified on `chrome-extension://` pages).

---

## 8. Proposed staged plan (small, releasable stages)

Each stage ships as a normal release:
1. Add CHANGELOG entries.
2. Run `node tools/release/release.mjs` (it writes the manifest version). Use `--web-only` while
   nothing in "Android App" changes.
3. Rebuild the extension zip.
4. Add unit and DOM tests, and the harness checks the stage names.

### Stage 0: correctness and sync (patch, no new permissions)

- H1: edit conflicts. Keep `version`, send `expectedVersion`, take the new version from each reply,
  and send one edit at a time.
- H2: show the server's 4xx message.
- H3: layer queued changes over cached reads.
- M5: refresh outcomes as on the web.
- M6: check JSON before caching.
- M7: notifications open their item, "mark all" is queued, the toolbar badge follows the app at once.
- M10: tasks in hidden columns.
- M12: keep `data.user`, and re-read roles after a refresh.
- L13: temporary ids.
- L16, L20, L21.
- Chat sends carry `clientId` (the same value as the idempotency key).
- A longer timeout for downloads.
- "Saved on this device" in the drawer.

Files:
- `E src/{auth,api,queue,read-cache,session}.js`
- a new `E src/pending-overlay.js`
- `E app/app.js`, `E app/components.js`
- `E app/screens/{task-detail,board,notifications,chat,settings,login}.js`
- `E background/service-worker.js`
- tests in `E src/*.test.js` and `screens.dom.test.js`

### Stage 1: MV3 tidy-up, versions, accessibility (patch)

- Add `minimum_chrome_version: "116"` and remove the `storage.local` token fallback.
- Justify or drop `unlimitedStorage`.
- Delete the dead modules and the unused icons, or exclude the images in `build-release.mjs`.
- Show the extension and server versions (`GET /version`). For zip installs, say when the server is
  newer, with a link to the web's About page.
- Keyboard: Enter or Space opens a card, plus a "Move to…" menu on each card.
- The drawer becomes a proper dialog (role, Escape, focus).
- Add drift tests for `due-date.js` against `W lib/due-date.ts`, and for `recurrence.js` summaries
  against `B modules/tasks/recurrence-summary.ts`.
- Add a lint script.
- Move the CDP harness into `tools/extension-e2e/`.

Files:
- `E manifest.json`, `E icons/`, `E package.json`
- a new `E src/version.js`
- `E app/screens/{settings,board,task-detail}.js`, `E app/app.css`
- `tools/release/build-release.mjs`
- `tools/extension-e2e/*`

### Stage 2: quick capture (minor)

The popup (`action.default_popup`):
- title, project (current or last used), column, priority, due date, "Assign me" or people,
  description;
- "Describe it" (`/ai/parse-task`), shown only when AI is set up. How to detect that is unverified;
  `GET /ai/models` is a candidate;
- paste or drop pictures and files, uploaded after the task is created (online only, as on the web);
- "Add this page" (`activeTab`);
- recent tasks, and "Open MICO360 Tasks". Clicking the icon no longer opens the tab once there is a
  popup.

Elsewhere:
- a context-menu item "Add to MICO360 Tasks" for a selection, link or page (`contextMenus`);
- a keyboard command (`commands._execute_action`);
- offline: the task is queued without its files, as on the web.

Files:
- `E manifest.json`
- new `E popup/{popup.html,popup.js,popup.css}`
- `E background/service-worker.js` (create the context menu in `onInstalled`, handle `onClicked`)
- `E src/quick-add.js` (bring it back into use)
- `E src/api.js` (upload, AI parse)
- `E src/auth.js` (FormData headers)
- a new `E src/clipboard-files.js`, ported from `W lib/clipboard-files.ts`, with a drift test
- `tools/release/build-release.mjs:424` (add `popup`)

### Stage 3: task drawer parity (minor)

- attachments (list, image preview, upload, paste, delete);
- the "From meeting" chip, opening the meeting on the web;
- milestone and start date;
- tags (`GET /tags`, `PUT /tasks/:id/tags`);
- an assignee picker (`GET /projects/:id/members`);
- watch/unwatch;
- @mentions (`/tasks/:id/mentionable`);
- threaded comments with edit and delete;
- activity, read-only;
- delete one copy or the whole series;
- editing the whole series.

Files:
- `E app/screens/task-detail.js`, split into section modules under `E app/task/`
- `E src/api.js`
- a new `E src/mentions.js`, copied with a drift test, the way the web and Android share the helper
- `E app/app.css`

### Stage 4: board, My Tasks, projects (minor)

- Board: add a task in any column with the Stage-2 form, card badges (assignees, counts, due date,
  milestone).
- My Tasks: project filter, sort, quick "mark done" (move to the project's Done column).
- Projects: number, picture or icon, readable status names, "Open dashboard on the web".

Files:
- `E app/screens/{board,my-tasks,projects}.js`, `E app/components.js`, `E app/app.css`
- a new `E src/project-identity.js`. How the web draws icons is in `W lib/project-icons.tsx` (the
  server's list is in `B modules/projects/project-icons.ts`).

### Stage 5: notifications and chat stay current (minor)

Notifications:
- the desktop alert can name the newest item (a setting);
- the notification-preferences screen (`GET/PUT /notifications/preferences`).

Chat:
- poll the open thread every 10–15 s while it's on screen. Socket.io is only an option if a
  feasibility check passes (unverified, see M8);
- show attachments, reply quotes and reactions;
- send files and pasted pictures;
- load older messages (`?before=`);
- start a new DM (`POST /conversations/direct`);
- muted, archived and favorite;
- `POST /conversations/:id/delivered`.

Files:
- `E app/screens/{notifications,chat,settings}.js`
- `E src/{chat,notify,api}.js`
- `E background/service-worker.js`

### Stage 6: search, calendar, light meetings (minor)

- Search: Ctrl+K (`GET /search`), plus an omnibox keyword (manifest `omnibox`).
- Calendar: `GET /calendar` (projected repeats) plus `GET /meetings?from&to`, in your own time zone
  and week start (`/users/me/preferences`).
- Dashboard: "Up next", with Join, RSVP and "Open on the web". RSVP uses
  `PATCH /meetings/:id/attendees/:attendeeId`; whether an invitee may change their own row is
  unverified.

Files:
- a new `E app/screens/search.js`
- `E app/screens/{calendar,dashboard}.js`
- `E app/app.js` (shortcut, route)
- `E src/api.js`
- `E manifest.json`

### Stage 7 (optional): side panel

- `sidePanel` permission and `side_panel.default_path`.
- A compact Today / My Tasks view with quick add.
- The layout must work at 320–400 px. Today the CSS has a single 760 px breakpoint
  (`E app/app.css:272-277`).

### Questions to settle before planning

1. Distribution: a Chrome Web Store listing (auto-updates, store review), or keep the zip?
2. With a popup, a toolbar click opens the popup instead of the full app. Is that accepted? Or should
   quick capture be only a keyboard command plus the context menu?
3. Should "Describe it" (AI) be in the extension, and how should it detect that AI is set up?
4. Live updates: is polling enough, or should socket.io be checked from `chrome-extension://`?
