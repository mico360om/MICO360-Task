# Android app vs web portal: gap analysis

Date: 2026-10-20. Versions compared: web portal and server 1.2.0, Android app 1.2.0 (build 9).

This is a read-only review of the code by four reviewers, one per area. In the paths below,
`A` = `Android App/src`, `W` = `Web Portal/frontend/src` and `B` = `Web Portal/backend/src`.

**API compatibility:** every endpoint, query parameter and request body the app uses still exists
and matches the server. Nothing is broken today. The gaps are features the app never calls, and fields
it ignores.

## 1. Security and reliability (fix first)

1. **Push after sign-out:** when a session expires, the push token isn't unregistered (`A lib/sign-out.ts:83-87`). The server never drops device tokens on a password change, an admin reset or a revoked token family (`B push-sender.ts`). The previous user's notifications keep arriving.
2. **Plain http everywhere:** `usesCleartextTraffic=true` applies to the whole app in every build (`with-lan-cleartext.js`). The "private addresses only" rule exists only in the server-address check.
3. **Biometric sign-in can't work:**
   - The refresh token is stored once (`SettingsScreen.tsx:66`), and the next silent refresh spends it.
   - Every sign-out path disarms it.
   - If the button ever appeared, it would send a spent token, which the server treats as theft.
4. **A lost refresh reply forces a sign-out:**
   - The server rotates the token but the reply times out, so the app keeps the spent token.
   - The next refresh looks like token reuse, and the server revokes the sign-in.
5. **Hard-coded Asia/Muscat time zone** (`A lib/due-date.ts:13`):
   - The server's `/config` time zone is ignored, and so are the user's own week start and time zone (`/users/me/preferences`).
   - Due and overdue status and board days can differ from the web.
