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
