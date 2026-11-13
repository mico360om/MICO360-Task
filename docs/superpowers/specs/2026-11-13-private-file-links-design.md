# Private file links for task and chat files — design

13 Nov 2026 · for review finding #1 and N9 · read-only research, nothing built.

> **Owner's decision, 13 Nov 2026: "Approve, build it"**, with the four recommended answers to §14:
> 1. A link works about a day (24–30 hours), and only while that person can still see the task or chat.
> 2. On today's phone app, a task left open over a day shows the "no longer works" page until the task is reopened. Accepted.
> 3. Old or expired links show a short page ("This link no longer works; open the task or chat in MICO360 Tasks") and never say why.
> 4. Replaced profile photos stop opening; only each person's current photo stays public.
>
> Also (owner rule, 13 Nov): nothing under `Android App/` or `Extension/` changes. Both keep working through the same-field, same-path signed links, proved by the client check script and their existing test suites; the compatibility tests §10 asks for live in the backend's tests instead (they import the app's and the extension's own helpers). Pre-release owner check 1 (§13) is done: live answers carry no CDN or cache-hit headers. Built on `fix/protected-files`; ships as release 1.23.30 (renumbered 13 Nov: a save-conflicts fix took 1.23.29).

Code read at `D:/mico-release/wt-int127` (branch `integrate/1.23.27`, commit `d2c37115`). Evidence is given as `path:line`, relative to that folder unless the path is absolute. Older app releases were read with `git show v1.1.0:…` and `git show v1.0.1:…`.

---

## 1. Intent

The owner was asked: "Should task and chat files open only for people who can still see that task or chat?" He answered **"Yes, protect them."** That means:

- A task or chat file opens only for someone who can still see its task or chat. Removal from the project, deactivation, and the task being in the Recycle Bin all stop access.
- Old copied links stop working.
- Profile photos, project pictures and company logos stay public, because emails and the share-link page use them.
- The Android app that people have today keeps working without an update. A new signed build needs the owner's keystore, and the app is paused ("website first").

## 2. The decision in one paragraph

Task and chat files keep their address, `/uploads/<storageKey>`, with a query string added: `?u=<userId>&e=<expiry>&s=<signature>`. The server writes this signed link into the **same `url` field** the website, the Android app and the extension already read, signed for the person asking.

On every download, the server checks four things:
- the signature and the expiry;
- that the account is still active, with the same session version;
- that the person can still see the task or the conversation **right now**;
- that the task is not in the Recycle Bin and its project is not deleted.

The links are deterministic within a 6-hour block and stop working 24–30 hours after they are issued. A chat message with a file is sent to each connected person signed for them, instead of one copy to the whole room.

Unsigned or stale links to task and chat files get **403 with a short plain page**. Profile photos, project pictures and logos are served as today. Any other file in the folder (an old photo, an orphan) gets 404.

**No change is needed in the Android app (any released version) or the extension.** The website needs only a small, optional link-refresh helper.

## 3. Goals and non-goals

**Goals**
1. A task or chat file is downloadable only by someone who can see its task or conversation now. Every download is re-checked, including HEAD, Range and conditional requests.
2. Removal from the project, a deactivated account, a revoked session (password change, "sign out everywhere"), a task in the Recycle Bin and a deleted project all stop access at once (within the 10-second account cache the API already has).
3. Old unsigned `/uploads/<key>` links to task and chat files stop working, including links pasted in comments, bookmarks, browser history and old data exports.
4. Today's Android app (1.1.0, and 1.0.1 or older) works unchanged. So do the extension and the not-yet-signed current Android source.
5. Avatars, `/uploads/faces/*`, project pictures and company logos stay public, at the same addresses.
6. A chat full of pictures never counts against the API's 600-per-minute limit.

**Non-goals**
- Moving files out of the uploads folder, or encrypting them on disk.
- Signing avatars, project pictures or logos.
- Per-download audit records for staff (the client portal already audits client downloads).
- Changing the Client portal, the share-link page, the Learning Hub, backups or the APK download.
- Fixing #18, #23 and #24 themselves. The design works better with them; see §13.
- Meeting-note and decision attachments. Their tables exist (`Web Portal/backend/prisma/schema.prisma:1803-1817`, `:1901-1915`), but no code has ever written them: the only reference is a defensive count in `modules/recycle-bin/prisma-bin-store.ts:272-279`, and git history finds no writer.

## 4. Constraints

- **Android cannot change.** The released APKs read `url` from `GET /tasks/:id/attachments` and open it with no headers (§9). Any scheme that needs a header, a cookie or a different field breaks them.
- **The current Android source and the extension only accept `/uploads/…` paths.** Android's `serverFileHref` (`Android App/src/lib/attachments.ts:39-60`) and the extension's `isUploadPath`/`attachmentUrl` (`Extension/src/file-kind.js:43-64`) refuse any other path.
- **The website adds the origin to a relative path.** It builds `` `${API_ORIGIN}${a.url}` `` (`Web Portal/frontend/src/components/task-drawer/attachments.tsx:275`) and `fileUrl(path)` (`Web Portal/frontend/src/api/chat.ts:54-56`), so `url` must stay server-relative. An absolute URL would be doubled.
- **A chat broadcast is shared by the whole room.** One emit goes to everyone (`Web Portal/backend/src/realtime/realtime.ts:203-205`), and its message carries `attachments[].url` (`modules/chat/chat-routes.ts:113`, `:207`; `modules/chat/message-service.ts:347`).
- **The migration** must be add-only, safe on MariaDB 11.8 and MySQL 8, with no isolation-level statements.
- **One Node process** serves the live site (Hostinger, through `server.mjs`) and the Windows server. nginx proxies `/uploads/` to the backend and never serves it from disk (`deploy/nginx/task.mico360.com.conf:119-126`).