6. **No version awareness:** no `/version` or `/releases` calls, no "new version available" notice, no version header, and crash reports carry no release.
7. **Content shows while locked:** there is no FLAG_SECURE, so screenshots and the recent-apps preview show content. Content can flash before the lock on a cold start. The lock setting carries over to the next user.
8. **Leftover files and failed offline mode:**
   - Report exports stay in the cache for 24 hours after sign-out.
   - A captive-portal page (a 200 response that isn't JSON) breaks offline mode: reads don't fall back to the cache, and queued writes fail.
9. **No edit-conflict check:** task updates never send `expectedVersion`.
10. **Unscoped task fetch:** `useProjectTasks('')` fires before the task loads. It calls `GET /tasks` for everything the user can see and caches it (`TaskDetailScreen.tsx:70`, `queries.ts:56-64`).

## 2. Meetings: missing on Android (shown read-only only in Calendar and Project)

The app needs:
- a meetings list (cards, Up next, search, filters, sort);
- meeting details:
  - header and status;
  - RSVP;
  - attendees with roles and attendance, and guests;
  - send invitations;
  - agenda (owners, minutes, done, reorder);
  - Live notes (rich text, note types, key points);
  - make a task from a note;
  - action items and decisions;
  - Final MOM (draft with AI or from notes, save, approve, reopen);
  - minutes PDF and email;
  - repeating meetings with the edit scope;
  - cancel, duplicate and delete;
- the Schedule and Edit meeting form;
- the My Action Items page;
- meeting deep links and realtime events.

Two smaller fixes:
- "No notes for this meeting" shows whenever the meeting has no description, which is misleading.
- The "From meeting" link opens the website and should open the app's meeting screen.

## 3. Chat: basic client today

**Missing:**
- start a new direct message;
- older history paging (only the newest 50 messages);
- day separators and the unread divider;
- replies;
- edit, delete and copy (display only today);
- reactions (display only);
- sending attachments, and opening them;
- delivered and read receipts;
- presence;
- a visible outbox (sending, failed, retry);
- favorite, archive and mute;
- message and conversation search;
- the members panel;
- drafts kept per conversation;
- an unread badge on the tab;
- push opening the conversation itself.

**Bugs:**
- Auto-scroll stops once 50 messages are loaded.
- Read is marked only when a conversation opens, so messages that arrive while reading stay unread, and opening a channel from Project never marks it read.
- `clientId` and `replyToId` are never sent.
- The app's types are behind the server (`replyTo`, `prefs`, `lastDeliveredAt`).
- Messages aren't saved for offline use.
- A failed queued message disappears.
- Mentions suggest everyone, not just the conversation's members.
- Realtime refetches everything on every event.

## 4. Tasks

**Board:**
- no reordering within a column;
- no drop position;
- no project switcher;
- no column management (add, rename, colour, category, hide, delete, reorder);
- no date picker or admin carry-forward on per-date boards;
- cards show no assignee avatars or counts, and ignore the column's colour.

**Create task:**
- only from the board's + button;
- no project picker, no milestone, no multiple assignees, no "Describe it in plain English";
- the due date is typed as text.

**Task details:**
- no full Edit form with the conflict check;
- the due date can show a day off (`slice(0,10)` instead of `dueDayKey`);
- a task in a hidden column shows no status;
- no carry-forward history;
- no in-app or Office preview of attachments;
- no live updates outside the board;
- a stale repeat editor after saving.

**My Tasks:**
- filters cover only priority and search (the web has project, status, assignee and due date, plus count chips);
- no bulk actions, sorting, grid/list switch or create.

**Other bugs:**
- An offline move snaps back.
- The "queued offline" banner comes back the next time the form opens.
- The realtime events `task:assignees`, `task:tagged`, `task:watchers` and `checklist:changed` are ignored.

## 5. Projects, dashboard, calendar, reports, activity, notifications

**Dashboard:**
- only the user's own counts;
- no admin totals or charts;
- no "due soon" across projects, no recent activity;
- a task in a Done column without `completedAt` can show as overdue.

**Projects list:**
- no colour, picture, icon, number, client, progress, counts or owner;
- raw status codes ("ON_HOLD") on screen.

**Projects, editing:**
- no create or edit form;
- no status change, archive or complete;
- no owner change.

**Project dashboard:**
- no avatar or owner;
- partial stats;
- no tasks by status, by priority, or "who has what";
- no Tasks tab;
- meetings are read-only;
- members are read-only (no add, remove or role change);
- no AI status summary;
- not live.

**Calendar:**
- uses `/tasks/mine` instead of `/calendar` (no projected repeat copies, no other people's tasks);
- an agenda list only (no Month or Week view);
- no filters, drag to reschedule, or create on a day;
- a fixed window for meetings;
- no lower date limit for tasks.

**Reports:**
- no charts;
- only 7, 30 or 90 days (no custom range);
- `velocity[]` is ignored.
- Exports already match.

**Activity feed:** missing, and there's no menu entry for it.

**Notifications:**
- no unread badge;
- the list goes stale (no refetch on focus or push);
- deep links: a conversation opens only the Chat tab, meetings aren't handled, and a project opens its board instead of its dashboard;
- `unreadCount` is typed as a number but returns an object.

## 6. Account, admin, search, version

**Profile:**
- missing: full name, avatar, password change, "download my data";
- roles show as raw codes.

**Settings:** no week start or time zone.

**Admin** (Users, System settings, AI management, Audit log): missing. Reports are present but only hidden in the menu.

**Global search:** missing (`/search` and `/chat/search`).

**About / version history:** missing.

**Deep links:** web URLs aren't mapped, and the reset link covers `task.mico360.com` only.

**Minor:**
- The OTP field strips Arabic-Indic digits.
- No maxLength on the sign-in fields.
- A reset link tapped while signed in waits until sign-out.

## Already at parity (keep)

- **Sign-in:** password, email code, forgot and reset, change server, token refresh and sign-out logic.
- **Push and storage:** push registration, the offline queue with an idempotency key, SecureStore for tokens.
- **Settings:** theme and notification preferences.
- **Task details:** inline edits, status, priority with AI, assignees and watchers, checklist with AI breakdown and reorder, comments with mentions, edit and delete, dependencies, activity timeline, recurring series scope, export, delete, the "From meeting" line.
- **Elsewhere:** report exports; the notifications list and mark-all-read; milestones on the project screen.
