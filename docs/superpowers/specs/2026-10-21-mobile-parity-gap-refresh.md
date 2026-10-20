# Android app vs web portal: gap refresh

Date: 2026-10-21. This refreshes `2026-10-20-mobile-parity-gap-analysis.md` (the "20 Oct analysis").
It is a read-only review: no code was changed and nothing was run on a phone or a server.

**Versions compared:**
- Web portal and server: 1.3.4 (`e2e8ef5`), plus the work not yet committed in this clone:
  - Minutes PDF picture fixes;
  - meeting action items following their task into Done;
  - project icons in the minutes;
  - the web client's refresh check.
- Android app: 1.3.3, build 15 (`Android App/app.json`).

**Paths:** `A` = `Android App/src`, `W` = `Web Portal/frontend/src`, `B` = `Web Portal/backend/src`.
Line numbers are from the working tree on 21 Oct. "Unverified" means it was read in the code but not
tried.

## 0. The most important findings

1. **Stage 1 is done in code, but probably not on phones.**
   - The only signed APK in `Installer/3-Android-App/` is 1.1.0.
   - 1.2.1–1.3.3 exist only as unsigned builds (`D:/mico-release/apk-121-unsigned.log` …
     `apk-133-unsigned.log`).
   - Unverified: which APK the live site offers today.
2. **The update notice's "Download" does nothing on a site that hosts the APK.**
   - `/config` gives `androidAppUrl` as the relative `/downloads/MICO360-Tasks.apk`
     (`B lib/web-app.ts:26,36-40`). That is exactly when the notice shows.
   - The app hands it to `Linking.openURL` and hides the error (`A components/UpdateBanner.tsx:41,50`).
   - A server-side fix (an absolute address) repairs every installed 1.2.1–1.3.3 (§3 item 1).
3. **AI on the phone fails on MICO360 AI.**
   - App requests stop after 20 s (`A lib/api-client.ts:45`). Since 1.3.0 the server waits up to 120 s
     (`B modules/ai/ai-completion.ts:82`).
   - On a model that is still loading, "Suggest steps" and "Suggest priority" say "You're offline"
     (`A lib/task-detail.ts:15`).
4. **The coming daily-email settings could be wiped by phones.**
   - `PUT /notifications/preferences` replaces the object and keeps only `muted` and
     `reminderLeadMinutes` (`B modules/notifications/notification-routes.ts:29-32`,
     `notification-preferences.ts:16-27`).
   - The app's reminder choice rebuilds it from `muted` alone (`A lib/notification-prefs.ts:45-47`).
   - The new email settings need their own store, or a merging PUT, before any phone touches them.
5. **Stages 2–6 are all still open.** Not one Meetings, Chat, Board, Projects, Calendar, Dashboard,
   Reports, Activity, Profile, Search, About or Users feature has reached the app since 20 Oct (§1).