## 5. What exists today (verified)

**Storage and serving**
- One storage holds every upload: `createLocalDiskStorage({ baseDir: UPLOAD_DIR, publicPrefix: '/uploads' })` (`Web Portal/backend/src/server.ts:651`).
  - A key is `randomUUID()` plus an extension (`modules/tasks/local-disk-storage.ts:23`), and the stored `url` is `/uploads/<key>` (`:27`).
  - v0.1.0 used the uploader's own extension (`git show v0.1.0:…/local-disk-storage.ts:21`), so old keys may have odd extensions.
- `/uploads/` is served by `@fastify/static` with no authentication (`server.ts:2910-2926`).
- Headers come from `uploadResponseHeaders` (`lib/upload-safety.ts:86-98`):
  - `nosniff`;
  - a sandbox CSP;
  - `Cache-Control: private, no-cache`;
  - `Content-Disposition: attachment` for anything that is not a raster image.
- `app.ts:594-607` adds `Cross-Origin-Resource-Policy: cross-origin` and `noindex` for `/uploads/`.
- `/uploads/faces/:file` is its own route (`modules/users/avatar-faces.ts:146-159`, registered at `server.ts:2918`).

**Who writes to the folder** (the complete list found):
- task files (`modules/tasks/attachment-service.ts:72`);
- chat files (`modules/chat/chat-routes.ts:191`);
- avatars (`modules/users/user-routes.ts:229`);
- project pictures (`modules/projects/project-routes.ts:285`);
- company logos (`modules/companies/company-service.ts:274`).

Learning Hub files are kept elsewhere on purpose (`modules/training/training-files.ts:10-13`, `:29-40`).

**Public picture columns:**
- `users.avatarUrl` (`schema.prisma:97`);
- `companies.logoUrl` (`:262`);
- `projects.imageUrl` (`:330`).

**Protected rows:**
- `task_attachments.storageKey` and `url` (`schema.prisma:1095-1117`);
- `chat_attachments.storageKey` (`:1506-1518`).

Neither has an index on `storageKey`.

**Rate limit**
- Global, 600 per minute per user (`app.ts:562-571`).
- It applies only to `/api/…`: `isRateLimitExempt` returns true for anything else (`app.ts:487-489`). `/uploads` is therefore outside it today.

**Account check**
- `createAuthGuard` re-reads the account (active, token version, roles), cached for 10 seconds (`modules/auth/auth-guard.ts:62-84`).
- The lookup is in `modules/auth/prisma-user-state-lookup.ts:5-20`.
- The token version goes up on a password reset, the first password, and session revocation (`modules/auth/prisma-reset-user-repo.ts:34`, `modules/auth/first-password.ts:149`, `modules/users/prisma-user-repository.ts:253`).

**Task access**
- `canViewTask` returns true for any administrator, without checking whether the task is deleted (`modules/projects/project-access.ts:51-55`).
- For everyone else it resolves through `projectIdOfTask`, which ignores deleted tasks and deleted projects (`modules/projects/prisma-member-repository.ts:101-104`).

**Chat access**
- A project channel requires a project that is not deleted, then visibility or administrator (`modules/chat/prisma-chat-repository.ts:233-239`).
- A direct chat requires being a participant (`modules/chat/message-service.ts:181-184`).
- `canUserAccessConversation` exists (`message-service.ts:220-223`).

**Precedents**
- *Client portal file route:* signed in, its own limit of 30 per minute, bytes only, `no-store`, sandbox CSP, RFC 6266 name (`modules/clients/portal-routes.ts:129-142`, `:43-52`; `modules/clients/portal-service.ts:580-591`). The portal payload never carries an address (`modules/clients/portal-payload.ts:274-293`).
- *Backup signed links:*
  - an HKDF-derived HMAC key per purpose, and `body.sig` (`modules/backups/one-time-tokens.ts:9-24`);
  - a public route that checks "still an active admin" when the link is used (`modules/backups/backup-routes.ts:52-75`);
  - classed `public` in `modules/companies/route-classes.ts:54`.

## 6. Options weighed

