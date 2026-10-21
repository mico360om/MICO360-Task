# Changelog

Every release of MICO360 Tasks: the web portal and its server, the Android app and the Chrome
extension, which share one version number.

Versions follow [Semantic Versioning](https://semver.org) (Major.Minor.Patch):
- a **major** release (2.0.0) changes something people or other systems rely on (marked BREAKING);
- a **minor** release (1.1.0) adds new features;
- a **patch** release (1.0.1) improves, secures or fixes what is there.

List each change under **[Unreleased]** as it is made, in one of four sections: New features,
Improvements, Security, Bug fixes. `node tools/release/release.mjs` then turns them into the next
version (see [docs/RELEASES.md](docs/RELEASES.md)). Security entries are shown to administrators only.

## [Unreleased]

### New features
- Every page's footer has "Get the apps": download the Android app or the Chrome extension straight
  from the site. The extension comes with each website release, so it always matches the site (hover
  over the link for how to install it); a download the site doesn't have isn't shown.
- The Chrome extension adds a task from any page: the toolbar button opens a quick form (also
  Ctrl+Shift+K, and "Add to MICO360 Tasks" when you right-click selected text or a page). "Add this
  page" fills in the page's title and link, "Describe it" fills the form from a sentence, and pictures
  and files are attached once the task is made. Without a connection the task is kept and sent later
  (files need a connection); a form you didn't send comes back, with your recent tasks below it.
- The Chrome extension's task panel matches the website's: files with a preview (attach, drop or
  paste, and delete), tags, assignees, watching, threaded comments with replies, editing, deleting and
  @mentions, the task's history, milestone and start date, the meeting it came from, changes to a
  whole repeating series, and deleting one copy or the whole series. Changes made offline are sent in
  the order you made them.
- The task PDF shows the whole task under its project's picture (or icon, or initials), as the
  minutes PDF does: a clear title that never gets cut, status cards without repeats, the milestone
  and the meeting the task came from, comment threads with bold @mentions, up to 12 pictures as
  thumbnails (other files listed with their size, who added them and when), Blocked by / Blocks
  tables, and the latest 50 changes, newest first.

### Improvements
- A meeting's page shows the Final MOM as soon as someone else saves, approves or reopens it.
- The task PDF and Excel file say what changed in the website's words, for example "Changed priority
  from Normal to High" or "Ticked off “Order the parts”", instead of just "Updated".
- In every PDF, a long link breaks at a slash or similar instead of in the middle of a word, and a
  long project name gets smaller or wraps instead of being cut.

### Security
- The task PDF and Excel file name the meeting a task came from only to people who are part of that
  meeting, and list only the blocking and waiting tasks the reader can open, as the website does.
- A task's activity (on the website, in the apps and in the task PDF and Excel file) names a blocker
  only to people who can open that task; anyone else sees "added a blocker".
- A damaged or specially made picture attached to a task can no longer slow down or stop the server
  when someone downloads the task's PDF; it is listed as "(picture could not be shown)" instead.

### Bug fixes
- Long checklist items, links and Arabic text in the task PDF are never cut, and Arabic reads right to
  left; section headings stay with what comes under them instead of sitting alone at a page's bottom.
- A project picture the PDF can't use (a see-through, interlaced or damaged picture) no longer breaks
  the task PDF or the meeting minutes PDF; the project's icon or initials are shown instead.
- A task's activity says "added a blocker" instead of "added the blocker a task".
- Deleting a task that someone else already deleted now says it wasn't found, for everyone, instead
  of "You do not have permission"; "no permission" now only means you really can't delete it.
- The Chrome extension: changing a task's tags while offline no longer removes tags someone else added
  or removed in the meantime, and Retry in Settings can no longer let an older failed change undo a
  newer one (Settings says why and offers Discard instead).
- The Chrome extension: a file dropped anywhere on an open task is attached to it, and a file dropped
  anywhere else no longer opens in the tab and loses what you were typing.
- The Chrome extension: a click right after editing a task's title lands where you clicked.

## [1.6.0] - 2026-10-21

### New features
- Describe the meeting in a sentence: the new-meeting and edit forms suggest the title, day and time,
  length, repeat, project, place and link (and, in a new meeting, the people, guests and agenda
  points). Nothing changes until you choose; a suggestion that would replace what you typed starts
  unticked, and a name several people share asks which one, showing their usernames.
- The new-meeting form has People and Agenda: invite team members and guests by email, and add agenda
  points with a lead and minutes, totalled against the meeting's length. They are saved with the
  meeting in one go (all or nothing); invitations still go out only when you send them.
- Free times: "Suggest 3 times" finds the nearest times when everyone invited is free, inside the
  company's meeting hours; the form warns who already has a meeting at the chosen time and shows each
  person's day (a meeting you may not see shows only as "Busy"). Admins set the meeting hours in System
  Settings (Sunday–Thursday, 08:00–17:00 to start with).
- Draft agenda, in the new-meeting form and on a meeting's page: the AI proposes items from what you
  wrote, the project's open tasks and what the last meeting left open, each with a lead and minutes
  that fit the meeting; you tick which to add. Write description drafts the invitation's description
  for you to use or decline.

### Improvements
- In the Android app, Suggest steps and Suggest priority wait for MICO360 AI's slower answers (up to two
  minutes) and say "The AI is taking longer than usual" instead of "You're offline". A refused
  attachment shows the server's reason (type, size, damaged file, storage limit) instead of "Check
  your connection". Profile shows Administrator or Employee, not a code.
