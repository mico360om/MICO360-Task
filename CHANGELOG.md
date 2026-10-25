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

## [1.13.0] - 2026-10-25

### New features
- Welcome emails: administrators can send a new person their username, the site's address and a
  "Set your password" link (it works once and for 7 days), with the Android app and the Chrome
  extension — never a password. Send one from a person's row in User Management, to people you tick,
  or to everyone who has never signed in (people sent one in the last 7 days are left out). Each send
  asks first, says who it goes to, and lists who it couldn't be sent to and why. Inactive, suspended
  or blocked addresses never get one. Add user sends one by default, so the temporary password is
  now optional. Every email sent is in the Audit Log.
- User Management shows each person's last sign-in ("Never signed in" for those who haven't), can
  show only the people who have never signed in, and sorts by last sign-in. Existing people get
  their last sign-in from their newest session when this version is installed.

### Security
- A welcome or password-reset link stops working when the person's email address is changed, or when
  the account is made inactive, suspended or deleted. A link for an account that isn't active is
  refused.

### Improvements
- Projects: a project's name gets the card's full width; its status sits under it with the code and
  client, so names no longer cut to "Finance Automat…".
- Timeline: the same for each project's row (the status under the name), drawn icons for overdue,
  done and milestone tasks, and the legend uses the same icons as the badges.
- Meetings: the cards fit as many columns as have room, so beside the menu on a tablet they keep a
  readable width instead of two cramped columns.
- Touch screens: calendar entries and "+N more" are taller (28px) and the month works out how many fit
  at that size; the footer's links and "Get a key" in AI Management are easier to tap; on a phone,
  Workload and User Management keep the names in view while the rest of the table scrolls sideways,
  and say to swipe.
- Pages no longer jump while they load: Meetings, a meeting, a project and About keep the space of
  what's coming.
- Accessibility: MICO AI's messages can be scrolled with the keyboard; the task panel's delete bar is
  no longer announced as a second page footer; the calendar's "+N more" is a full-size target; the
  Workload daily-limit box is wide enough to read.
- Drawn icons replace emoji for repeating tasks, an all-clear dashboard, an empty chat, "Create task
  from note", pausing a series and a locked account.

## [1.12.1] - 2026-10-24

### Bug fixes
- Timeline: a project without its own start or target date now takes them from its tasks — from the
  earliest start or due date to the latest due date — instead of running from the day it was created
  with no end. Its bar has a dashed outline and says "dates from tasks", and its details say
  "1 Oct → 12 Dec 2026 (from its tasks)". When the last task's due day has passed with work still open,
  it shows as Late: "Last task was due 21 Oct · 3 days ago".

### Improvements
- Timeline: open a project's row (▸) to see its tasks under it: overdue ones first (red, ⚠), then open
  ones in the shown weeks, then done ones (grey, ✓), each with who has it; click one to open it. Up to
  30 per project; when there are more, "30 of 57 shown" and "Show all 12 open tasks" (on the project's
  Tasks tab), plus "N open tasks have no due date". Expand all / Collapse all opens every row, and on a
  phone each project's Tasks button lists its tasks with their due days.

## [1.12.0] - 2026-10-24

### New features
- MICO AI, a chat assistant (in the menu, and "Ask MICO AI" in Ctrl+K): ask about your tasks, projects,
  meetings and minutes, reports and workload, and the team chats you're part of, and follow up in the
  same chat. It answers only from the data you can see, shows its sources, says plainly when something
  isn't available instead of guessing, asks when a question is unclear, and gives tables you can
  download as Excel or PDF. Chats can be renamed, searched and deleted, and are private to you; MICO AI
  can't change anything. It needs the AI service set up in AI Management.
- Move tasks to another project: from the task's ⋯ menu, a board card's ⋯ menu, or My Tasks' "Move to
  project…" for several at once. A task gets the new project's next number (RIG-4 becomes OPS-17) and
  its old number still finds it; comments, files, checklist, history, watchers and blockers go with it,
  and a repeating task's next copies are made in the new project. People assigned who aren't on the new
  team are added to it or unassigned — you choose. Administrators and people who manage both projects
  (owner, named manager or a team manager) can move tasks; the old project's activity says where it went.
- Timeline: every open project on one chart — a bar from start to target filled to the share done,
  marked On track, At risk (much less done than time used) or Late (the part past the target hatched),
  with milestones, meetings, five summary cards, the busy weeks, and a simple list on a phone.