| Option | How | Today's Android | Extension | Website | Verdict |
|---|---|---|---|---|---|
| **A. Signed link on the same path** `/uploads/<key>?u&e&s` | Server signs per viewer and re-checks on download | Works (§9) | Works | Works | **Chosen** |
| B. Signed-in route + blob loading | `GET /api/v1/files/:id` with Bearer; clients fetch, then `blob:` URL | Breaks: `<Image>` and the browser send no header | Breaks (raw `<img>`, `<a>`) | Needs a rewrite | Rejected |
| C. Signed link on a new path (`/files/…`) | As A, but a different path | 1.1.0 works; the current source refuses it (`serverFileHref` → null) | Refused (`attachmentUrl` → null) | Works | Rejected |
| D. Cookie on `/uploads` | A session cookie read by `/uploads` | Breaks (Chrome opens the file with no cookie) | Breaks (no cookie from the extension) | Partly | Rejected |
| E. Link not bound to a person | A per-file or per-room token | Works | Works | Works | Rejected: it cannot tell who is downloading, so it cannot re-check access |

These results were checked with `scratchpad/files127/client-href-check.mjs`. The script copies the Android helpers word for word and imports the extension's `file-kind.js`.

- **Format A** passes all four helpers.
- **An absolute URL** is doubled by the website (`https://hosthttps://host/uploads/…`) and refused by the extension.
- **`/files/…` and `/api/v1/files/…`** are refused by Android's `serverFileHref` and by the extension.
- **A token containing `..`** is refused by the extension, so signatures must not contain dots.

## 7. Decided design

### 7.1 The link and how it is signed

```
/uploads/<encodeURIComponent(storageKey)>?u=<userId>&e=<expiry>&s=<signature>
```

- **`u`:** the viewer's user id. It is a cuid, so letters and digits only.
- **`e`:** the expiry, in Unix seconds written in base 36.
- **`s`:** `base64url(HMAC-SHA256(K, "f1|" + storageKey + "|" + u + "|" + e + "|" + tokenVersion))`, at least 128 bits (22 characters).
  - The viewer's current **token version** is inside the signature but not in the link. A password change, "sign out everywhere" or revoked sessions end every link that person holds, at no extra cost.
- **The key `K`:** `hkdfSync('sha256', JWT_ACCESS_SECRET, 'mico360-file-links', 'mico360/file-links/v1', 32)`, the same pattern as `modules/backups/one-time-tokens.ts:11`.
  - An optional `FILE_LINK_SECRET` overrides the base secret.
  - `f1` versions the format.