- The Chrome extension shows the server's own reason when something is refused. Clicking a
  notification opens its task, chat or meeting. Changes made offline stay in place on the board, in the
  task and in chat, marked "Saved on this device" until they are sent, and the toolbar badge follows
  the unread count at once. Task exports wait long enough for big files.
- The Chrome extension works fully from the keyboard: a board card opens with Enter or Space and has
  a "Move to…" menu, and the task panel is a proper dialog (focus stays inside it, Escape closes it,
  and focus goes back to the card). Settings → About shows the extension's and the website's
  versions, with how to update when a new extension file is handed out. It needs Chrome 116 or later.

### Security
- The Chrome extension keeps the short-lived sign-in token in memory only, never on disk.

### Bug fixes
- The Chrome extension no longer saves over someone else's change to a task: an edit made from an
  older copy is refused with a plain message and the latest version is shown, as on the website and
  in the app; offline edits are checked the same way when they are sent. Tasks in columns a project
  has switched off no longer show on its boards, a 200 reply that isn't from the server is never
  kept, and a sign-in renewal refused by a firewall no longer signs you out. A turned-off account is
  signed out at once instead of piling up changes; a quick run of edits while the server is down no
  longer uses up the first change's tries; and an edit whose check can't reach the server waits and
  tries again instead of being shown as someone else's change.
- In the Android app: the "new version" notice's Download opens the app file (only ever a web
  address), and says so if it can't;
  a task in a Done column without a completion time is never shown as overdue; the repeat editor no
  longer shows the old repeat after saving; the task panel follows changes others make to people,
  tags, watchers, checklists and comments; an offline edit already saved before its reply was lost
  no longer shows as failed; and a sign-in renewal is ended only by the server itself (a turned-off
  account), never by a firewall page or a reply that isn't a session.

## [1.5.2] - 2026-10-21

### Security
- Pictures attached to tasks, comments and projects are now shrunk by an updated image library (sharp
  0.35.5 with libvips 8.18.7). It closes known flaws in reading some picture formats (HEIF, SVG and
  others) that a crafted upload could trigger (GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c,
  GHSA-wq5f-xc86-pv6w).
- The formatted-notes editor is updated to Tiptap 3, closing a flaw in how it merged HTML attributes
  (GHSA-cp6q-959q-f8rh).
- Build tools are updated: Vite 7.3.7 (CVE-2026-112942, -112943, -112944) and postcss-selector-parser
  7.1.7 (GHSA-rj75-hqrm-r3gf). The website looks exactly the same.

### Bug fixes
- Typing quickly in a meeting note no longer loses letters.

## [1.5.1] - 2026-10-21

### Bug fixes
- Two edits to the same task made from the same copy at the same moment (say from the website and the
  phone) can no longer both be saved, the second silently replacing the first: the later one is
  refused with "This task was changed by someone else", as it already was when they came a moment
  apart. For a repeating task, the rest of the series is changed only once the edit itself is saved.

## [1.5.0] - 2026-10-21

### New features
- Daily task emails: every morning (06:00 Oman time unless you choose another time, in your own time
  zone) everyone gets two emails. "Pending tasks" lists the tasks assigned to you that aren't done,
  grouped as overdue (how many days), due today, upcoming and no due date, each with its priority,
  due day, status and a link to the task. "Completed yesterday" lists your tasks completed the day
  before, when, and whether on time. An email with nothing in it isn't sent. In Settings → Daily task
  emails each can be turned on or off, the time changed, and "Send me a test now" sends them at once.
  Each email goes out once a day; a failed send is tried again after 5, 15 and 45 minutes; if the
  server was asleep at the time they go when it wakes, the same day. Administrators see every send,
  retry and failure in System Settings → Daily task emails. They replace the old single digest email
  (the in-app digest stays). They need email (Mailjet) to be set up on the server.