- Workload: each person's open tasks due each day of the week against a daily limit (5 unless an
  administrator changes it), with days off from the company's meeting hours, and one suggestion per task
  to give it to the least-busy teammate on the project or move it to a lighter day — nothing changes
  until you click. Administrators see everyone, project managers their projects' people, everyone else
  their own row.

### Improvements
- New task numbers follow the highest number used in the project, so a number is never given twice,
  even after tasks moved out.
- The Chrome extension's search finds Timeline, Workload and MICO AI (they open on the website), and
  opens a task by the number it had before it moved.

## [1.11.0] - 2026-10-23

### New features
- In the Android app, a Meetings tab like the website's: Up next, search, filters and each meeting's
  details; Accept, Maybe or Decline; Join; and My Action Items. Meeting links and notifications open in
  the app.
- In the Android app, organisers can run meetings from the phone: schedule and edit them in company
  time (with repeats, for this meeting or all upcoming ones), start and end them, send invitations, add
  or remove people and guests, take attendance, edit, reorder and tick the agenda, write Live notes
  (with Undo, and turn a note into a task), keep action items, draft, approve and reopen the Final MOM,
  and share or email the minutes PDF. Notes, ticks, attendance and action items made offline are sent
  when the phone is back online.
- In the Android app, the meeting AI from the website: "Describe the meeting" fills the form from a
  sentence (tick what to use), Free times suggests three times and shows who already has a meeting,
  "Write description", a new meeting's People and Agenda saved with it, and "Draft agenda" in the form
  and on a meeting's page (reviewed before anything is added).
- In the Android app, Chat keeps every message on the phone until the server has it: "Sending…",
  "Waiting for connection" while offline, or "Not sent" with Retry and Discard. Messages written offline
  go out in order when you're back online, even after closing the app, and are never shown twice.
  Older messages load as you scroll up, a "new messages" button and "Jump to latest" bring you back,
  a chat notification opens its conversation, the Chat tab shows how many messages you haven't read,
  and recent conversations can be read offline.
- In the Android app, Chat has the website's features: direct messages with anyone on the team, replies
  (tap the quote to see the message), editing and deleting your own messages, copying text, emoji
  reactions, pictures and files, delivered and read ticks, who is online, favourite, mute and archive,
  message search, a conversation's members, and an unsent message kept for each conversation. Threads
  show a line for each day and where the unread messages start, and the list is grouped as on the
  website.
- In the Android app, the full New task form from the website: Describe it in plain English, project
  and column, priority, a due date picked from a calendar, repeat, several assignees, milestone, and
  files or pictures. "+" on every board column starts a task in that column; the calendar's "+ Add",
  project pages and My Tasks open the same form. A task made offline without files is kept and sent
  when you're back online.
- In the Android app, board cards look like the website's (the column's colour, the people on the task,
  and counts of subtasks, comments and files). Long-press a card to move it up or down, to the top or
  bottom, or into another column (TalkBack has Move up and Move down too). Pick the board's day, and a
  task's due date, from a calendar. Administrators and project managers can add, rename, recolour,
  show or hide, reorder and delete columns and set their status.
- In the Android app, the Kanban Board can show every project on one board ("Board: all projects" on the
  Projects tab, or Kanban Board in the side menu): Backlog, To Do, In Progress, Blocked, Review and
  Done, each card showing its project. Long-press a card to change its status; "Projects:" chooses which
  projects show; "+" on a status starts a new task there; it works offline and updates live.
- In the Android app, My Tasks has the website's All, Open, Overdue and Completed chips, filters, sort,
  saved views and bulk actions (complete, due date, priority, assign, move), with progress and Stop.
  A task's details have Edit (the full form, with the start date, asking "This task or the entire
  series" for repeating tasks), previews of pictures, text, CSV, Word, Excel and PowerPoint files, how
  often the task was carried forward, and they update live while open.
- In the Android app, the Calendar shows everyone's tasks in your projects, as on the website, with
  filters, Month, Week and Agenda views (your week start), repeating tasks still to come, "Go to a date",
  long-press to move a task to another day (this one or the series, with Undo, also offline), and "+"
  for a task due that day. Offline it shows the last days you looked at, and says so.
- In the Android app, Projects show each project's picture, icon or initials, status, progress, tasks,
  overdue count, dates and owner. A project opens a dashboard like the website's (stat tiles, Overview,
  Tasks with filters and search, Meetings, Team and an AI status summary), also offline from the last
  copy. Administrators create and edit projects with the website's form and change a project's status;
  administrators and project managers manage the team. Home shows administrators every project's totals.