- **Characters:** only `[A-Za-z0-9_-]` plus `?&=`. No `.`, `%`, `#` or `\`. This satisfies `isUploadPath` (`Extension/src/file-kind.js:43-52`) and `serverFileHref` (`Android App/src/lib/attachments.ts:52-59`).
- **Expiry in blocks:**
  - `block = floor(now / 6 h) × 6 h`, aligned to UTC;
  - `e = block + 30 h`;
  - so every link made in one 6-hour block is the same for the same person and file, and is valid for 24–30 more hours.

  Stability matters as much as lifetime. The extension compares `a.url` to decide whether to redraw a message, polling every 12 seconds (`Extension/app/chat/message.js:60-66`, `Extension/src/chat.js:80-86`). The website and Android redraw when the address changes. Android's picture cache is keyed by the full address. A new signature on every request would download every picture again on every poll or refetch.
- **The verifier refuses:**
  - a missing or repeated parameter;
  - `e` in the past;
  - `e` more than 31 hours ahead;
  - a signature that doesn't match, compared timing-safe.

### 7.2 Serving and the check

Replace the open static registration (`server.ts:2919-2925`) with one route, `GET /uploads/:file` (Fastify adds HEAD).
- Keep `@fastify/static` registered with `serve: false`, so `reply.sendFile` keeps ETag, 304, Range/206 and the streaming it does today.
- `registerWebApp` relies on those reply decorators (`lib/web-app.ts:233`).
- `/uploads/faces/:file` stays as it is. It is a deeper path, so it never competes with this route.

The route does this, in order:

1. **Name check.**
   - Decode `:file`.
   - Refuse with 404 any name with `/`, `\`, `..`, NUL, or more than 200 characters.
   - Keep the rest as the key. Don't insist on a UUID pattern: v0.1.0 keys may carry any extension.
2. **Classify the key**, with an LRU cache of up to 10,000 keys for 60 seconds:
   - **protected:** any `task_attachments` or `chat_attachments` row has this `storageKey`. Protected wins if a key were ever in both places.
   - **public:** the key is today's value of some `users.avatarUrl`, `projects.imageUrl` or `companies.logoUrl` (`'/uploads/' + key`). These tables are small; an exact-value query on a miss is fine without an index.
   - **unknown:** anything else gets 404.
3. **Public:** `sendFile` with today's headers. No signature is asked for, and none is ignored.
4. **Protected:**
   1. Parse `u`, `e`, `s`. Missing or malformed: **refuse**.
   2. If `e` has passed or is too far ahead: refuse.
   3. Read the account of `u` with the guard's 10-second cache. Add a small `guard.accountState(userId)` that shares the guard's cache (`auth-guard.ts:66-84`). It must be active, and not a client account.
   4. Recompute the signature with the account's current token version and compare it timing-safe.
   5. **Access**, allowed when any row for the key passes:
      - **Task row:** the task is not deleted (Recycle Bin), its project is not deleted, **and** `projectAccess.canViewTask(u, roles, taskId)`. The two deletion checks are explicit because `canViewTask` lets administrators through binned tasks (`project-access.ts:51-55`).
      - **Chat row:** the message is not deleted, **and** `chat.canUserAccessConversation(conversationId, u)`. For a project channel that covers a deleted project and visibility; for a direct chat, participation.
      - Cache each decision for 10 seconds per (user, task) or (user, conversation), the same window as the account cache.
   6. Allowed: `sendFile` with the headers in §7.7. Refused: §7.9.
5. **Order:** run the cheap checks (format, expiry) before any database read. Read the account before the HMAC (the version is part of it). Do the access queries last.

**Route classes:** add `'GET /uploads/:file': 'public'`, with the same comment style as `GET /backups/download` (`modules/companies/route-classes.ts:54`). `route-classes.test.ts` checks the table.

### 7.3 How the API returns file links

**One helper** (for example `modules/files/file-links.ts`):
- `fileLinks.sign(storageKey, viewer)`, where `viewer = { id, ver }`;
- `fileLinks.verify(...)` for the route.

**Viewer:**
- On HTTP, take it from `req.user`. Add `ver` (the token's version, already checked against the account) in `authenticate` (`auth-guard.ts:110-143`).
- On sockets, take it from `socket.data`.

**The stored values do not change.** The `url` column (`/uploads/<key>`) stays as it is. The link is built at the moment of answering.

Places that put a task or chat file address into an answer (all found):

| Answer | Where | Change |
|---|---|---|
| `GET /tasks/:id/attachments` | `modules/tasks/attachment-routes.ts:35-39` | Sign each `url` for `req.user` |
| `POST /tasks/:id/attachments` (201) | `attachment-routes.ts:41-53` | Sign |
| `PUT /tasks/:id/attachments/:attachmentId/client-visible` | `attachment-routes.ts:75-87` | Sign |
| `GET /projects/:id/chat` | `modules/chat/chat-routes.ts:83-89` | Sign every message's `attachments[].url` |
| `GET /conversations/:id/messages` | `chat-routes.ts:99-105` | Sign |
| `POST /conversations/:id/messages` (200 retry, 201) | `chat-routes.ts:108-115` | Sign the response; broadcast per §7.4 |
| `POST /conversations/:id/attachments` (200 retry, 201) | `chat-routes.ts:156-211` | Sign the response; broadcast per §7.4 |
| `chat:message` socket event | `chat-routes.ts:68-75`, `:113`, `:207` | One copy per person (§7.4) |
| `GET /users/me/export` | `modules/users/data-export.ts:90-92` (selects `url`) | Sign for the requester (or drop `url`; signing keeps the shape) |

- **Chat.** `message-service.ts:347` builds `url` today. It should keep producing the plain path, and the routes sign it. Another option is a signer passed in per call. Either way, never sign inside the shared view that is also broadcast.
- **`storageKey` stays in the answers.** It is in both shapes today (`modules/tasks/prisma-attachment-repository.ts:12`; `modules/chat/chat-repository.ts:61-69`). No client builds an address from it, and knowing it no longer opens anything.
- **Checked, with no file addresses:**
  - task-merge facts (counts only, `modules/task-merge/merge-facts.ts:138`);
  - the Recycle Bin (names and sizes, `modules/recycle-bin/prisma-bin-store.ts:138`);
  - search and MICO AI (links to tasks, meetings and chats, not files: `modules/mico-ai/mico-ai-tools.ts:206-223`, `:899`);
  - task duplicate (copies bytes under new keys, `modules/tasks/task-duplicate.ts:346-364`);
  - the Client portal (no addresses);
  - notifications, emails and PDFs (§7.12).

### 7.4 Chat: live messages, history, conversation list

- **History pages** (`GET /conversations/:id/messages`, `GET /projects/:id/chat`) are signed for the reader (§7.3). One API call returns the whole page, so a chat with 50 pictures is one API request. The 50 picture requests go to `/uploads`, outside the API limit.
- **The live `chat:message` event, when the message has files:**
  - Send one copy per connected socket, each with links signed for that socket's person.
  - Store `socket.data.ver` at the handshake. `realtime.ts:80` already reads `ver`.
  - Add `realtime.broadcastPersonal(target, event, (userId, ver) => payload)`:
    - for a project channel, the sockets in `project:<id>`;
    - for a direct chat, the sockets in each participant's `user:<id>` room;
    - each socket gets its own `emit`.
  - Use the in-memory adapter's synchronous room lookup (`io.of('/').adapter.rooms.get(room)` → `io.sockets.sockets.get(id)`). Events then keep their order relative to the synchronous `chat:read`, `chat:reaction` and `chat:message:edited` broadcasts. `fetchSockets()` is asynchronous; it is already used in `realtime.ts:249` and `:284`.
  - Cost: one HMAC per file per online person. Trivial.
  - **Messages without files** keep the single room broadcast.
- **The edit event** carries a `Message` with no files (`message-service.ts:398-407`). The website and Android patch only the text (`Web Portal/frontend/src/pages/ChatPage.tsx:285-286`; `Android App/src/lib/chat-realtime.ts:67-71`). No change.
- **The conversation list preview** carries no files. `lastMessage` is a plain `Message` (`message-service.ts:83`, `:504`, `:541`). No change.
- **The extension** has no socket. It polls the history every 12 seconds (`Extension/src/chat.js:80-86`; `Extension/app/chat/thread.js:42`, `:191-196`), so it always gets fresh links.

### 7.5 Expiry and refresh in each client

| Client | What it does today | Link life needed | Change |
|---|---|---|---|
| **Website** | Task files list: `staleTime` 30 s, refetched when the panel opens. Chat: fetched once, then updated live and invalidated on reconnect. `refetchOnWindowFocus: false` (`Web Portal/frontend/src/lib/query-client.ts:15-23`). Query results live in memory only. | As long as a tab stays open without refetching | **Recommended, small:** (1) `onError` on task and chat file `<img>` (`task-drawer/attachments.tsx:287`, `:127`; `chat/MessageItem.tsx:166`; `chat/parts.tsx:186`): invalidate that list, at most once a minute; (2) a timer that invalidates a list an hour before its earliest `e`; (3) a preview `fetch` that answers 403 (`task-drawer/attachments.tsx:90`) invalidates and retries once. |
| **Android 1.1.0** (and 1.0.1) | List fetched when the task opens (`staleTime` 30 s, memory only, no offline copy of files) | Longer than a task screen stays open | None. A screen left open longer than a day, then a tap on a file, opens the "no longer works" page; reopening the task fixes it. |
| **Android current source** (not signed yet) | Same for task files. The newest chat page per thread is kept offline (`Android App/src/lib/chat-cache.ts:11-15`). Pictures show offline only from the phone's picture cache, keyed by the full address. | The same, plus stable addresses for cache hits | None. When back online, the thread refetches and gets new links. |
| **Extension** | Task detail read when opened; chat polled every 12 s | As website | None. |

### 7.6 The extension's cross-origin loading

- The extension shows files with plain `<img src>` and `<a href target=_blank>`, built by `attachmentUrl(apiBase, a.url)` (`Extension/app/task/attachments.js:42`, `:80-93`, `:184-193`; `Extension/app/chat/message.js:68-80`).
- Its manifest sets no CSP for `img-src`, and it has host permission for the live site (`Extension/manifest.json:28-29`).
- Such loads send no cookies and no headers, and the link carries its own authority. They need only one thing: **keep `Cross-Origin-Resource-Policy: cross-origin` on every `/uploads` 200 response**, protected files included (`app.ts:594-597`). Helmet's global `same-origin` would otherwise block them, as the comment at `app.ts:589-593` explains.
- CORS headers don't matter for `<img>`. The website's `fetch` for PDF previews already gets them from the global CORS plugin.

### 7.7 Rate limits and caching headers

- **Keep file serving off `/api/`**, so `isRateLimitExempt` keeps `/uploads` outside the 600-per-minute API limit (`app.ts:487-489`).
- **Optional:** a separate limit of about 1,200 per minute per link user, or per IP when there is no link, set on the route. It must never share the API's counter.
- The 10-second account and access caches, plus the 60-second key cache, keep a page of 50 pictures to a handful of database reads.
- **Protected file responses** use today's `uploadResponseHeaders` (`lib/upload-safety.ts:86-98`):
  - `nosniff` and the sandbox CSP;
  - `Content-Disposition: attachment` for anything but raster images;
  - **`Cache-Control: private, no-cache`**: the browser may keep a copy but must ask again before each use, so revalidation runs the access check and a removed member gets no 304;
  - ETag and Last-Modified from `sendFile`;
  - CORP `cross-origin`; `X-Robots-Tag: noindex`.

  `max-age=3600` would cut the revalidation requests if load ever shows a need. It is not recommended now, because it would let a removed person's browser keep showing a copy for up to an hour.
- **Public pictures:** unchanged. Faces stay `immutable` (`modules/users/avatar-faces.ts:142`).
- **Refusals:** `Cache-Control: no-store`.
- **Logs:** Fastify request logging is off (`app.ts:518-522`). If the Error log records a request address for an `/uploads` failure, strip the query first. The website's error capture already ignores `/uploads` (`Web Portal/frontend/src/lib/error-capture.ts:311`).

### 7.8 The migration

New folder after `20261115010000_training_center` (for example `20261116010000_file_link_indexes/migration.sql`), modelled on `prisma/migrations/20261028121000_task_schedule_indexes/migration.sql`:

```sql
-- Private file links: a file's rows are found by its stored name on every download.
-- CreateIndex
CREATE INDEX `task_attachments_storageKey_idx` ON `task_attachments`(`storageKey`);