### Bug fixes
- The Android app's "Download" on a new-version notice opens the app file again: the server named it
  by a site-relative address, which the phone couldn't open; the installed apps now open the file on
  the server they use (no new app needed).

## [1.4.0] - 2026-10-21

### New features
- The Kanban Board can show every project on one board: choose "All projects" in its project list.
  Tasks sit under six shared statuses (Backlog, To Do, In Progress, Blocked, Review, Done) for the day
  chosen, each card showing its project, sorted by due date and then priority. Dragging a card changes
  its status in its own project, into that project's first column of that kind; a project without
  such a column keeps the card where it was and says so. "Projects:" chooses which projects are shown
  (remembered for you), and "+" on a status starts a new task in that kind of column, in the project
  you choose. Finished and archived projects are left out, as are columns a project has switched off;
  each project's own board is unchanged.

## [1.3.5] - 2026-10-21

### Bug fixes
- The Minutes of Meeting PDF prints the project's logo whatever format its picture is in (WebP and
  every kind of PNG are converted for the PDF), instead of its initials. A project that uses an icon
  rather than a picture prints that icon on its colour, as the app shows it.
- A meeting is marked Completed once its end time has passed (a meeting without an end counts as an
  hour long), unless it was cancelled: in the app and in the minutes. Meetings already over were
  updated. A finished meeting moved to a time still to come is scheduled again.
- Meeting action items follow the task they are tracked as: Completed when the task is done, open
  again when it is reopened. Items whose task was already done were completed.
- The minutes call the project's status "Project status", so it isn't taken for the meeting's.

## [1.3.4] - 2026-10-20

### Improvements
- Files can be attached while creating a task: the New task form has an Attachments box to drop files
  on, choose them, or paste a picture (Ctrl+V). They are uploaded as soon as the task is created, each
  with its progress; if one can't be attached, the task is still saved and the form says which file
  and why. Files can't be attached offline: the form says so, and the task can be saved without them.
- Attached pictures are stored smaller to save space, in tasks and in chat, from the website and the
  Android app. JPEG, PNG and WebP pictures are turned upright, made at most 1920 pixels on their long
  side and saved again without their hidden details (camera and GPS location). A picture is kept as it
  was when that wouldn't make it smaller; animated pictures, PDFs and other files are kept exactly as
  they are, and pictures already attached are unchanged.

## [1.3.3] - 2026-10-20

### Improvements
- The Android app says a new version is out only when the app offered on the site is newer than it:
  the site reads the version inside the app file it offers. A release that changes only the website
  keeps the app's own version, so nobody is asked to download the same app again.

## [1.3.2] - 2026-10-20

### Improvements
- A task can be added straight into any column of the Kanban board: each column has a "+" beside its
  name (on a collapsed column too), and an empty column's box says "Add a task or drop a card here"
  and opens New task when clicked. New task starts in that column, on the board's project and day.

## [1.3.1] - 2026-10-20

### Improvements
- A picture can be pasted into a task (Ctrl+V, ⌘V on a Mac) anywhere in its details panel: a
  screenshot, or an image copied from a web page or a document, is attached like a chosen file, with
  its upload shown, and named "Pasted image" with the date and time instead of "image.png". Text
  pasted into a comment or a field stays text, even copied spreadsheet cells that also carry a picture.

## [1.3.0] - 2026-10-20

### New features
- AI Management connects MICO360 AI, the company's own AI platform, in one step: choose "MICO360 AI
  (our AI platform)", paste its key, and its models load. How to set it up: docs/AI-MICO360.md.

### Improvements
- The AI waits up to 2 minutes for an answer (3 for drafting the Final MOM), so a model that is still
  loading — the first request of the day on MICO360 AI — answers instead of timing out. An admin's
  model Test waits as long.
- On MICO360 AI, describing a task, the checklist, priority suggestions and the Final MOM ask the
  platform to hold the model to a JSON answer, so even a small model's answer can be read.
- An AI service that is busy for a second is asked again once; "busy", "no model available", "took
  too long" and "too long to read" each get a plain message instead of an HTTP number.
- When a provider's models can't be loaded, its own explanation is shown (MICO360 AI says which
  address to use when /v1 is missing), and document readers such as GLM-OCR are no longer offered
  as chat models.