6. **New web features the app lacks:**
   - files in New task (1.3.4);
   - "+" on every column (1.3.2);
   - adding a picture without the file picker (1.3.1's paste).
   - Server shrinking (1.3.4) already applies to phone uploads. But a photo over 10 MB is refused before
     it is shrunk (`B app.ts:394`), and HEIC is not accepted (`B lib/upload-safety.ts:13-16`).
   - The app's upload errors mostly say "Check your connection" (§3 item 2).
7. **Too many refetches.**
   - One inline edit on task details reloads about 14 queries (`A core/queries.ts:454-458`).
   - Each board event refetches every board date (`A lib/realtime.ts:42-50`).
   - Nothing refetches when the app returns to the front: no `focusManager` or `onlineManager` in `A`.
8. **Unbounded loads with no virtualization.**
   - Task details and the project screen load every task of the project, all days
     (`A screens/TaskDetailScreen.tsx:71`, `ProjectDetailScreen.tsx:32`).
   - `/tasks/mine` returns every task ever assigned (`B modules/tasks/task-routes.ts:230-233`).
   - Each list is written whole to AsyncStorage on every fetch (`A lib/read-cache.ts`).
   - There is no `FlatList` anywhere in `A`.
9. **Roles.**
   - The server has ADMIN and EMPLOYEE, plus project MEMBER and MANAGER. The app mostly under-exposes.
   - Profile shows raw role codes (`A screens/ProfileScreen.tsx:30-33`).
   - The Calendar shows only your own tasks; the web shows your projects' tasks (§5).
10. **Plan corrections.**
    - The meeting AI design says "No Android change" (`2026-10-20-meeting-ai-design.md:70,146`); the plan
      says Stage 2 includes it. The server endpoints don't exist yet.
    - Recommendation: meeting AI on the web first, the app's helpers after the app has a meeting form.
    - Stages 2–5 are split into smaller releases (§7).

---

## 1. The 20 Oct plan, stage by stage: what is still open

### 1.1 Stage 1: security and bug fixes (released as 1.2.1 and 1.2.2)

| 20 Oct item | Now | Evidence |
|---|---|---|
| Push after sign-out | Done | `A core/services.ts:191-204` |
| Plain http | Done in the app; the manifest is still global | `A lib/api-client.ts:176`, `core/services.ts:98`, `lib/exporter.ts:36`, `core/authed-socket.ts:24,30`; `Android App/plugins/with-lan-cleartext.js:10` |
| Biometric sign-in | Done | `A lib/biometric-login.ts`, `lib/auth.ts:20-29` |
| A lost refresh reply | Done | `A core/services.ts:143` |
| Time zones | Done; week start read but unused | `A lib/date-settings.ts:60`, `navigation/RootNavigator.tsx:149-173` |
| Version awareness, incl. the 1.3.3 rule | Done (but see finding 2) | `A lib/app-version.ts:36-47`, `components/UpdateBanner.tsx:21-41` |
| FLAG_SECURE, cold-start flash, lock per user | Done | `A adapters/screen-capture.ts:9-10`, `lib/lock-view.ts`, `lib/user-switch.ts` |
| Exports after sign-out, captive portal | Done | `A lib/sign-out.ts:112`, `lib/api-client.ts:253-260` |
| Edit-conflict check | Done | `A lib/task-writes.ts:36,50`, `core/queries.ts:441-461` |
| Unscoped `GET /tasks` | Done | `A core/queries.ts:66` |
| Offline move, queued banner, hidden column, due day, Arabic digits | Done | `A core/queries.ts:421-424`, `components/QuickAddTaskSheet.tsx:61`, `lib/task-status.ts`, `components/task-detail/DetailsCard.tsx:83-85` |

**Still open from Stage 1 and the 20 Oct §4 bugs:**
- **Ignored events.**
  - The app listens to `task:created`, `task:updated`, `task:moved` and `task:deleted` only
    (`A lib/realtime.ts:53`).
  - The server also emits `task:assignees`, `task:tagged`, `task:watchers`, `checklist:changed`,
    `comment:created`, `comment:updated`, `comment:deleted`, `chat:delivered` and `meeting:*`
    (`B modules/meetings/meeting-events.ts:2`).
- **The repeat editor goes stale.**
  - `ruleDraft` is never cleared after a save that worked (`A components/task-detail/DetailsCard.tsx:89,274-276`).
  - `untilText` is set only once (`A components/RecurrenceEditor.tsx:37`).
  - A change made elsewhere doesn't show (unverified on a phone).
- **No maxLength on the sign-in fields**, only on the code field (`A screens/auth/LoginScreen.tsx:299`).
- **A reset link tapped while signed in** waits until sign-out (`A navigation/RootNavigator.tsx:237`).
- **Cleartext is allowed in the manifest.** It is safe only while every request goes through
  `assertAllowedUrl`. A WebView (the Stage 2 notes editor) would bypass it, so keep its content local.

### 1.2 Stage 2: Meetings (all open)

**Today:**
- Meetings appear only as read-only rows in the Calendar and on the Project screen
  (`A components/MeetingRow.tsx`, `core/queries.ts:316-341`).
- The app calls only `GET /meetings?from&to` and `/projects/:id/meetings-overview` (`A lib/resources.ts:179-184`).

**Missing.** Each is served today by `B modules/meetings/*-routes.ts`:
- list with cards, Up next, search and filters (`meeting-routes.ts:204`);
- details (`:262`): status, RSVP and attendees (`attendee-routes.ts:51-98`); invitations
  (`meeting-routes.ts:369,380`); agenda (`agenda-routes.ts:40-80`); Live notes and note → task
  (`note-routes.ts:63-110`); action items (`action-item-routes.ts:84-111`); Final MOM draft, save,
  approve and reopen (`minutes-routes.ts:308-355`); PDF, preview and send (`:246-275`); duplicate,
  cancel and delete (`meeting-routes.ts:340-396`);
- the Schedule/Edit form with repeat and scope (`:239,269`);
- My Action Items (`action-item-routes.ts:78`);
- a `meeting` deep link. None exists in `A navigation/linking.ts:14-25` or `lib/deep-link.ts:13-31`.
  - The server sends no meeting notifications yet; its entity types are `task`, `conversation` and
    `digest` only.

**The two small fixes are still open:**
- "No notes for this meeting" shows for any meeting without a description (`A components/MeetingRow.tsx:78`).
- "From meeting" opens the website (`A lib/task-detail.ts:66`, `screens/TaskDetailScreen.tsx:183-190`).

**New since 20 Oct:**
- Meeting AI has no server routes. `B modules/ai/ai-feature-routes.ts:30-45` has only breakdown,
  parse-task, summary and suggest-priority.
- Uncommitted:
  - action items now follow their task into Done (`B server.ts`, `onTaskMoved`). App moves trigger it
    too, so My Action Items must refetch after a move;
  - Minutes PDF fixes. These are server-side, so the app just downloads the same PDF.
- Final MOM drafting waits up to 3 minutes (CHANGELOG 1.3.0). The app needs a per-request timeout (§3).
- Formatted notes as on the web probably means a WebView with Tiptap: APK weight, plus the cleartext
  caveat above.

### 1.3 Stage 3: Chat (all open)

**Missing (all 15 from 20 Oct):**
- the DM picker (`startDirect` is unused, `A lib/resources.ts:232`); older history (`before` is unused);
  day separators and the unread divider; replies;
- edit, delete and copy (wrappers unused, `resources.ts:243-247`); reactions; attachments (the chips
  can't be tapped, `A screens/ChatThreadScreen.tsx:123-127`); receipts and presence; an outbox;
- favorite, archive and mute (`B modules/chat/chat-routes.ts:100`); search (`:120`); members (`:114`);
  drafts; the tab badge (`unreadTotal` unused, `A lib/chat.ts:39`); a push opening the thread
  (`A lib/deep-link.ts:44`).

**Bugs:**
- Auto-scroll keys on `messages.length`, which stays at 50 (`A screens/ChatThreadScreen.tsx:59-61`).
- Read is marked only on open (`A screens/ChatScreen.tsx:43,59`), and never from the Project screen
  (`A screens/ProjectDetailScreen.tsx:46-58`).
- `clientId` and `replyToId` are never sent (`A lib/resources.ts:236-243`), although the server
  de-duplicates by `clientId` (`B modules/chat/chat-routes.ts:89-97`).
- The types lack `replyTo`, `clientId`, `prefs` and `lastDeliveredAt` (`A lib/types.ts:270-294`).
- There is no offline copy (`A core/queries.ts:519-531`).
- A failed queued message vanishes, because only pending ones are shown (`ChatThreadScreen.tsx:56-58`).
- Mentions suggest the whole directory (`:35-38`).
- Every event refetches the conversation list and the thread (`A lib/chat-realtime.ts:27-32`).

### 1.4 Stage 4: Tasks and board (all open)

**Board:**
- No reordering or drop position: the move sheet sends no position (`A screens/BoardScreen.tsx:47`),
  though `PUT /columns/:id/tasks/reorder` exists (`B modules/tasks/task-routes.ts:333`).
- No project switcher.
- No column management (`B modules/projects/column-routes.ts:45-63`).
- No date picker, only previous and next day (`BoardScreen.tsx:76-90`).
- Cards show no assignees or counts, and use the category colour instead of `column.color`
  (`A lib/types.ts:146`, `BoardScreen.tsx:126`).

**Create task:**
- only from one FAB (`BoardScreen.tsx:151-158`);
- no project picker, milestone or multiple assignees, only "assign to me"
  (`A components/QuickAddTaskSheet.tsx:49,92`);
- no `/ai/parse-task`;
- the due date is typed as text (`:46`).

**Task details:**
- no full Edit form;
- no carry-forward history;
- no preview: `GET /attachments/:id/preview` exists (`B modules/tasks/attachment-routes.ts:47`), but
  the app opens the raw file in the browser (`A screens/TaskDetailScreen.tsx:192-198`);
- no live updates outside the board;
- the start date can't be edited (`A components/task-detail/DetailsCard.tsx:18`).

**My Tasks:**
- search and priority only (`A screens/MyTasksScreen.tsx:24-34`);
- no project, status, assignee or due filters, chips, sort, bulk actions or create. The web has them
  (`W components/BulkActionBar.tsx`, `SavedViewsBar.tsx`).

### 1.5 Stage 5: Projects, dashboard, calendar, reports, activity, notifications (all open)

**Dashboard:**
- own counts only;
- it greets you by username (`A screens/DashboardScreen.tsx:23`);
- **a Done-column task without `completedAt` counts as overdue** (`A lib/tasks-summary.ts:29-37`),
  although `columnCategory` is typed now (`A lib/types.ts:64`).

**Projects list:**
- raw status (`A screens/ProjectsScreen.tsx:34,40`);
- no colour, icon, picture, progress or owner. `ApiProject` lacks the fields (`A lib/types.ts:150-162`).

**Project screen:**
- raw status (`ProjectDetailScreen.tsx:92`);
- dates by `slice(0,10)` (`:98-100`; a day off is possible, unverified);
- read-only members and meetings;
- no Tasks tab;
- no `/ai/summary`;
- no create or edit (admin only, `B modules/projects/project-routes.ts:91-145`).

**Calendar:**
- uses `useMyTasks`, not `/calendar` (`A screens/CalendarScreen.tsx:23`;
  `B modules/tasks/task-routes.ts:196-228`), so no projected repeats and no one else's tasks;
- a list only;
- a fixed −7/+60-day meeting window (`A lib/meetings.ts:45-47`).

**Reports:**
- 7, 30 or 90 days only (`A lib/reports.ts:25`);
- no line chart or weekly series; only `velocityPerWeek` is shown (`A screens/ReportsScreen.tsx:207`).

**Activity feed:** missing (`B modules/activity/activity-routes.ts:24`).

**Notifications:**
- no tab badge: `useUnreadCount` is unused (`A core/queries.ts:374`, `navigation/RootNavigator.tsx:205-210`);
- stale (§4);
- a project link opens the board, not the project screen (`A lib/deep-link.ts:27,43`);
- the old `unreadCount` type mismatch is fixed (`A lib/resources.ts:196`).

### 1.6 Stage 6: Account, admin, search, version (all open)

**Profile:**
- shows the username, raw roles and the internal id (`A screens/ProfileScreen.tsx:22,30-33,41`);
- no full name, avatar, password change or data export (`B modules/users/user-routes.ts:61-111`).

**Settings:**
- no week start or own time zone. The web has them in `W components/DatePreferences.tsx`, using
  `PUT /users/me/preferences`;
- no daily-email settings (coming).

**Admin:**
- Users management comes to the app (the user's decision; `B modules/users/user-routes.ts:56-160`).
- Settings, AI and Audit stay web-only, with an "Open on the website" link.

**Also missing:**
- global search (`B modules/search/search-routes.ts:17`);
- About and version history (`B modules/about/about-routes.ts:37`);
- web URLs as deep links. The intent filter covers `/reset` only (`Android App/app.json`).

---

## 2. New web features since 20 Oct, and the coming ones

| Web feature (release) | Web code | The app today | Stage (§7) |
|---|---|---|---|
| MICO360 AI provider, 2–3 min waits, plain error messages (1.3.0) | `B modules/ai/*` | **Breaks.** The 20 s timeout turns a slow answer into "You're offline". The plain messages (e.g. AI_BUSY, `B modules/ai/ai-limits.ts:12`) do show through `failureText` | 1b |
| Paste a picture into a task, named "Pasted image <date time>" (1.3.1) | `W lib/clipboard-files.ts:15-25` | Document picker only (`A screens/TaskDetailScreen.tsx:167-181`). No camera, photo library or clipboard | 4a: "Take photo / Choose photo / Paste picture", same naming |
| "+" on every column; an empty column opens New task (1.3.2) | `W components/KanbanColumn.tsx:30,111` | One FAB; the sheet starts on the first column (`A components/QuickAddTaskSheet.tsx:44`) | 4a: "+" per column header, an `initialColumnId` prop |
| Files in New task, uploaded after create; refused offline (1.3.4) | `W components/task-form/FilesField.tsx`, `TaskFormDialog.tsx:348-350,602` | No files in Quick add | 4a |
| Pictures shrunk on the server (1.3.4) | `B lib/image-shrink.ts` | Applies to phone uploads already. The 10 MB cap comes first, and HEIC is refused | 4a: resize on the phone (max 1920 px, JPEG) before upload |
| Update notice from the hosted APK's version (1.3.3) | `B lib/apk-version.ts` | Done, but "Download" is broken (finding 2) | S0 and 1b |
| **Coming:** "All projects" combined Kanban | not built | Per-project boards only (`A navigation/types.ts:22`) | 4c. `GET /tasks?boardDate=` without `projectId` already returns all visible projects (`B modules/tasks/task-routes.ts:155-191`); it needs FlatList columns |
| **Coming:** daily task emails, with per-user on/off and time | not built | No setting; PUT-replace risk (finding 4) | S1 (storage), then 6a |
| **Coming / uncommitted:** Minutes PDF fixes; action items follow their task | `B` WIP | — | No app change; Stage 2 relies on them |

---

## 3. API calls checked against the server

**Every endpoint the app calls exists**, with the same method, path, body and `{data}` wrapper. That
covers about 60 calls in `A lib/resources.ts:77-248`, `lib/auth.ts`, `core/services.ts`,
`lib/exporter.ts` and `lib/reports.ts`.

**Versions:**
- `version` comes back from `GET /tasks`, `/tasks/mine` and `/tasks/:id`, from PUT and from
  `PATCH /tasks/:id/move` (`B modules/tasks/prisma-task-repository.ts:95`).
- PUT accepts `expectedVersion`; a stale one gets 409 `VERSION_CONFLICT`
  (`B modules/tasks/task-routes.ts:98,313`, `task-service.ts:178-179`).
- A move bumps the version without checking it, and the app records the new one (`A core/queries.ts:396-399`).
- Assignees, tags, checklist and comments don't bump it.

**Uploads:** the multipart field `file` matches (`A lib/resources.ts:159-164`,
`B modules/tasks/attachment-routes.ts:31-44`). The reply's `sizeBytes` is the stored (shrunk) size,
with `filename` and `mimeType` unchanged.

**Problems, worst first** (S = server fix, A = app fix):

1. **The update notice's "Download" is a silent no-op** when the site hosts the APK.
   - `androidAppUrl` is the relative `/downloads/MICO360-Tasks.apk` (`B lib/web-app.ts:26,36-40`,
     `server.ts:1180`).
   - The app passes it to `Linking.openURL` and swallows the failure (`A components/UpdateBanner.tsx:41,50`).
   - The web resolves the path itself (`W lib/android-app-link.ts`).
   - Unverified: whether `ANDROID_APP_URL` is set to a full address on the live site.
   - **S:** return an absolute address. **A:** resolve a leading "/" with `sitePageUrl`.
2. **Refused uploads say "Check your connection".** The app's patterns match the server's old wording
   (`A lib/attachments.ts:80-85`). Today's messages for a disallowed type, a renamed or damaged file,
   the quota and an empty file don't match (`B lib/upload-safety.ts:62-76`,
   `modules/tasks/attachment-service.ts:41-63`).
   - The app also labels `.doc`, `.xls` and `.ppt`, which the server refuses (`B config/env.ts:66-69`).
   - **A:** show `ApiError.message`, which is already plain.
3. **AI timeouts and size.**
   - The app allows 20 s against the server's 120 s.
   - `/ai/*` caps `description` at 4000 characters (`B modules/ai/ai-feature-routes.ts:7`), so a
     longer one gets a 400.
   - **A:** a per-request `timeoutMs` (`RequestOptions` has none, `A lib/api-client.ts:70-75`):
     130 s for AI and 190 s for the MOM. Trim the description too.
4. **A queued edit is marked failed although it was saved.**
   - The server honours Idempotency-Key on POST only (`B lib/idempotency.ts:115-151`).
   - When a PUT times out after saving, its replay gets 409 `VERSION_CONFLICT`, which the queue treats
     as permanent (`A lib/sync-queue.ts:79`, `core/queries.ts:459`). Later edits in that spell fail the
     same way.
   - A replayed create that meets `TASK_KEY_CONFLICT` is treated the same.
   - **A:** on a replayed 409, reload the task and count it as done if it already holds the values.
5. **The version check isn't atomic.**
   - It reads, compares, then writes without a condition (`B modules/tasks/task-service.ts:176-179,213`,
     `prisma-task-repository.ts:186-194`).
   - Two simultaneous edits with the same version both pass.
   - **S:** `updateMany({ where: { id, version } })`.
6. **Refresh replies.**
   - A 403 `ACCOUNT_INACTIVE` counts as transient (`A lib/api-client.ts:278-282`). The user stays
     signed in and "offline". It is rare, because deactivation revokes tokens first.
   - A 200 that isn't a session is stored anyway (`A core/services.ts:113-131`). The web added
     `isSession` (`W api/client.ts`, uncommitted).
   - Fingerprint sign-in calls any 403 "The server is busy" (`A screens/auth/LoginScreen.tsx:107-109`).
   - **A:** 403 → invalid; check the reply's shape.
7. **Realtime.**
   - Ignored events: see §1.1.
   - The app uses websocket only (`A core/authed-socket.ts:22`). The web uses socket.io's default,
     which falls back to polling. If a proxy blocks websockets, only the app loses live updates
     (unverified for Hostinger).
   - The app never POSTs `/conversations/:id/delivered` (`B modules/chat/chat-routes.ts:106`).
   - `presence:*` goes to every socket (`B realtime/realtime.ts:90,129`).
   - Task details opened outside a board has no socket, so `VERSION_CONFLICT` comes more often.
8. **Minor.**
   - `X-App-Version` and `X-App-Build` are read nowhere in `B`; the raw refresh and logout fetches omit
     them (`A core/services.ts:99-104,124-128`).
   - `read-all` returns `{ok:true}`, not `{updated}`; it is unused.
   - The server has 4 notification types beyond the 6 switches (CHAT_MESSAGE, CHAT_MENTION,
     TASK_DIGEST, TASK_ESCALATION). The web shows the same 6 (`W pages/SettingsPage.tsx:14-20`).

**Routes the app never calls** (each has its stage in §7): `/calendar`, `/search`, `/activity`,
`/me/action-items`; all meeting write and detail routes; `/ai/parse-task`, `/ai/summary`; column
management and reorder; project create and edit, members; user admin and self-service; chat prefs,
delivered, members, search and attachments; `/attachments/:id/preview`, `/releases`.

---

## 4. Performance and responsiveness risks

**Refetch storms:**
- **Inline edits.**
  - Task details mounts 15 queries (`A screens/TaskDetailScreen.tsx:67-92`).
  - After any edit, `useUpdateTask` invalidates the `['task', id]` prefix (11 queries), every
    `['tasks']` list and every `['project']` query (`A core/queries.ts:454-458`).
  - **Fix:** `setQueryData` from the PUT reply; invalidate `['task', id]` exactly, plus activity and
    the lists that show the task.
- **Realtime fan-out.**
  - Each task event invalidates every board date, My Tasks, progress and the task's whole prefix, and
    runs a LayoutAnimation (`A lib/realtime.ts:42-50`, `core/useBoardRealtime.ts:46-51`).
  - A carry-forward or bulk move means dozens of refetches, each cancelling the last. Screens lower in
    the stack stay mounted and refetch too.
  - **Fix:** batch invalidations (about 300 ms) and animate once.
- **After an offline flush, everything is invalidated** (`A core/services.ts:166-168`).

**Missing refetches:** TanStack's `focusManager` and `onlineManager` aren't wired to `AppState` or the
network. Coming back to the app refreshes nothing, so notifications, My Tasks and the update check go
stale. Only a board socket's reconnect refreshes (`A core/useBoardRealtime.ts:41-44`).

**Unbounded loads:**
- `GET /tasks?projectId` without `boardDate` returns all of a project's tasks, all days
  (`B modules/tasks/task-routes.ts:155-191`). It feeds:
  - the blocker picker (`A screens/TaskDetailScreen.tsx:71,286`): use a search or `limit` instead;
  - project milestones and deadlines (`ProjectDetailScreen.tsx:32`): use a dedicated query instead.
- `/tasks/mine` includes every completed task ever (`task-routes.ts:230-233`). It feeds Dashboard, My
  Tasks and Calendar.

**Offline cache:**
- Each successful read is stringified and awaited into AsyncStorage before the screen gets its data
  (`A lib/read-cache.ts`).
- Board keys are per date (`A core/queries.ts:64`) and pile up until sign-out.
- Android's default AsyncStorage size is small (unverified for this build).
- **Fix:** don't await the write, cap the date keys, and leave old completed tasks out.

**No virtualization:**
- Every list is a ScrollView with `.map`: the nested board columns (`A screens/BoardScreen.tsx:122-148`),
  My Tasks, Notifications, Calendar, Chat and Projects.
- Chat paging, the all-projects board and a long calendar need `FlatList` (inverted for chat) or
  FlashList, with memoized rows.

**Smaller costs:**
- `nameOf` runs a linear `find` per comment or message (`TaskDetailScreen.tsx:112-115`,
  `ChatThreadScreen.tsx:48-52`).
- With a board open there are two sockets (`useBoardRealtime.ts:41`, `useChatRealtime.ts:23`). One
  shared socket with rooms would do.

---

## 5. Permissions and roles: web vs app

**The server's model:**
- System roles are only ADMIN and EMPLOYEE (`Web Portal/backend/prisma/schema.prisma:139`).
- Project member roles are MEMBER and MANAGER (`:203-206`).
- "Manage project" means admin or MANAGER member (`B modules/projects/project-authz.ts:13-32`).
  Meetings use a wider rule that adds the project's `managerId` and `ownerId` (`B server.ts:451-458`).
  Settle one rule before the app copies either.

| Capability | Server | Web UI | App UI | Gap |
|---|---|---|---|---|
| Reports and exports | ADMIN (`B modules/reports/report-routes.ts:121-208`) | admin route and nav (`W App.tsx:102-108`, `components/Sidebar.tsx:111`) | admin drawer (`A navigation/drawer-menu.ts:20,26`); a 403 shows a note (`screens/ReportsScreen.tsx:73,82`) | none |
| Activity feed | all, scoped | all | task timeline only | 5c |
| Users, settings, AI, audit | ADMIN | admin routes | none | Users in 6b; the rest link to the web |
| Create or edit a project | ADMIN | admin (`W pages/ProjectsPage.tsx:76,95`) | none | 5b |
| Members | admin or MANAGER | same (`W pages/ProjectDetailPage.tsx:368`) | read-only | 5b |
| Board columns | admin or MANAGER | **admin only** (`W pages/BoardPage.tsx:295`) | none | settle in S1 |
| Edit or move any task | any project viewer | all | all | by design |
| Delete a task | admin or MANAGER | same | same (`A lib/task-detail.ts:26-29`) | none |
| Carry forward | ADMIN, plus the nightly sweep | auto on an admin's board | none | fine |
| Meetings: edit, invite, approve the MOM | meeting editor (`B modules/meetings/meeting-access.ts:42-50`) | the server's `canEdit` | read-only | 2b: use `canEdit`, not roles |
| Delete others' messages | ADMIN | own or admin | none | 3b |
| Others' tasks in the calendar | visible projects | yes | own only (`A screens/CalendarScreen.tsx:23`) | 5a |
| Search | scoped | yes | none | 6b |

**Role changes:**
- The server revokes the sign-in (`B modules/users/user-service.ts:115-131`). The app's next 401 and
  failed refresh sign it out (`A lib/api-client.ts:238-244`).
- Roles are refreshed with every token (`A core/services.ts:131`).
- There is no `/auth/me`. The server caches roles for 10 s (`B modules/auth/auth-guard.ts:37-42`).

**Labels:** Profile shows "ADMIN" and "EMPLOYEE" (`A screens/ProfileScreen.tsx:30-33`). The web says
Administrator and Employee (`W pages/ProfilePage.tsx:184`).

**Rule for every stage:** gate on the server's own flag where one exists (meetings `canEdit`),
otherwise on one shared helper per rule. Hide what the server would refuse.

---

## 6. Test harnesses, and what each stage adds

**What exists:**
- **App unit tests:** vitest in node, `src/**/*.test.ts` only (`Android App/vitest.config.ts`).
  - About 65 files and 550 cases, counted with grep, not run.
  - Run `npm test`, `npm run typecheck` and `npx eslint src --max-warnings=0`.
  - Copies of web code are guarded by drift tests (`W lib/mentions-copies.test.ts`,
    `B modules/tasks/recurrence-copies.test.ts`, `A lib/app-config.test.ts`).
- **Maestro:** `Android App/.maestro/smoke.yaml` and `login.yaml`, for the sign-in screen only.
- **Phone scripts** in `D:/mico-release/`. They use uiautomator on emulator-5620 against the local
  server on :4000 through `adb reverse`; the helpers are in `adbui.sh`.

| Script | Checks |
|---|---|
| `apk-stage1.sh` | public http refused; private http signs in; the version row; the edit conflict |
| `apk-stage1-fingerprint.sh` | fingerprint sign-in, FLAG_SECURE, revocation (throwaway user) |
| `apk-stage1-banner.sh`, `apk-update-rule.sh` | the banner, "Not now", the hosted-APK rule. They never tap Download, which is how finding 2 slipped through |
| `apk-stage1-zone.sh` | a zone change reaches an open screen |
| `apk-task-detail.sh` (+ `audit-tools/apk-task.mjs`), `apk-task-delete.sh` | task details actions against server data |
| `apk-meeting-link.sh`, `apk-otp.sh`, `apk7.sh` | "From meeting"; email-code sign-in; the old walkthrough |
| `build-apk-test.sh` | the debug-signed test APK (`D:/mico-release/apk-test`) |
| `audit-tools/apk-download-e2e.mjs` | the website's "Download for Android" |

- **Gotchas** (memory `mobile-parity.md`):
  - FLAG_SECURE gives an empty screencap: use uiautomator text.
  - Wait about 1 s after a swipe.
  - Stop the test server before `prisma generate`.

**Add per stage:**
- **Every stage:**
  - unit tests per new `A/lib` module;
  - a drift test for each helper copied from `W`;
  - an `apk-<stage>.sh` that checks each action against server data;
  - a request count for the stage's main flow, from the server log;
  - Maestro smoke on the release APK.
- **S0 / 1b:**
  - tap Download and assert the browser opens the absolute APK address;
  - AI with a stand-in that answers after 60 s (`apk-task.mjs ai` plus a delay);
  - each refused upload shows the server's message;
  - an edit replayed after a lost reply isn't marked failed.
- **2:** `apk-meetings.sh`: list, RSVP, a repeating schedule with "this / all upcoming", notes,
  note → task, action items, MOM draft → approve, PDF, `canEdit` as an attendee vs the organizer.
  The web's meetings-e2e is the reference.
- **3:** `apk-chat.sh`: start a DM, page past 50, auto-scroll, read while open, reply, edit, delete,
  react, attachments, a failed outbox retry, a push tap opening the thread.
- **4:** `apk-board.sh`: "+" per column, reorder, a 12 MB photo resized on the phone, camera upload,
  New task with files offline (refused with a message).
- **5:** the calendar (week start, repeats, others' tasks), a Done task without `completedAt`, the
  badge, refetch on resume.
- **6:** profile password, avatar and export; Users with an EMPLOYEE refused; search; About.

---

## 7. Updated stage list

Small, releasable stages, in order.
- "APK: yes" means a signed build: the keystore password, then an upload to `/downloads/MICO360-Tasks.apk`.
- "No" means a web-only release (`release.mjs --web-only`), which leaves the app's version alone.

| # | Stage | Contents | APK |
|---|---|---|---|
| S0 | Server quick fixes | Absolute `androidAppUrl` (repairs Download on 1.2.1–1.3.3); atomic task version check | No |
| 0 | Ship what's built | Sign 1.3.3, verify with `apksigner`, upload, check `/config` and tap Download | **Yes** (built) |
| 1b | App hotfix | AI timeouts (130 s, 190 s) with an "AI is taking longer" message, and the 4000-character trim; upload messages from the server; 403 refresh = invalid, plus the `isSession` check; resolve a relative download link; a replayed 409 that already applied counts as done; preferences keep unknown fields; a DONE category counts as finished; clear `ruleDraft`; handle `task:assignees`, `task:tagged`, `task:watchers`, `checklist:changed` and `comment:*`; maxLength on sign-in | **Yes** |
| 1c | Performance base (ship with 1b if ready) | `focusManager` and `onlineManager`; precise invalidations; batched realtime; non-blocking, capped cache; blocker picker by search | **Yes** |
| S1 | Server prep | Daily-email settings apart from `muted` (or a merging PUT); one "manages project" rule; meeting AI endpoints and `/meetings/availability` (approved design) | No |
| 2a | Meetings: take part | Meetings tab (list, Up next, search, filters), read-only details, RSVP, Join, My Action Items, `meeting` deep link; "From meeting" opens in the app; the "No notes" fix | **Yes** |
| 2b | Meetings: run them | Schedule/Edit with repeat and scope; attendees and invitations; agenda; Live notes (WebView editor); note → task; action items; MOM draft, approve and reopen; PDF and email; cancel, duplicate, delete; all gated on `canEdit` | **Yes** |
| 2c | Meeting AI in the app | The four helpers in the app form, after S1 and the web | **Yes** |
| 3a | Chat: reliability | Auto-scroll; read while open and from Project; `clientId`; offline copy; a visible outbox with retry; member-only mentions; inverted FlatList with paging; badge; push opens the thread | **Yes** |
| 3b | Chat: features | DM picker, replies, edit, delete and copy, reactions, attachments, receipts and presence, prefs, search, members, drafts | **Yes** |
| 4a | Tasks: create | Full New task form (project picker, milestone, several assignees, date picker, Describe in plain English, files with phone-side resizing, camera and clipboard); "+" per column | **Yes** |
| 4b | Board | FlatList columns, reorder and drop position, date picker, assignees, counts and column colour on cards, column management (the S1 rule) | **Yes** |
| 4c | Board: all projects | After the web ships it | **Yes** |
| 4d | My Tasks and details | Filters and chips, sort, bulk actions, the full Edit form (with start date), preview, carry-forward history, a live socket on details | **Yes** |
| 5a | Calendar | `/calendar` (projected repeats, others' tasks), month, week and agenda views, week start, create on a day, drag to reschedule | **Yes** |
| 5b | Projects and dashboard | Avatar, icon, colour, progress and status labels; the project dashboard (stats, "who has what", Tasks tab, AI summary); members; admin create and edit; admin dashboard totals | **Yes** |
| 5c | Notifications, activity, reports | Badge, refetch on push and resume, project link → project screen; Activity feed; Reports with a custom range and charts | **Yes** |
| 6a | Account | Profile (full name, avatar, password, export, role labels); Settings (week start, time zone, daily emails) | **Yes** |
| 6b | Admin, search, about | Users management; "Open on the website" for the rest; global search; About and version history; web URL deep links (`assetlinks.json` paths) | **Yes** |

**Notes:**
- The old Stage 2 ("Meetings + meeting AI") is now 2a–2c, because meeting AI has no server routes yet
  and the meeting form is the bigger half.
- Every row is one release: CHANGELOG `[Unreleased]` → `release.mjs`, with its phone script passing
  first.