-- CreateIndex
CREATE INDEX `chat_attachments_storageKey_idx` ON `chat_attachments`(`storageKey`);
```

- Add `@@index([storageKey])` to `Attachment` and `ChatAttachment` in `schema.prisma`, and the same in `schema.postgres.prisma`.
- **Why it is safe:**
  - `VARCHAR(191)` in utf8mb4 is 764 bytes, under InnoDB's 3,072-byte limit on both MariaDB 11.8 and MySQL 8;
  - a secondary index builds online by default;
  - nothing is dropped or changed, and there are no isolation or locking statements;
  - an older server version ignores the extra index, so rollback stays safe.
- The public picture columns need no index (§7.2).

### 7.9 Old `/uploads/<uuid>` links

| Request | Answer |
|---|---|
| Task or chat file, no link, or an expired, changed or wrong-person link, an inactive account, no access, a binned task or a deleted project | **403**, `text/html; charset=utf-8`, `no-store`, `noindex`, a page with no script or outside resources and a viewport meta. The same words for every reason, so it never says why. Suggested words: "This file link no longer works. Open the task or chat in MICO360 Tasks to get the file. If you can no longer see it, ask the project's manager." |
| Avatar, project picture, company logo (today's values), `/uploads/faces/*` | 200 as today |
| Any other name (a replaced photo, an erased file, an orphan, nonsense) | 404, `no-store` |

- **What stops working (intended):**
  - links pasted into comments or chats;
  - bookmarks and browser history;
  - `url` values in data exports made before the change.
- **Side effect (intended):** replaced profile photos now get 404, which fixes most of #24. Their small face copies are a separate route and are left to #24.

### 7.10 The Client portal, guests and the share-link page

- **Client portal:** unchanged. Clients download through `GET /portal/projects/:p/tasks/:t/files/:f` with their session (`portal-routes.ts:129-142`; the website calls it with `getBlob`, `Web Portal/frontend/src/api/portal.ts:245`). The portal's answers never carry an address (`portal-payload.ts:278-293`).
- **Links for clients:** none is ever made. Their sessions can't call the staff routes that sign (`auth-guard.ts:52-60`). The file route also refuses a client account named in `u`.
- **Client uploads:** they are task files (`fromClient`), so staff see them through signed links like any other file.
- **Guests** are external contacts with no account (`modules/guests/guest-conversion.ts:9-17`). Nothing changes.
- **The share-link page** `/client/<link>` shows only the project picture and the company logo (`modules/client-view/client-view-payload.ts:225`, `:247`). Both stay public. No change.

### 7.11 The Recycle Bin and deleted projects (N9)

- **Binned task** (`deletedAt` set): every file is refused, **administrators included**. This matches the Bin, which lists names and sizes only (`prisma-bin-store.ts:138`).
- **Restore:** the task's files open again. New lists carry new links, and an earlier link still inside its life works again, because the check is live.
- **Deleted project:**
  - its task files are refused for everyone (explicit `project.deletedAt` check);
  - its channel's files are refused through `canAccessProject` (`prisma-chat-repository.ts:233-235`).
- **Erase** (rows go): the key is "unknown", so 404, even if file removal failed and the bytes stay on disk (`modules/recycle-bin/bin-service.ts:317`). That also closes the orphan cases of #23.
- **Deleted chat message:** its rows and files are purged (`message-service.ts:409-420`). Any bytes left behind get 404.

### 7.12 Emails, PDFs, Excel, notifications, MICO AI, search, data export

- **Emails:** only project pictures and logos are addresses (verdicts group A; `modules/daily-emails/daily-email-content.ts:48`, `:144`; `modules/meetings/meeting-notify-service.ts:60-62`). Both stay public, so emails are unchanged.
- **PDFs** (task, minutes, report, inspection): embed the bytes, read straight from storage by key (`modules/tasks/task-export.ts:254-290`; `server.ts:2809-2811`). Unchanged.
- **Excel:** file names and sizes only (`task-export.ts:25-38`). Unchanged.
- **Notifications:** text and links to tasks only. No `/uploads` address in any notification module. Unchanged.
- **MICO AI:** links to tasks, meetings and chats, never files (`mico-ai-actions.ts:542`, `:563`; `mico-ai-tools.ts:206`, `:223`, `:899`). Unchanged.
- **Search:** file results open the task with `&file=<id>` (`task-drawer/attachments.tsx:277-282`). No address. Unchanged.
- **Data export:** signed per §7.3.
- **The website's service worker** never caches `/uploads/` (`Web Portal/frontend/public/sw.js:26`). A query string changes nothing.

## 8. Website, extension and Android: what changes

- **Website:** the optional refresh helper in §7.5. Nothing else; the types and builders already pass `url` through.
- **Extension:** no code change. Tests only (§10).
- **Android:** no code change, and no build. Checks only (§9, §10).

## 9. Today's Android app: the proof

**Which app people have.** The newest signed APK is **1.1.0**, built 17 Oct and kept in `Installer/3-Android-App/`. Later app versions were never signed (the keystore password). Its file code is the same as in 1.0.1.

**How 1.1.0 gets and shows a task file:**
1. **The list.** `useTaskAttachments` → `resources.tasks.attachments(id)` → `GET /tasks/:id/attachments` (`git show v1.1.0:"Android App/src/core/queries.ts"` 187-189; `…/lib/resources.ts` 156).
   - It is kept in memory: React Query, `staleTime` 30 s, refetched when the screen mounts (`…/core/services.ts` 61-69).
   - There is no offline copy for files: offline, the card says "Files aren't available right now" (`…/components/task-detail/InfoCards.tsx` 108).
2. **The address.** `attachmentHref(baseUrl, a.url)`. An `http(s)` value is used as is; anything else becomes the server origin plus `url`, query included (`…/lib/attachments.ts` 19-23).
3. **Thumbnail.** `<Image source={{ uri: hrefOf(a) }}>` (`…/components/task-detail/InfoCards.tsx` 116; `hrefOf` at `…/screens/TaskDetailScreen.tsx` 247). No headers.
4. **Open.** `Linking.openURL(attachmentHref(baseUrl, a.url))` (`TaskDetailScreen.tsx` 169) hands the address to the phone's browser. That browser has no session, so the link must carry its own authority. It does.
5. **Chat in 1.1.0** shows a file as a name chip only, with no address used (`…/screens/ChatThreadScreen.tsx` 121-125). Nothing to break.

**Therefore:** with the signed link in the same `url` field, as a relative `/uploads/…` path, 1.1.0 builds `https://<server>/uploads/<key>?u=…&e=…&s=…`.
- Its `<Image>` loads it.
- Chrome opens or downloads it. Non-images come as attachments, and Chrome's download manager may ask again; HEAD and Range are both checked and served.

This was confirmed with the copied helper in `client-href-check.mjs` (§6).

**The current Android source** (the next build, whenever it is signed) also works unchanged:
- task files use `attachmentHref` (`Android App/src/screens/TaskDetailScreen.tsx:271`, `:368`);
- previews and chat use `serverFileHref`, which accepts `/uploads/<key>` with a query (`Android App/src/lib/attachments.ts:39-60`; `Android App/src/components/chat/MessageParts.tsx:258-267`, `:551-569`; `Android App/src/components/task-detail/FilePreviewSheet.tsx:86`; `Android App/src/lib/file-preview.ts:80-85`);
- live chat messages put the event's message as given (`Android App/src/lib/chat-realtime.ts:63-66`), so the copy signed per person (§7.4) is what it shows.

**How long a link must live on Android.**
- **1.1.0:** only as long as a task screen stays open, because the list is fetched again each time the task opens. Minutes to hours; 24–30 hours leaves a wide margin.
- **Offline:** nothing can be downloaded anyway. A picture seen before shows from the phone's cache only if its address is exactly the same, so stability within the 6-hour block matters more than a long life.
- **Current source, chat offline:** its offline chat copy shows cached pictures under the addresses it saved. Once online it fetches new links.

**What users of 1.1.0 will notice (all intended or harmless):**
- Files of tasks they can no longer see, binned tasks and deleted projects don't open. They get the plain page.
- Links pasted into comments don't open.
- A task screen left open for more than a day, then a tap on a file: the plain page. Reopening the task fixes it. The same happens right after a password change or "sign out everywhere".
- Each picture they look at downloads again at most once per 6-hour block.

**Nothing in the Android app has to change, and it keeps working.**

## 10. Tests

**Server unit** (Vitest, fakes):
- **Signer and verifier:**
  - the same link within a block, a new one in the next block;
  - refusal when the key, user, expiry or version is changed, when the link has expired, or when `e` is too far ahead;
  - a key made for another purpose doesn't work;
  - the characters are limited to `[A-Za-z0-9_-]`.
- **Key classification:** protected over public; public by each of the three columns; unknown → 404; cache expiry.
- **The route** (`app.inject`):
  - unsigned protected → 403 page with `no-store` and `noindex`;
  - signed → 200 with nosniff, sandbox CSP, `private, no-cache`, CORP `cross-origin`, and `attachment` for a PDF;
  - HEAD; Range → 206; `If-None-Match` → 304 only when allowed;
  - each refusal reason → 403: inactive account, changed version, removed member, binned task (administrator too), deleted project (administrator too), not a participant in a direct chat, a client account in `u`;
  - deleted message → 404; avatar unsigned → 200; replaced avatar → 404; faces unchanged; bad names (`..`, `%2e%2e`, `\`) → 404.
- **Answers:** two people get different, working links from `GET /tasks/:id/attachments`, upload, client-visible, history, send, upload in chat, and data export.
- **Realtime:**
  - two sockets of different people in a project room each receive a link that works for them only;
  - a direct chat sends a copy per participant;
  - a text-only message still uses one room broadcast;
  - event order is kept: message, then an immediate reaction.
- **Route classes:** the new row; `route-classes.test.ts` passes.

**Server integration** (`test:db` on MySQL 8 strict and MariaDB):
- the migration applies;
- `SHOW INDEX` lists both indexes;
- the N9 flows run end to end with real Prisma: bin → refused → restore → allowed → erase → 404; project delete → refused.

**End to end on a running server:**
- The group A repro scripts (`scratchpad/verify35/repro/A/uploads-repro.mjs`, `deact-check.mjs`) must flip: unsigned task and chat files 403; removed member 403; deactivated 403.
- Signed links work.
- Avatar, project picture and logo stay 200; the minutes email's project picture loads.
- A scan of every JSON answer in the battery finds no unsigned task or chat `/uploads/<key>`.
- Update any battery or audit script that fetched `/uploads/<key>` without a link.

**Website:**
- Unit tests for the refresh helper: reading `e`, the timer, at most one invalidation a minute.
- Existing drawer and chat tests with the new `url` form.
- e2e (`drawer-e2e`, `chat-e2e`):
  - pictures load (`naturalWidth > 0`);
  - Download and the PDF preview work;
  - with a short link life set for the test (for example a `FILE_LINK_HOURS` test variable), an expired picture reloads after the refetch.

**Extension:**
- Unit: `isUploadPath` and `attachmentUrl` accept a signed `/uploads/<key>?u&e&s` (`Extension/src/file-kind.js:43-64`).
- The extension CDP harness (`tools/extension-e2e`):
  - a task picture and a chat picture load cross-origin;
  - while a conversation polls within one block, `messageSignature` doesn't change, so there is no redraw and no reload.

**Android (no build, no release):**
- The code reading in §9.
- Run the existing Android unit tests (`Android App/src/lib/attachments.test.ts`) with added cases for a signed path in `attachmentHref` and `serverFileHref`. This adds tests only; it doesn't change the app.
- **Optional device check:**
  - install the signed **1.1.0** APK from `Installer/3-Android-App/` on the test emulator (AVD `mico360_tasks_test`) against a local server running the change;
  - open a task with a picture and a PDF: the thumbnail shows, Open shows the picture, the PDF downloads in Chrome;
  - remove the person from the project: tapping again shows the plain page.

## 11. Size and risks

**Size: M overall, about 3–4 builder-days including tests and the battery.**

| Part | Size |
|---|---|
| Server: signer and verifier, file route and checks, caches | M |
| Server: signing in about 9 answers, data export | S |
| Server: per-person chat emit | S |
| Migration | XS |
| Website refresh helper | S |
| Extension | XS (tests only) |
| Android | XS (tests and an optional emulator check) |

It ships as a server-and-website release, with no app build (`release.mjs --web-only`).

**Risks**
1. **An answer is missed:** that screen shows broken pictures. Mitigation: the battery's scan for unsigned file addresses, and the list in §7.3.
2. **On release day,** open tabs and open app screens hold unsigned addresses, so pictures not yet loaded break until a refresh or reopen. One-time.
3. **Shared computers and forwarding:**
   - A link opened in a browser stays in its history and works for up to 30 hours, as that person, while they can still see the task. That is much less than today's permanent links, but it is not zero.
   - A forwarded link works the same way for whoever receives it.
4. **A cache in front of the live site** must honour `private`. LiteSpeed or a CDN that stored `/uploads` answers would bypass the check. This is an owner check (§12).
5. **The per-person emit assumes one Node process,** with the in-memory socket adapter. True on Hostinger and on the Windows server. A cluster would need `fetchSockets()` and a shared adapter.
6. **Default 404 for unknown files:** a file that is neither in a protected row nor in the three picture columns stops loading. Research found no other writer (§5).
7. **Database load:** one check per picture shown. It is bounded by the caches. `/uploads` has no rate limit today either, and an optional separate limit is described in §7.7.
8. **Secret change:** changing `JWT_ACCESS_SECRET` (or `FILE_LINK_SECRET`) ends every file link at once. Lists made afterwards carry new links.
9. **The 10-second account cache** means a just-deactivated person can still download for up to 10 seconds, the same as the API (verdicts group C). Fixing the guard's cache fixes both.

## 12. Left to the builder

- **Module layout and names:** for example `modules/files/file-links.ts` and `modules/files/file-route.ts`, wired in `server.ts` where the static registration is now.
- **The sanity limit on `e`, the signature length** (≥ 128 bits) and the cache sizes.
- **Whether to add the optional per-link-user limit** on `/uploads`.
- **Whether to sign or drop `url` in the data export.** Signing is recommended.
- **The plain page:** exact HTML, kept tiny and with no script.
- **How the chat service hands plain paths to the routes:** a signer per call, or paths that the routes sign.
- **Ordering with #18 and #23:**
  - #18 (chat message and file in one transaction, `safeUploadName` for chat files) and #23 (delete rows first, then files) fit this change well;
  - with the default 404 for unknown keys, "rows first, then files" can no longer leave a public orphan;
  - building them in the same batch is recommended.
- **The face copies of replaced photos** (#24) remain served by their own route. Leave them to #24.

## 13. Owner checks before release

1. Run `curl -sI` on one live `/uploads/<task file>` address. Confirm there is no CDN or LiteSpeed cache-hit header (review report, section 5, check 7).
2. After release, on a phone with the current app: open a task with a picture. The thumbnail shows, and tapping it opens the picture.

## 14. Questions for the owner

1. **How long should a file link work once someone has it?** It is the most a forwarded link, or one left in a shared computer's history, keeps working, and only while that person can still see the task. **Recommended: about a day (24–30 hours).** Shorter means more "this link no longer works" pages for people who leave a task open on the phone. **Owner (13 Nov): as recommended.**
2. **On today's Android app, a task left open for more than a day shows "This file link no longer works" when a file is tapped, until the task is reopened. Is that acceptable?** **Recommended: yes.** It needs no app update, and reopening the task fixes it. **Owner (13 Nov): yes.**
3. **What should an old link show?** **Recommended:** a short page saying the link no longer works, and to open the task or chat in MICO360 Tasks. It should not say why (expired, removed or deleted). **Owner (13 Nov): as recommended.**
4. **Should replaced profile photos stop opening too?** It comes almost free with this change, and fixes most of review finding #24. **Recommended: yes.** Only each person's current photo stays public. **Owner (13 Nov): yes.**