- AI Management says when an address sends the API key and prompts unencrypted (plain http).

## [1.2.2] - 2026-10-20

### Bug fixes
- The website's "Download for Android" button can offer the app on the live site: the app file is
  kept in a folder that updates of the site don't replace (beside the uploaded files), so it stays
  available after every update instead of having to be put back each time.

## [1.2.1] - 2026-10-20

### Improvements
- The Android app shows its version (and the server's) in Settings, and says when a newer version is
  out, with a Download button (or "Not now" until the next one). Dates in the app follow the
  company's time zone, and its Calendar your own, as on the website; a change shows at once.
- Fingerprint sign-in on the Android app works: turn it on in Settings, and after signing out you can
  sign back in with your fingerprint. It stops after a password change, an admin reset or 30 days
  without using the app, and Settings offers to turn it back on. Another person signing in on the
  phone turns off the previous person's fingerprint sign-in and app lock.

### Security
- A phone stops receiving notifications as soon as it is signed out, even when its session simply
  expired or the phone is offline, and a password change (your own or by an admin), a reset by email,
  a role change, disabling or deleting an account forget all that person's phones.
- A fingerprint sign-in key can only be made by the phone's own sign-in, turning it off cancels it on
  the server too, and a stolen sign-in caught being reused cancels the person's fingerprint keys.
- The Android app sends to a plain http:// address only on the office network (a private address);
  anything else must use https. A build pointed at a public http address fails.
- While you are signed in with the app lock on, screenshots, screen recording and the recent-apps
  preview are blocked, and nothing shows before the lock on start-up. Exported files are deleted when
  someone signs out.

### Bug fixes
- A lost reply while the app renewed its sign-in no longer signs you out later (the renewal is retried
  and the server hands back the same new key for 2 minutes).
- A Wi-Fi sign-in page no longer breaks offline mode in the app.
- In the app: an edit made over someone else's is refused with a plain message instead of overwriting
  theirs; a task in a hidden column shows its status; the due date field shows the same day as
  everywhere else; a card moved offline stays where it was put; Arabic digits work in sign-in codes.

## [1.2.0] - 2026-10-20

### New features
- A task made from a meeting links back to it. Its details show "From meeting" with the meeting's
  title and day, and one click opens the meeting. Tasks already made from a meeting's notes get the
  link too, and a repeating task's next copies keep it. Someone who can see the task but isn't part of
  the meeting is told only that it came from a meeting. The Android app shows the same line, and
  tapping it opens the meeting on the website.

### Improvements
- New task starts in the project you are looking at: on a project's page, its board, a project's
  meeting, and My Tasks or the Calendar filtered to one project. That covers the New Task button at
  the top, the N key and a day on the calendar. You can still pick another project. Everywhere else it
  starts in the project you used last, as before.

### Security
- source-map-js updated to 1.2.2 (CVE-2026-93749, high): a crafted source map could stall the tools
  that build the web app and the Android app. It is used only while building, never by the running
  server or app.

## [1.1.0] - 2026-10-17

### New features
- Meeting Live notes can be formatted: bold, italic, underline, highlight, a heading, bulleted and
  numbered lists, and links. There is a toolbar above the box, the usual shortcuts work (Ctrl+B,
  Ctrl+I, Ctrl+U, Ctrl+K for a link) and typing "- " or "1. " starts a list. Text pasted from Word,
  Teams or an email keeps that formatting and leaves the rest. Every kind of note can be formatted,
  and editing a note uses the same box; older notes stay as they were written.
- The minutes PDF prints formatted notes as they look on screen, a link with its address beside it.
  Tasks made from a note, the Final MOM drafted from the notes, the AI's draft, search and the
  project dashboard's decisions use the note's words.

### Security
- Formatted notes are cleaned on the server: only that formatting is ever kept, so nothing unsafe can
  be saved, shown or printed, and links can only lead to web or email addresses.

## [1.0.2] - 2026-10-17

### Improvements
- Page headers take one line: the section and the page's title with its actions beside them. A
  project or a meeting shows a breadcrumb back ("Meetings › Weekly review"), the dashboard's
  welcome is one slim band, and there is less space above every page.
- The calendar fits on one screen: the title, period and views on one line, the filters on the
  next with the colour legend behind a "Legend" button. The month's weeks share the window's height
  and each day shows as many tasks as fit, with "+N more" for the rest; the week and the agenda
  scroll inside the calendar. On a phone the filters sit behind one "Filters" button.
- The Meetings page shows meetings as cards, one to four a row: the day, time, place, project,
  organizer, who is coming, the minutes, decisions and open action items. The next meeting is on top
  in an "Up next" card (with Join for an online one); search and a "Filters" button sit on the
  title's line, the filters in use show as chips you can remove one by one, and the meetings are
  grouped Today, Next 7 days, Later, Drafts and Past.
- The minutes of a meeting are one PDF. Once the Final MOM is approved the PDF opens with it, marked
  FINAL with who approved it and when, followed by the record of the meeting: attendance, agenda,
  action items and every note taken. Until then the PDF is marked Draft; the organizer's own copy
  shows a Final MOM still being written as "Not yet approved", and no one else sees or is emailed it.
- The minutes email is headed by the project's picture and name (its initials on its colour when it
  has no picture) instead of the portal's logo; a meeting without a project keeps the logo.