- In the Android app, Profile matches the website (photo, name, username, role, account details,
  Change password and Download my data), and Settings has the daily task emails ("Send me a test now"
  too) and Calendar & dates (week start and your own time zone).
- In the Android app, the Alerts tab shows how many alerts you haven't read, as does the app's icon on
  phones that show numbers; alerts stay up to date, an alert about a project opens its dashboard, and
  opening an alert or tapping its phone notification marks it read. A new Activity screen in the side
  menu shows who did what across your projects, and Reports can show dates you choose and has the
  website's charts (TalkBack reads each chart, and its numbers can be shown as a list).
- In the Android app, administrators can manage users (find, filter, add with a temporary password,
  change details, role and status, set a new password, unlock and delete) with the website's rules;
  Search (🔍 on every tab and in the menu) finds tasks, projects, people, meetings and pages ("open
  MICO-7" opens that task); About shows the app's and the website's versions and the version history;
  and administrators' menu opens AI Management, System Settings and Audit Logs on the website.
- In the Android app, the website's links open in the app: tasks, projects and their boards, meetings,
  chats and the other pages the app has.

### Improvements
- In the Android app, screens refresh when you come back to the app or the connection returns, saving
  reloads only what changed, live updates arrive in one batch, and large boards and the Projects list
  load faster.
- In the Android app, "From meeting" opens the meeting, Back keeps your place, and the app uses one
  live connection.
- In the Android app, a conversation is marked read while it's open (not behind the fingerprint lock),
  @mentions suggest only the people in it, and new messages appear in place without a reload.
- On the website, "Mark all read" leaves notifications that arrived while the list was open unread
  (the Chrome extension already asks for this), and phone notifications say which alert they are for.
- In the Android app, Quick add no longer asks for estimated hours and tags, as on the website's New task
  form.

### Bug fixes
- In the Android app, a change saved on the phone without a connection can no longer overwrite a newer
  change to the same thing when the phone syncs, a change the server didn't answer in time keeps waiting
  (you can discard it) instead of being marked failed, a change that only failed to leave the phone is
  never stopped as "hasn't answered", and a later change waits behind an earlier one. Trying again after
  a time-out never does anything twice.
- In the Android app, offline sync no longer reloads every screen, cards and calendar tasks moved offline
  stay put until sent, and lists from the saved copy refresh when back online.
- In the Android app, Chat stays at the newest message as new ones arrive, keeps your place while you
  read further up, and no longer loses messages you just sent or ones the server refused.
- In the Android app, bulk changes on My Tasks no longer reload the whole list for every task and use the
  newest copy of each task; the Edit form can save an older task whose start date is after its due date;
  and the assignees field no longer says nobody is assigned before it has loaded.
- In the Android app, the number on the app icon clears when you read an alert and at sign-out, tapping a
  notification marks exactly that alert read (after the fingerprint lock), and "Mark all read" leaves
  alerts that came in meanwhile unread.
- In the Android app, My Tasks shows changes made offline straight away, a long text or CSV preview
  shows its beginning quickly, a picture that can't be previewed says so, an export cut off half-way
  leaves no partial file, the All projects board updates within about two seconds without reloading
  over and over, and searching for someone you already chat with opens that chat, even offline.
- In the Android app, a password change keeps you signed in on the phone and signs out your other
  devices, time zones use the website's names and can all be reached, and the daily-email time works with
  the Android number keyboard.

- In the Android app, project initials on the amber colour are written in near-black, as on the
  website, so they are easy to read.

### Security
- In the Android app, on a shared phone a change waiting its turn is sent only as the person who made it,
  an export opens only for the person who asked for it, "kept on this phone" messages show only to the
  person who saved, a bulk change on My Tasks stops when the person who started it signs out, and a
  session refresh or password change can never sign someone in with another person's session.
- In the Android app, chat files and profile photos load only from your MICO360 server, picked files are
  removed from the phone's cache once sent and at sign-out, and links with a broken id or a very long or
  crafted address open nothing.

## [1.10.1] - 2026-10-23

### Bug fixes
- Project initials on the amber colour are now written in near-black instead of white, so they are
  easy to read (white was too faint): on the website, in the Chrome extension and in the emails. Every
  project colour now meets the usual readability standard (4.5:1).

## [1.10.0] - 2026-10-23

### New features
- Each project has a "Carry unfinished tasks forward" switch (on by default). With it off, the nightly
  carry-forward (and an administrator's "run now") leaves that project's unfinished tasks on their
  days. The company-wide switch in System Settings still comes first.
- A project can make new tasks due today: with "New tasks are due today" on, a task added without a
  due date gets today's date (the company's calendar day), or the day of the board it is added to when
  that is later. Dates people choose are always kept, and a date cleared later stays cleared. It
  applies however the task is made: the website, the Android app, the Chrome extension, quick add and
  meeting notes. The New task form says which date the task will get.

### Improvements
- The Projects page is redesigned: status tabs with counts (All, Active, Planning, On hold, Completed
  and Archived; archived projects are no longer mixed in), one search over name, code, client and
  project number (press /), Owner and Sort (Needs attention, Name, Recently updated, Target date,
  Progress) and, for administrators, "Only my projects". Compact cards show progress, open and overdue
  tasks, the next due day, the team, the owner and the target date with the days left. Change a
  project's status from its card (archiving asks first); "⋯" has Edit, Open board and Archive. The
  page keeps its filters in the address, so Back and shared links work.
- System Settings → Daily task emails: the list comes in pages of 20, 50 or 100 people (remembered in
  this browser), with Previous / Next and "Showing 21–40 of 63 people". Find a person also finds people
  by username (with or without "@"), takes several words in any order, ignores capitals and accents,
  and says how many match. A new Email filter (Both / Pending tasks / Completed yesterday) shows just
  that email on each card, and Status then applies to it.

## [1.9.2] - 2026-10-23

### Improvements
- The morning emails (pending tasks, and tasks completed yesterday) are grouped by project: each project
  has its own section with its picture or initials, code, project number, client, manager and target
  date, its status, how many of its tasks are yours (and how many are overdue or due today), and an
  "Open project" link. Each task shows its due day, priority and status as coloured labels, with an
  "Open" button, and the email starts with the day at a glance (overdue, due today, upcoming).
  Long lists show up to 10 tasks per project, 30 in all and 8 projects, then say how many more there
  are, so Gmail never cuts the email off.
- Every email from MICO360 Tasks is wider on a computer (up to 720 px instead of 600 px) and uses the
  whole width of a phone, with a slimmer header (today's date on the morning emails) and a shorter
  footer. They also read well in dark mode.

## [1.9.1] - 2026-10-23

### Bug fixes
- "Send me a test now" (website and Chrome extension) no longer says the emails were sent when your
  address is blocked after a bounce or spam complaint; it says plainly that nothing was sent and to ask
  an administrator to check the address.

## [1.9.0] - 2026-10-23

### New features
- System Settings → Daily task emails shows the day at a glance: how many people get the morning
  emails, how many were sent, skipped (nothing to send), failed, retrying, late (due but not sent yet)
  and still to come, when the server last checked, and when the next email goes. If the server hasn't
  checked for a while although emails are due, it says so plainly.
- "Send today's emails now" sends, in the background, every morning email whose time has come and
  that hasn't gone yet (failed ones too); the page shows how far it has got and then how it went.
  Nobody gets an email twice, and anyone whose time is still to come gets theirs at their usual time.
- Every person is listed with each email on or off, their send time and time zone (and their own day
  when it differs), and how today's email went. Send or Resend one person's email (Resend, or a send
  before their time, asks first), and Preview an email exactly as it would be sent now. Find a person
  by name or email; the Day and Status filters stay. Manual sends are recorded in the Audit Logs.
- The Chrome extension's Settings → Notifications has "Send me a test now" for the two morning emails,
  as on the website, and administrators get a "Daily email log" link that opens the page above.

### Bug fixes
- A daily email that went out is never sent again because of a database problem, pressing Send while
  email is down no longer uses up the automatic retries, an address blocked after a bounce or spam
  complaint is shown as skipped (with the reason) instead of sent, and send times are right on days the
  clocks change.

## [1.8.1] - 2026-10-23

### Security
- The server's web framework (fastify) is updated to 5.12.7, which checks request headers more
  strictly (CVE-2026-107832).
- The address-checking library behind the sign-in rate limit (ip-address) is updated to 10.7.4, so an
  address with a zone identifier can't be mistaken for another one (CVE-2026-111997).
- The test tools (vitest 4.1.12) are updated, closing two weaknesses in the test runner's mocking
  helper (CVE-2026-112949, CVE-2026-112950). They are used only when running the tests, never by the
  live site.

## [1.8.0] - 2026-10-21

### New features
- The Chrome extension's board shows what the website's cards show: the due date (marked "Overdue"
  when late, never for finished work), steps done, comments, files, up to three people, milestones,
  blocked and repeating tasks. Add a task in any column with the full New task form, on the day the
  board shows.
- The Chrome extension's My Tasks can be filtered by project and sorted (due date, priority, progress,
  title), and "Mark done" finishes a task straight from the list.
- The Chrome extension's projects show their picture or icon, their number and their status in plain
  words, with "Open dashboard on the web".
- The Chrome extension's Settings → Notifications lets you choose which notifications you get, when
  "due soon" reminders come, and your morning emails, as on the website. Desktop alerts can say what
  the newest notification is about (off until you turn it on), and clicking one opens it.
- The Chrome extension's chat stays current: an open conversation shows new messages every few
  seconds, and you can send files and pasted pictures, load older messages, start a direct message,
  and favorite, mute or archive conversations. Pictures, files, the message a reply answers and
  reactions are shown, and the sender sees "Delivered" once your direct messages arrive. What you type
  and messages that weren't sent stay with their conversation.
- The Chrome extension has search as on the website: Ctrl+K or the Search button finds tasks,
  projects, people, meetings and pages and opens them in the extension; typing "mico" and a space in
  Chrome's address bar searches too.
- The Chrome extension's Calendar shows the month, week or agenda as on the website — your projects'
  tasks, overdue tasks first in the agenda, the copies repeating tasks will make, and meetings — in
  your own time zone and week start.
- The Chrome extension has Meetings: Up next with Join (also on the Dashboard), the coming meetings with
  your answer, each meeting's page, and Accept, Maybe or Decline (kept on this device while offline).
  Meeting notifications and "From meeting" open the meeting in the extension.
- The Chrome extension has a side panel beside any page: Today (overdue, due today and done today,
  with Mark done), My Tasks and Add a task; a task opens inside the panel. Open it from the popup's or
  the app's side-panel button, or set a keyboard shortcut at chrome://extensions/shortcuts. It keeps
  itself up to date while open and adds no new permission warning.

### Improvements
- The meetings list tells each person their own answer to every meeting, so the apps don't need a
  request per meeting to show it.
- The Chrome extension: keyboard focus is never hidden under the app page's or the side panel's top
  bar; Today and My Tasks don't redraw when nothing changed, and their groups are headings for screen
  readers; each window's side panel keeps its own unsent task; and "Mark all as read" marks only the
  notifications you saw (also when it is sent later from offline).

### Security
- The Chrome extension shows project pictures only from your MICO360 server, and uses only proper
  colour values; files and pictures in chat are linked only from the server's stored uploads.
- The Chrome extension: the next person to sign in after a session ends starts clean (the last
  person's desktop-alert setting, drafts and recent tasks don't carry over), and signing out takes the
  last desktop alert off the screen.

### Bug fixes
- The Chrome extension: a task added from the board's New task form while you switched tabs now
  appears on the board at once; after adding a task from an empty column, focus goes back to that
  column's "Add a task"; "Mark done" keeps keyboard focus while it works and when it can't be done; and
  screen readers hear a project card's status, number and description.
- The Chrome extension's chat: messages go in the order written, even when an earlier one waits on
  this device; Retry really sends again after a refusal; a message just saved on this device no longer
  disappears for a few seconds; a conversation that is gone says so; and it reads well with a screen
  reader.
- The Chrome extension: typing the morning-email time saves it once, when you leave the field or press
  Enter (it used to save 00:00 while you typed), and quick changes to notification preferences save in
  order.
- The Meetings list keeps today's and recent meetings when many repeating meetings lie ahead: it now
  holds every meeting still to come and the 500 most recent ones (before, only the 500 latest-starting
  meetings were listed, so weeks of repeats could push today's out).
- Links from the website and its emails — including the password-reset link — open in the Android app
  again: the website now names the app's current signing key (since app 1.1.0 only the old, retired
  key was listed, so Android wouldn't hand the links to the app).
- Editing a repeating task for the entire series now says what goes to every copy — the title,
  description and priority — and that dates change on this copy only (it wrongly named the due date).

## [1.7.0] - 2026-10-21

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