- A cleaner minutes PDF: a green Final or amber Draft badge, a band opening each part, a status line
  under the Final MOM's title, and who prepared and approved it closing the Final MOM.
- The meeting page calls the final minutes "Final MOM"; its "Download minutes (PDF)" and the menu's
  "Export minutes (PDF)" give the same single PDF.

### Bug fixes
- An Arabic name with digits or Latin letters in it (a project called "مشروع الإطلاق 817ab4") keeps
  its order in emails.

## [1.0.1] - 2026-10-17

### Bug fixes
- Deploying the web server from GitHub works again. Its build tools are now installed even where
  the server is set up as production; since 16 October every deployment had stopped with
  "tsc: command not found", so the site had stayed on its earlier version.

## [1.0.0] - 2026-10-17

### New features
- Tasks: Kanban boards with drag and drop (one day at a time, carrying unfinished work forward), My
  Tasks, and a task panel with checklist, comments with @mentions, files, dependencies, watchers and
  the full history of changes.
- Recurring tasks: daily, weekly on chosen days, monthly or quarterly (a date or "the 2nd Tuesday"),
  yearly, ending never, after a number of times or on a date, and pausable.
- Milestones: mark a task as a milestone; boards, the task panel and the project dashboard flag it.
- Projects with a number, a picture or icon, a team and a dashboard: overview and timeline,
  milestones, deadlines, tasks by phase, meetings, decisions and action items, and the team.
- Meetings: agenda, notes, attendees with replies to invitations, calendar invitations, minutes as
  PDF, final minutes drafted by AI and approved by the organizer, and action items.
- Repeating meetings: daily, weekly on chosen days, monthly or custom, with changes to one meeting or
  all upcoming ones, kept in step with invitees' calendars.
- Calendar of tasks and meetings by month, week or day, with drag to reschedule, and each person's
  own week start and time zone.
- Chat: project channels and direct messages, with replies, reactions, files and read receipts.
- Notifications in the app, by email and on phones, with each person's choice of what they receive.
- Reports on status, project performance, workload and completion, exported as Excel, PDF or CSV.
- AI help: describe a task in plain English, break a task into steps, suggest its priority, and
  summarize a project; administrators choose the AI provider and model in AI Management.
- Search everything, or jump to any page, from one box (Ctrl+K).
- Keyboard shortcuts for saving, submitting, searching, adding, editing, deleting, cancelling and
  refreshing, listed with Ctrl+/.
- The version and when it was last updated in every page's footer, and this version history under
  About.
- Sign in with a password or a code sent by email; forgotten passwords are reset by email.
- Administration: user management, system settings and audit logs.
- An Android app, a Chrome extension, a self-contained Windows server for an office, and the web
  server at task.mico360.com.

### Improvements
- Every page works on phones and tablets, including with the on-screen keyboard open.
- Changes made by others appear live on boards, meetings, chat and dashboards.
- Changes made while offline are kept and sent when the connection returns.
- Dates and times follow the company's time zone (Oman time).
- Keyboard and screen-reader access throughout, checked with automated accessibility tests.

### Security
- Accounts lock after five failed sign-ins; sign-in tokens are rotated and stored only as hashes.
- A suspended, deleted or demoted user loses access at once, not when their session ends.
- Every request is checked against the person's role and project membership.
- Security headers, an allow-list of web origins, rate limits, and checks on uploaded files' type
  and size.
- Administrators' changes are recorded in the audit log.

### Bug fixes
- More than 150 problems found in code reviews, audits and testing before this release were fixed,
  among them repeating meetings that could move a week late, calendar updates that skipped
  invitees, and dialogs that could not be reached on small screens.
