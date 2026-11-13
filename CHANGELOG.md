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

### Security
- Logging out can no longer be undone by a sign-in renewal that was still on its way.
- A request started by one person is never re-sent as another person who signs in on the same browser.
- Changes waiting offline are only sent for the person who made them.
- The Chrome extension's saved pages belong to the person who opened them.

### Bug fixes
- Unsent chat drafts and waiting messages are removed when you log out, and are never shown to the next person on the same browser.
- Meetings you created stay in your Meetings list and in search after you hand them to another organizer.
- Top-bar search finds your newest meetings however many meetings there are, and stops showing a meeting as soon as you are taken off it.
- The chat conversation list loads faster when you have many conversations.
- Meeting page: the Series panel shows earlier meetings' titles in full, wrapping by word, instead of one letter per line.
- Pages you open from a link start at the top: My Action Items no longer opens with its title hidden under the top bar.
- MICO AI answers and their tables show the names of tasks, projects, meetings and people instead of internal codes.
- A column's status can't be changed to or from Done while it still holds tasks, so finished dates stay right.
- A repeating task that missed making its next copy gets it within the hour.
- Changes made offline are sent in the right order, so a task ends where you last moved it.
- Two people linking tasks at the same moment can no longer make a loop of dependencies.
- Reordering board columns is saved all at once.
- Background jobs run as often as intended.
- Swapping a task's assignee in Workload no longer overwrites someone else's newer change.

## [1.23.26] - 2026-11-13

### Security
- Two administrators can no longer remove each other at the same moment and leave the site without an administrator.
- Logging out now ends the whole session, even if it was being renewed at that moment; a late renewal after logging out no longer turns off fingerprint sign-in.
- A deactivated account or a changed password stops working immediately.
- Unused emailed sign-in codes end when the password is reset or changed, or the account is deactivated.
- A repeated request is answered only while the session is still valid.

### Bug fixes
- No duplicate tasks after a server hiccup: a saved task is always reported as saved, and the New task and Duplicate forms send a retry as the same request.
- A sent request no longer stays stuck as "in progress".
- Impossible dates suggested by AI are ignored instead of causing an error.
- The daily digest is no longer lost if a notice fails, and one person's failure no longer stops everyone else's.
- openOnly=false works when listing your action items.

## [1.23.25] - 2026-11-13

### Bug fixes
- Learning Hub: the two old how-to slide PDFs are removed from the Tasks and Meetings courses; new training videos replace them.

## [1.23.24] - 2026-11-12

### Bug fixes
- Chat: a message waiting to be sent in one tab is no longer lost when another tab of the same person sends its own.

## [1.23.23] - 2026-11-12

### Improvements
- If a page's request is dropped on the way (a brief network blip), the site quietly tries again before showing an error or logging it.

## [1.23.22] - 2026-11-12

### New features
- **Notification & Scheduling** (System Settings → Notification & Scheduling, per company): one place for
  working time (days, hours, week start; the site's time zone shown), holidays, reminders, escalations,
  inactivity, quiet hours and channels, with "Preview for a person" showing what someone would get this
  week. Meeting hours and meeting reminder times now live here (their old places link to it).
- **Holidays**: each company starts with Oman's public holidays for this year and next — the Islamic ones
  with expected dates marked "Confirm" and a reminder banner as each comes near — and admins add company
  days off, one-off or every year. Weekends and holidays are shaded on the Timeline.
- **Reminder schedules**: "Standard" (2 working days before the due day, on the due morning, 1 working day
  after, then every 2 working days while overdue) and "Critical" (5, 2 and 1 working days before, on the
  day, every working day overdue); admins add their own, each project picks one and a task can use another.
- **Escalations in two steps**: overdue for 3 working days → whoever runs the project (then weekly); 5 more
  → the company's admins or chosen people (once, also by email). Approvals waiting too long remind the
  approver after 2 working days, then escalate the same way. Blocked tasks: one notice when blocked, then
  weekly. Each project can set its own numbers.
- **Inactivity reminders**: a started task with no comment, status change, checklist tick, file or due-date
  change for 5 working days reminds its assignees; after 10, whoever runs the project too.
- **Settings → Notifications**: each kind of notice by bell, phone and email (kinds your company requires
  are locked on), your own quiet hours, whether meeting reminders and @mentions come through them, and
  "Pause everything except required" for an hour, the rest of today or until the week starts.
- A due date on a holiday or weekend gets a warning in the task form (the date is never moved).
- **Calendar — tasks from start to due**: a task with a start date someone chose and a due date shows as one bar across its days,
  ▶ at the start and ⚑ at the due date (a red ⚑ when overdue); a due-only task stays on its day; a task longer
  than three weeks shows only its two marks. Titles wrap in Detailed rows and show in full on hover. Only a
  crowded day says "+N more" (in Month it opens that week in place; in Week's All day row, the whole row) — the
  other days of the week keep all of theirs.
- **Calendar — Week and Day with hours**: the working hours lit (the rest dimmed and scrollable), an "All day"
  row on top with the tasks' bars and ⚑ due marks, meetings as blocks with their times and 👥, planned time and
  your reminders at their times, and weekends and holidays shaded with the holiday's name (in Month too).
- **Calendar — split view** (wide screens): the calendar on the left and the chosen day on the right — its
  meetings (time, place or online link, your answer), tasks starting, tasks due (overdue first), planned time,
  your reminders and repeats — each section folds, with Open, Complete, Plan time and Remind me on every task.
  "Split | Full" is remembered for you; tablets and phones show the day's list under the calendar.
- **Calendar — drag and drop**: drag a bar to move its start and due together, its ▶ or ⚑ to change that date
  alone, and a task into an hour to plan time on it. Every move has Undo,
  and the keyboard can do the same (Alt + arrow keys, or "Change dates" in the task's details). Moving a task
  nobody has started to a later start says "It will wait until 20 Nov".
- **Planned time**: time booked to work on a task (it never changes the due date) — yours, or planned for the
  task's people by whoever made it or runs its project ("planned by Sara"); resize it from its lower edge, move
  it, or remove it with ×. It shows on your calendar (managers can turn on their team's), counts as planned
  hours on the Workload page, and makes you busy when someone looks for a meeting time.
- **Personal reminders on tasks**: "Remind me" on a task (the calendar, the day's list or the task panel) — a
  date and time, or a time before its start or due date. Each person sees only their own (a bell on the
  calendar); whoever made the task or runs its project can set them for its people, who can mute or snooze
  those. They arrive by bell, phone and email as you choose in Settings → Notifications ("My reminders"),
  following your quiet hours.
- **Meetings on the calendar**: the organizer can drag a meeting to a new time; the calendar asks first —
  "Send the updated invitation to 6 people?" — and the meeting's own update sends it.
- Click an empty day to add a task due that day; click an hour for "New meeting at 10:00" or "Plan time for a
  task…". "Show" chooses what the calendar shows (tasks, meetings, planned time, reminders), remembered for you.
- **Project KPIs** (a project's new KPIs tab): on-time completion, overdue, average days late, progress
  against time used, tasks finished per week, start to done, approval turnaround and open blocked tasks —
  each with its target, a green / amber / red light in words ("On target", "Close", "Off target"), the facts
  behind it and a 6-month trend (12 weeks when you look at a week). Pick this month, a week, a quarter or a
  custom range; click a number to see the tasks behind it; download the KPIs as a one-page PDF or Excel.
- **On time is judged against the agreed due date**: the date set when the task was assigned. A new date
  set by whoever runs the project or an administrator is an agreed extension (decided when it is made); a
  change by the assignee doesn't move it, and taking yourself off a task doesn't take it off your record. A
  date filled in automatically ("new tasks due today") counts until someone sets the real one. A task needing
  approval counts as done when it is handed in. Days late are working days.
- **Late stays counted**: a task that was already late when it was sent to the Recycle Bin or merged into
  another task still counts as late — for whoever had it on its due day, in on time, days late and the late
  counts — and is listed as "deleted while late" or "merged while late". A task deleted or merged before it
  was late doesn't count, and a task restored from the bin simply counts as normal.
- **A project's own KPIs**: whoever runs a project adds KPIs that tasks can't show ("Safety incidents",
  "Budget used %") with a unit, a target and which way is better, and enters each month's value with a
  note; they get a reminder on the first working morning of the month when last month's value is missing.
- **KPI targets**: administrators set each company's default targets (System Settings → KPI targets, e.g.
  on time 85%, days late at most 2); whoever runs a project can set the project's own.
- **My performance** (sidebar): your own KPIs — tasks completed, on time, days late, overdue now, workload
  (planned hours against the hours you have, less your meetings), approval turnaround, how quickly you
  answer comments and @mentions, and meeting action items closed. Only you, the managers of your projects
  (counting only their projects) and administrators can see them; colleagues never see each other's.
  Managers and administrators open a person's from the Workload page or a project's Team tab.
- **Management page**: a KPI table across the projects you see, sortable by any KPI (the furthest off
  target first), with Excel and a PDF with a page per project.
- **Learning Hub** (side menu): learn how to use the site without leaving it. **My learning** shows the
  courses assigned to you (mandatory first, with due days and a red "Overdue"), the ones you started with
  their progress, what you finished and your certificates; the **Catalogue** lists the courses for the parts
  of the site you can use, with search and filters by module and difficulty.
- **Courses and lessons**: each course is a sequence of lessons with estimated times — videos (YouTube or
  Vimeo links, played inside the lesson), step-by-step guides with a picture for each step, documents
  (PDFs open in the page) and quizzes — plus downloads. Your place is saved as you go (the video position,
  the guide step, quiz answers) and "Resume" takes you back to where you stopped.
- **Quizzes**: single choice, multiple choice, true/false and "put the steps in order", with a pass mark,
  retakes (a number or unlimited), feedback on each answer, an optional time limit, random question order
  and an optional question bank (a fresh draw of questions for each attempt).
- **Certificates**: where a course gives one, an A4 PDF with the company logo, your name, the course, the
  date, your score, "Issued by" (a Training manager or administrator, with their title and signature) and a
  code anyone can check on the public page /verify (it shows only the course, the name, the dates and
  whether it is valid). A course can make certificates expire (e.g. after 12 months): you are reminded
  beforehand and retake it.
- **Manage** (Learning Hub, for administrators and Training managers): create, edit, publish, unpublish and
  archive courses by module, audience (staff or clients), role and difficulty; choose what completes a
  course (every lesson, or passing the quizzes) and whether lessons go in order. A change to a published
  course is a "Minor fix" (nothing else changes) or a "Major change" (people who finished it review the
  changed lessons by a new due date; their certificate stays valid meanwhile).
- **Assignments**: assign courses to people, groups (everyone, administrators, employees, clients, people
  who run a project, Training managers), departments, companies or projects — mandatory or optional, due on
  a day or N days after assigned — with a preview of who it reaches first. Group assignments follow
  membership: people who join later get it with their own due date, and people who leave keep what they
  finished. **Onboarding rules** give new accounts their courses automatically ("every new employee: Tasks
  basics and Meetings, due in 14 days").
- **Reminders through Notification & Scheduling**: due soon, due today and overdue reminders on working
  days; overdue mandatory training escalates to the person's "Reports to", else the Training managers; a
  reminder before a certificate expires. Nothing is blocked by overdue training. A "Training" row in
  Settings → Notifications and a "Training" filter on the Notifications page.
- **Reports** (Learning Hub): participation, completion rates, quiz results (down to each question),
  overdue training and certificates expiring, by course, person, department, role, company or project, as
  Excel or PDF. Administrators see everyone, Training managers the people in their companies, and people who
  run a project their team.
- **Feedback**: rate a course (1–5 stars), ask a question (Training managers answer it in the course and
  you are told), or report a lesson as outdated (Training managers see the list and mark it fixed).
- **Learn this feature**: a small link in the header of Tasks, the Kanban board, Meetings, Calendar,
  Projects, Reports, Management, Chat, MICO AI and the admin pages opens the course for that page (shown only
  when there is one you can see).
- **Starter courses**: a ready-made course for each main part of the site (Tasks, Kanban board, Meetings &
  minutes, Calendar, Projects, Reports, Chat, MICO AI, Admin settings and the Client portal) with
  step-by-step guides, pictures of the real screens and a short quiz — marked "Starter" so administrators can
  edit or unpublish them. The Tasks and Meetings how-to slides are attached as downloads, and three video
  courses are ready for the how-to videos' YouTube or Vimeo links.
- **Learning Hub in the Client portal**: clients see only the courses made for clients (never staff
  courses), with their progress and certificates; badges on the portal show what is waiting (no emails).
- **First-time tour**: a short tour of the side menu, My Tasks, New task, the Kanban board, notifications
  and the Learning Hub for new staff accounts (three steps for clients in the portal); skip it any time and
  replay it from the Learning Hub. Administrators can switch it off per company.
- **User Management**: a staff account can have a "Reports to" person, a Department and the **Training
  manager** permission (create, publish and assign training and see its reports, with no other
  administrator powers).

### Improvements
- Merging tasks moves their planned time and personal reminders to the main task (the same person's at the same
  time kept once); Undo puts them back where they were.
- Notices held overnight that a server restart left half-sent are sent at the next release, never lost.
- The Android app (unchanged) still moves only a task's due date on its calendar; the website's calendar now
  moves start and due together.
- Quiet hours (outside working hours and on days off, unless changed): the bell still fills, but phone
  pushes and emails wait for the next working morning and then come as one message — never a burst. The
  Android app and the Chrome extension follow the same rules and their settings keep working.
- The daily email goes on working days only (the first working morning covers everything since) and the
  notices held overnight fold into it under **While you were away**; the weekly Management summary goes on the
  first working day of the week.
- "Days late" count working days everywhere: reminders and escalations, the daily email, project health
  risks, late milestones and the Management page.
- More than three reminders of one kind for one person at once arrive as one notice listing them; after the
  upgrade nobody gets a burst of reminders for what was already due.
- The dashboard shows "Overdue learning" when a course assigned to you is past its due day.

### Security
- Training files (documents, downloads, step pictures, signatures) are kept in a private folder, never at
  the public uploads address, and are sent only to people who may see the course (they are in backups).
- Quiz answers are never sent to the browser before a quiz is handed in; the right answers are shown once
  you pass or have no attempts left.
- The site's security policy allows exactly YouTube's privacy-enhanced player and Vimeo's player to show
  lesson videos (no other site, no outside scripts).

## [1.23.21] - 2026-11-12

### New features
- Task archive: a task you no longer need on the boards can be archived ("Archive" in the task's ⋯ menu, for
  administrators and the people who run its project). It leaves every board, list, My Tasks, the calendar,
  the Timeline, Workload, dashboards, reminders and the daily email, and is read-only, but nothing is lost:
  search still finds it (marked "Archived"), its panel says "Archived on 3 Nov by Ali — read-only" with
  Unarchive, and the project page's "Archived tasks" lists them for anyone on the project. Archiving shows
  "RIG-12 archived · Undo" for a few seconds. A finished task you archive still counts as done in every
  figure (completion %, health, Management, the client's page), so archiving finished work never lowers a %;
  an unfinished one leaves the figures until it is unarchived.
- Reports: a finished task you archive still counts as done in every chart, tile and export (so archiving
  never lowers a %). "Include archived" (off by default) also counts the unfinished archived tasks and lists
  every archived task in the exports, marked "Archived".
- A repeating task whose newest copy is archived keeps going: its future days still show on the calendar and
  its schedule on the project's Inspections tab.
- Change many tasks at once: tick tasks on My Tasks (Grid, List and Table), a project's Tasks tab, any Table
  view, or on the Kanban board after pressing **Select** (a box on each card and on each column; Shift-click
  ticks a range; Escape leaves). "Select all 143 matching" ticks every task the filters leave, and ticked
  tasks stay ticked when the filters change ("12 selected (3 hidden by filters)"). The bar at the foot of the
  window (a sheet on a phone) changes their status, priority, people (assign, reassign, unassign), due date
  (set, clear, or move by days), project, categories and guests, duplicates them, archives or unarchives them,
  moves them to the Recycle Bin or merges them — up to 500 tasks at a time (20 for Duplicate). Each change is
  confirmed first ("Move 12 tasks to Done? 2 will be skipped: you can’t move tasks in Rig 3."), then summed up
  ("18 updated · 2 not changed", the skipped ones listed with why, "Select the 2 skipped" to try again) with
  Undo for 15 seconds.
- Everyone can use bulk changes, and each task is changed only as its own rules allow — who may see it,
  its project's team, approvals (a task that needs approval moved to Done waits for approval), the delete
  rule, archive and the guests rule (a task with guests always keeps someone from the team); a task you
  can't open is never named. Undo puts back only what nobody changed since, gives a moved task its old
  number back, and erases copies made by Duplicate at once. The people on the tasks get one notice for the
  whole change ("Sara assigned you 12 tasks in Rig 3"), open boards refresh once, and the Audit log keeps
  one line for it.
- A new daily email: wider (720 px on a computer, fitting any phone), compact and clear, in the site's colour
  scheme and readable in light and dark mode, in Outlook, Gmail and phone mail apps. It opens with **Today at a
  glance** — your open, in progress, not started and overdue tasks and how many you finished this week (Overdue
  turns red when anything is late) — then **This week** (how many of this week's tasks are done, with a bar, and
  the tasks you finished each day of the last 7 days against the week before) beside **By priority** (urgent,
  high, normal, low, each with a bar). Then **Overdue** ("3 days late", with a red edge), **Due today**
  ("today 14:00"), **Coming up** (the next 7 days, and tasks that start on a later day) and **Other open tasks**
  (the rest, by project — nothing is left out), **Today's meetings** and **Completed yesterday**. Every task shows
  its number, title, project, status and priority (word and colour), its day, its categories and guests ("Guest:
  Ahmed (Acme)") and, when it has one, its checklist ("4/7 · 57%" with a small bar). Archived tasks are left out
  (a finished one you archived still counts in This week and Your projects). Your week starts on your own week start and every day and time is in your own
  time zone.
- For people who run projects (and administrators, for the projects they run): **Your projects** — each project's
  completion bar (as the Projects page counts it), how many tasks are overdue and how many wait for your approval
  — above the list of others' overdue and waiting tasks. Only projects you can see.
- Settings → Daily email has a switch for every part, in the email's order. The five new parts are on; if you had
  turned "Your tasks" or "Recently completed" off, the new parts that go with them stay off. The phone app's and
  the extension's switches keep working as before.
- **Preview my email**, for everyone in Settings → Daily email (next to "Send me a test") and for administrators
  in System settings → Daily email: your own email as it would be sent now, at a computer's or a phone's width —
  only ever your own; it works before email is set up, and sends nothing.

### Improvements
- The daily email stays within Gmail's size limit on busy days by trimming the less urgent lists first (overdue
  and due-today tasks keep the most rows), and says how many more there are and where. An email with nothing
  in it is still not sent.

## [1.23.20] - 2026-11-12

### New features
- Guests on tasks: people outside the company — a client's engineer, a supplier's site lead — can be named
  on a task for the record. The Assign box (New task, Edit task and the task panel) has a switch
  **Internal user | Guest**: pick a guest from your company's list, or add a new one (name required;
  company, designation, email and phone if you have them). If the same person is already on the list, the
  form says so ("Ahmed Al Harthy (Acme) is already on the list — use them?"). A task can have several team
  members and several guests, and always needs at least one person from your team, who looks after it.
  Guests never sign in, never get emails or notices, take no licence and are never shown to clients.
- Guests show on the task's right side under Assigned (with a Guest badge; their phone and email with a
  Copy button, and a note for this task), on cards and rows ("Guest: Ahmed (Acme)"), in the Table view's
  Guests column, in the task PDF and Excel, in the report's task list, and in the daily email of the person
  looking after the task ("with guest Ahmed (Acme)"). Filter by **Guest** and **Guest company** on the
  board, My Tasks, the project's Tasks tab, the Table view and Search results.
- Today's external contacts become guests on your company's list by themselves (the same person on several
  tasks becomes one guest; other details found are kept in the guest's notes). An open task that had
  contacts and nobody from the team gets its creator as the person responsible.
- Admin → Guest contacts: search your company's guest list, change a guest's details (every task shows
  them), retire a guest (kept on old tasks, not offered any more), merge duplicates into one, or remove a
  guest who is on no task.
- Task categories: each project has its own categories (a name and one of 12 colours), set up by admins and
  the project's managers in Edit project → Categories (add, rename, recolour, reorder, retire). A task can
  have several; the project can ask that **every task needs a category**. Categories show as coloured
  chips on cards, rows and the Table view (Compact 1, Comfortable 2, Detailed all), in the task panel, the
  task PDF, Excel, the report and the daily email, with a **Category** filter on the board, My Tasks, the
  Tasks tab, the Table view and Search results — and searching "category:Electrical" finds them too. The
  project's Overview shows its open tasks **By category**. Tags stay as they are.

### Improvements
- Moving a task to another project keeps the categories that project has by name and says which it drops;
  a guest of another company is copied onto the new project's company list. Merging tasks keeps every
  category and each guest once (Undo gives them back); repeating copies keep both; "Save as template"
  keeps a project's categories, and a project made from that template starts with them.
- The task history says "assigned guest Ahmed (Acme)", "removed guest …", "added category Electrical".
- Search this board also finds a card by its guests (name or company) and its categories. Duplicate copies
  a task's guests (with their notes for the task) and its categories, never retired ones.
- A task in the Recycle Bin keeps its guests and categories: its categories count as in use (they can be
  retired, not deleted) and its guests stay on the list until it is erased; its read-only view shows both
  (its history words them as the task panel does), and Restore brings them back as they were.

### Bug fixes
- Recycle Bin: a deleted task's details can be scrolled with the keyboard too (on a phone they scroll and
  have no buttons of their own).

## [1.23.19] - 2026-11-11

### New features
- Recycle Bin: a deleted task is no longer gone at once. It goes to the Recycle Bin (side menu, for
  administrators and the people who run a project) and can be restored for 60 days with everything it had —
  details, people, contacts, followers, tags, comments and replies, files, checklists, blockers and history.
  The bin shows who deleted each task, when, and the days left before it is erased ("12 days left", amber at
  7 or less, red at 2 or less, "Erased tonight" on its last day); search by number, title or description;
  filter by project, who deleted it, the days it was deleted, "7 days or less left" and (with several
  companies) company; sort by days left or by when it was deleted; select several to restore together.
  Administrators see every deleted task and may also delete one forever; the people who run a project see
  and restore that project's deleted tasks. A project's page has "Deleted tasks", the bin filtered to it.
- Delete asks first — "Move to the Recycle Bin? You (or an admin) can restore it for 60 days." (a repeating
  task: this copy, or the entire series with how many tasks it has) — and offers Undo for a few seconds.
  A series deleted as a whole comes back as a whole (or just one copy, if you choose).
- Opening a deleted task (an old notification, an email link) shows it read-only under "In the Recycle Bin —
  deleted by Ali on 3 Nov · 53 days left" with Restore, for the people who may restore it; anyone else on the
  project sees "This task was deleted".
- After its 60 days a task is erased for good, with its files; the Audit log keeps a line saying which task
  was erased and when. Inspections carried out for it are kept and still say which task they were for, and
  its number is never given to another task. Tasks deleted before this version get a full 60 days from the
  upgrade ("Deleted by: Unknown", as it was never recorded).

### Improvements
- A task's history and the Activity page say who moved a task to the Recycle Bin and who restored it; every
  delete, restore and erase is in the Audit log.
- Restoring a task whose board column was deleted meanwhile puts it in the project's first column of the same
  kind; a task of an archived project waits until the project is unarchived. Undo of a task MICO AI has just
  made removes it at once (it never goes to the Recycle Bin).

## [1.23.18] - 2026-11-11

### New features
- MICO AI's answers appear as they are written: on MICO360 AI the words show on the page while the model
  writes them (bold and lists as the finished answer has them), and the finished answer then replaces them.
  Stop still stops it at once.
- Scanned files are read whole on MICO360 AI: every page of a scanned PDF (black-and-white scanner PDFs
  too, which could not be read before) and pictures go to MICO360 AI's document reader, which turns pages
  upright first and reads them in Arabic or English when the task's words say which. Scans that could not
  be read before are read again by themselves. If the key may not read documents, scans are read as
  pictures as before, and AI Management says why and what to allow.
- AI Management shows more about MICO360 AI on its card: the version of MICO360 Connect it runs, how many
  requests its key may run at once, a note when no AI node offers reading documents, pictures or meaning
  search, a note when scans were read as pictures, and which models stood in for others. Test now says
  which model answered.

### Improvements
- MICO360 AI's answers to Describe a task, Describe a meeting, Suggest priority, Draft agenda, the Final
  MOM and MICO AI are held to the exact form Tasks reads, so fewer answers come back unreadable. If the
  MICO360 Connect doesn't accept that, or an answer doesn't come back in that form, Tasks asks once more
  the way it did before, and keeps asking that way for a day (or until the models are next refreshed);
  AI Management's card says so.
- Tasks keeps within MICO360 AI's limit on how many requests a key may run at once — one budget for every
  AI feature together — so busy moments wait their turn instead of being refused.
- Work in the background is never done twice on MICO360 AI: when the Final MOM, a MICO AI answer or a scan
  is tried again, the platform answers from the first try's work; and an answer the platform finished after
  its 5-minute wait is collected instead of asked for again.
- The first AI search of the day waits for MICO360 AI to load its model (up to 90 seconds, instead of
  giving up after 20), and opening search starts loading it.
- "Automatic" picks MICO360 AI's models by what they are, no longer preferring one only because it
  appeared in the platform's list later.
- Clearer words when MICO360 AI refuses: a key it doesn't accept, a key not allowed to do something (and
  where to allow it), or a model that failed while answering.
- The Error log shows MICO360 AI's correlation and job ids for an AI failure, to look up in MICO360 Connect
  or quote to its support. Each request also tells MICO360 AI which Tasks user it is for (MICO360 Connect
  keeps only a pseudonym).

## [1.23.17] - 2026-11-11

### New features
- Duplicate a task: "Duplicate…" in the task's ⋯ menu (task panel and board cards) and beside Open in
  every Table view. The New task form opens filled in from it — title, description, project, assignees,
  priority, dates, tags, checklists (every item unticked, sub-items kept), external contacts, the
  inspection form and place, milestone, weight, estimate and watchers — titled "Duplicate of MSSP-34", so
  you can change anything (or pick another project) before saving. "Copy files (3)" is ticked unless you
  untick it; a file that can't be copied is named ("2 of 3 files copied — “x.dwg” couldn’t be copied") and
  the task is still made. The copy gets its own new number and starts in To do; comments, history,
  completion, approvals and the repeat are never copied. The copy shows "Duplicated from MSSP-34" and the
  original lists its copies (only the ones you can open), and both histories say so. Duplicating needs
  the internet connection.
- Tasks for the future: the New and Edit task form has a Start date. A task that starts on a later day
  waits until then — it is on that day's board, not today's, and the form says "Scheduled for 20 Nov".
  Until its day it is under "Upcoming" in My Tasks and in the project's task list, and out of today's
  lists, the Open and Overdue counts, My Priorities and the due-date reminders; the calendar, the Timeline,
  Workload and the daily email's new "Coming up" part still show it. On its start day it is like any task.
  The people on it are told when it is assigned ("You were assigned a task — starts 20 Nov") and again the
  morning it starts ("A task starts today", once). This works for tasks made on the website, the Android
  app, the Chrome extension, with MICO AI, from meeting notes and from a project template that starts later.
  Moving a not-started task's start date to a later day moves it to that day; a task already under way
  stays where it is; moving the start to today puts it back on today's board. Existing tasks aren't moved.
- Manager View, for administrators: a switch in your account menu (saved on your account) that hides
  the settings while you look at the work as a manager does. While it is on, a "Manager View" badge shows
  in the top bar; the Admin menu (User Management, Clients, Companies, AI Management, System Settings,
  Error Log, Audit Logs) is gone, and opening one of its pages by its address says "Manager View is on —
  turn it off to open this page" with a Turn off button; a project's settings (its details, picture,
  columns, team, client links, archive) open only for the projects you run; the dashboard's default for
  everyone and the Workload daily limit can't be changed. Everything else stays as an administrator's:
  every project's tasks, boards and meetings, Reports, Management and your own settings. The server keeps
  to it too — for the website, the Android app and the Chrome extension alike. Turning it off gives
  everything back at once (no signing out), and it can always be turned off. Each switch is recorded in
  the audit log.

### Bug fixes
- A tab left open on an older version no longer shows an error when a newer tab updates your profile details.
- A board card's ⋯ menu near the bottom of the screen (on a phone, or low in a long column) opens above the
  card, so all of its items can be reached.

## [1.23.16] - 2026-11-11

### New features
- Search on the Kanban board: a search box at the top of the board (one project, All projects and a
  project's Board tab) shows only the matching cards as you type — by task number (MICO-12, mico 12 or
  just 12), title, description, person, project or tag, Arabic in any spelling. The words found are
  marked on each card, each column says how many of its cards match ("3 of 12"), and ✕ or Escape clears
  it ("/" jumps to it). It works with the company filter, Day and Month and the Table view, cards can
  still be dragged to another column, and the words stay in the page's link. When nothing matches,
  "Search all tasks" opens the full search with the same words.
- Project details on the Kanban board: with one project chosen, a slim line above the columns shows its
  picture, name and number, client, project manager, dates with the days left (or late), health, progress,
  open and overdue tasks, and "Open project". Fold it away with its arrow (remembered); on a phone it shows
  the short version with "Details".

## [1.23.15] - 2026-11-11

### Bug fixes
- The Error log no longer counts time a page spent in the background as "slow": a page opened in a
  background tab, prerendered, restored with the Back button or left on a sleeping computer is no longer
  "slow to show" (the 986 s and 3386 s rows), and a request that waited in a frozen tab or on a sleeping
  laptop is no longer a slow request (the bell's "15 times in one visit" at night). A slow click or key
  press while the page was hidden doesn't count either, and the Error log now says what it was on ("a
  click on a button"). "Slow to show the page" rows say that their times count only while the page is
  on screen.
- Slow requests on the Error log now say where the time went, from the browser's own timing: waiting
  for a free connection, connecting, waiting for the server to start answering, or downloading the
  answer — with the server's own time, so a hold-up between the browser and the server (the hosting's
  front door or the connection) is told apart from a slow server.
- Update restarts show as handled: while the server stops or starts for an update, the database being
  briefly unreachable is a calm "Update restart" row ("During an update: the database was briefly
  unreachable — handled"), no longer a red Server error, and it never brings back a row marked as
  fixed. A request cut off or held up while the server restarted is listed there too, instead of "A
  request didn't reach the server (blocked on the way?)" or a slow request.

## [1.23.14] - 2026-11-11

### Bug fixes
- People's photos show on Kanban cards, My Tasks, project pages, meetings, Activity and the Dashboard (they showed only initials).
- The picture at the top right shows your current photo and your own name's initials (it showed the username's, and a new photo only after signing in again).

### Improvements
- Faces load a small copy of each person's photo instead of the full picture, so boards and lists with many people open faster.

## [1.23.13] - 2026-11-11

### Bug fixes
- MICO360 AI connects again: its address is now https://ai.mico360.com:5310/v1. Since MICO360 Connect
  2.6.17 the AI platform answers only on HTTPS, so the old http address got no answer at all. A MICO360 AI
  provider saved with the old address is used on https by itself — nothing to re-enter.
- Meaning search on MICO360 AI fills in again: the texts it turns into vectors are sent in batches the
  platform accepts (at most 64 texts, 8,000 characters each, 32,000 together), instead of one batch it
  refused, which stopped the search sweep at the same place every minute.
- Meaning search never mixes two embedding models: when MICO360 AI answers with another model than the
  one chosen (the chosen one was unavailable), those vectors are not kept; meaning search pauses for 15
  minutes and tries again, and the Error log notes it once instead of every minute.
- Text cut in the middle of an emoji is no longer sent to MICO360 AI: half a character could make it turn
  the whole request down, again and again.
- AI keeps working while MICO360 AI's computers are busy: a model the platform leaves out of its list for
  a while (a busy or restarting AI node) stays available for 3 days, and an empty list changes nothing and
  is loaded again within the hour — before, a refresh at such a moment switched AI off for a day ("AI is
  not configured yet").
- Describe a meeting works at large companies too: with hundreds of people and projects its request could
  be longer than the 32,000 characters MICO360 AI reads, and was refused as "too long". On MICO360 AI the
  lists now fit the room left — the people and projects the sentence names come first — and every AI
  feature, MICO AI's chat summaries included, stays within that size at its largest.

### Improvements
- Reading scanned files and pictures, and the Final MOM drafted with AI, now wait as long as MICO360 AI
  itself does (just over 5 minutes) instead of giving up after 2–3 minutes and running the work again;
  making meaning-search vectors waits 2 minutes instead of 30 seconds. Reading scans starts no new file
  after 2 minutes in one go, so the rest of search keeps up to date.
- When MICO360 AI's usage allowance (its quota) is used up, people are told so — "the usage allowance is
  used up for now… an admin can check the key's quota in MICO360 Connect" — instead of "busy, try again in
  a moment". Background work tries again only when the allowance resets within a few minutes; files
  waiting to be read wait until it resets instead of being given up.
- AI Management: MICO360 AI says it uses the AI API of MICO360 Connect 2.6.28 (https on port 5310, under
  /v1) and which capabilities its key needs — Chat, plus Vision to read scanned files and pictures and
  Embedding for meaning search. The setup guide (docs/AI-MICO360.md) is updated to match.

## [1.23.12] - 2026-11-11

### Security
- Updated server libraries to fix 11 known vulnerabilities (zod 4, @fastify/static, fast-uri, typescript-eslint).
  typescript-eslint has no fixed version yet, so the file-pattern library it uses (minimatch) is pinned to
  its fixed version instead; it is a development tool only and never runs on the live site.

## [1.23.11] - 2026-11-10

### Improvements
- Every PDF — a task, the reports, the minutes of a meeting (and the client's copy), the client's task
  list, inspection reports, the Management overview and MICO AI reports — now follows one A4 design:
  narrower margins (14 mm at the sides, 12 mm top and bottom), one font, smaller and tighter type (9.5 pt
  text, 11 pt headings, a 15.5 pt title), and nothing ever smaller than 7.5 pt.
- A slim header on every PDF: the project's picture on the left, the company's logo on the right (the
  built-in logo when the company has none) and the document's title; every later page repeats a slim
  version of it, and every page ends with the company's name, "Printed 10 Nov 2026, 14:05 by Name" and
  "Page 2 of 5" (a copy shared with a client says when it was printed, never by whom).
- A task's status, priority, due date and progress sit in one slim strip in the site's colours, instead of
  four tall cards; reports, the minutes, inspections and the Management overview use the same strip.
- Tables fit their columns to what they hold, keep every date whole, line numbers up on the right, repeat
  their header on every page, never split a row across two pages (a very long one carries on under
  "(continued)") and never leave one row alone on a last page. A table too wide for an upright page turns
  its part of the document sideways by itself; everything else stays upright.
- Headings always stay with what follows them, a small section is never split across pages, no PDF ends
  on a blank page, and a task's PDF leaves out the sections it has nothing for (no attachments, no
  checklist, and so on).
- Much smaller files: pictures and logos are printed at 200 dpi for the size they are shown at. The task
  in the owner's screenshot went from 83 KB on 2 pages to 26 KB on 1; a sample report from 6 pages to 4
  and the Management overview from 4 to 2.

## [1.23.10] - 2026-11-10

### Improvements
- Kanban: overdue cards keep the normal border; the Overdue date shows as a dark-red-on-pale-red badge.

## [1.23.9] - 2026-11-10

### New features
- One colour scheme everywhere — boards, lists, tables, the calendar, the Timeline, the Dashboard, the
  Client portal, the PDFs and the daily email: statuses are Backlog grey, To do slate, In progress blue,
  Blocked red, Review purple and Done green; priorities are Urgent red, High orange, Normal blue-grey and
  Low grey; overdue work has red words and a red edge; work due today or tomorrow is amber ("Due today",
  "Due tomorrow"); project health is green (on track), amber (at risk) or red (late). Every colour reads
  well in light and dark mode, and always comes with a word or an icon. A board's columns now wear their
  status's colour, so every board looks the same (the column colour picker is gone); calendar chips keep
  their project's colour on the edge and gain a small status dot.
- Rows: Compact · Comfortable · Detailed, in Settings → Appearance and on the new "Rows" button of every
  list and table. Detailed shows the description's first line, the tags, the project and everyone on each
  card and row, and never cuts a title — on phones too.
- The left menu folds to its icons with one button at its foot (« / »), and remembers your choice on your
  account. Folded, each icon names itself when you point at it or tab to it, and the Admin pages and your
  saved searches open as a small list from their icon. On a tablet the menu starts folded and unfolds over
  the page; the phone's menu slides in and out smoothly.
- Board column width: Narrow, Normal or Wide, from the board's new button or Settings → Appearance, saved
  on your account.
- Words that are cut short — a task, project, person or file name — show in full when you point at them,
  tab to them, or press and hold on a touch screen.

### Improvements
- The Timeline fills the window: its chart grows to the window's height and scrolls by itself, with the
  weeks always in view (where that leaves room for a few projects; on a smaller screen the page scrolls as
  before). The Dashboard places its widgets side by side in one, two or three columns by the
  room there is, the last of a row stretches, cards in a row end level, and its lists show more rows on a
  tall screen.
- One spacing for cards and page headers on every page, the Client portal included; Day | Month on the
  board keeps its words on a phone; the Client portal's bell count, the Dashboard's welcome band and the
  brand-coloured buttons when you point at them (Comment, Send) are easier to read in dark mode.

## [1.23.8] - 2026-11-10

### New features
- Replies on every comment: every comment on a task now has Reply, not only a client's. Replies sit indented
  under their comment, oldest first, so a thread reads like a conversation; replying to a reply answers the
  same thread and starts with "@name". @mentions work in replies. The person you reply to gets a notice
  ("Sara Ali replied to your comment"), once — not again as "New comment", and not twice when you @mention
  them. In a client's thread a reply stays with the team unless "Visible to client" is ticked, as before.
- Client portal replies: a client who may comment can reply to their own comments and to the team's replies
  they can see; the team member they answer gets a notice. Team-only replies never reach the client.
- When a comment that has replies is deleted, its replies stay together under "Comment deleted".

### Improvements
- Task comments, newest first: in the task panel on every page (My Tasks, boards, projects, calendar, search,
  tables…) and on the Client portal's task page, the newest comment is at the top, and the write box with its
  Comment / Send comment button sits above the comments and stays in view while you scroll them. The newest 30
  show; "Show older comments" loads 30 more.
- Your comment shows at the top the moment you send it. If it can't be sent it stays there, marked "Not sent",
  with Try again and Edit — your words are never lost.
- New comments, edits and deletions appear without refreshing: in the task panel at once, in the Client portal
  within a few seconds. If you are reading further down, a small "1 new comment ↑" button appears instead of
  moving what you are reading; pressing it scrolls smoothly to the top (instantly when your device asks for
  reduced motion). A new comment is highlighted for a few seconds, a thread with a new reply is marked "New
  reply" and keeps its place, and screen readers hear "New comment from …".
- Anyone @mentioned in a comment gets the mention notice only, not a second "New comment" notice.

## [1.23.7] - 2026-11-09

### New features
- Client Portal permissions: in New client, Manage account and on the Clients page, "Project access" is
  now a permission matrix you always see — one row per project with a Role (Viewer, Contributor, Approver
  or Custom) and eight tick boxes: View tasks, View meetings & minutes, Download reports, Receive
  notifications, Comment, Upload documents, Reply to invites and Sign off. Viewer sees and downloads;
  Contributor also comments, uploads and replies to invitations; Approver also signs off finished tasks.
  Picking a role ticks its set; changing a tick makes the row Custom. "Same for all projects" gives every
  project one role. On a phone each project is a card with the same ticks. Existing clients keep exactly
  what they had (shown as Custom), with notifications on.
- Preview as client: a button in the matrix (and on each row of the Clients page) opens the Client portal
  exactly as that client would see it — with the ticks still on screen, before you save or send the
  invitation. Every button is shown but switched off ("Preview — nothing you do here is saved or sent");
  it never signs in as the client.
- Clients can upload documents to tasks shared with them (with Upload documents). The team sees the file
  on the task marked "From client" and is told, as for a client's comment. A new "Show to client" tick on
  any task file (for whoever runs the project) shows it to every client of the project who can view tasks;
  a client always sees their own uploads. Files are only in the Client portal, never on the share-link page.
- A bell in the Client portal and Notification settings: clients are told (on the bell and by email) of a
  reply to their comment, a task ready for their sign-off, a new document shared with them and approved
  minutes sent to them, and choose which ones they want; meeting invitations always come. When a client
  has turned minutes off, the minutes email's report and its Sent log say "Not sent" and why.
- "Clients with access" on a project shows each client's role.

### Security
- Client Portal permissions are checked on every request (deny by default): a file is opened only
  through the portal with View tasks (never its stored address), uploads follow the same size, type and
  content checks as the team's, a client's file name can't hide what it is and always ends in the type it
  was checked as, and notices go only to clients who may see what they are about. Preview as client is
  for administrators, only reads, and is in the audit log. A file moved, or merged, into another project
  (or back again with Undo) is no longer shown to the other project's clients.

## [1.23.6] - 2026-11-07

### New features
- Search understands plain English. Type "Show overdue MICO tasks assigned to me" and the Search page
  shows "Understood as: Tasks · Overdue · MICO · Assigned to me" and lists exactly those. It reads kinds
  ("tasks", "meeting notes", "checklist items", "clients"), due dates ("overdue", "due this week", "no due
  date"), dates ("since 1 Nov", "before 15 Nov", "last week", "this month"), state ("open tasks",
  "blocked tasks", "in progress", "in review", "waiting for approval"), priority ("high priority",
  "urgent"), people ("assigned to me", "assigned to Sara", "unassigned", "created by me", "organised by
  me", "my meetings") and projects ("MICO tasks", "in RIG", "project MICO"). Each chip has an ✕ to take
  it off, and "Search the words instead" searches every word as typed. It only reads clear wording, so
  everyday words in titles still work: "high pressure test", "open hole log", "blocked drain" and "rig 3
  inspection" are searched as words. Put a word in quotes to keep it a word.
- The top bar's first row says what it understood and how many items that finds ("Tasks · Overdue ·
  MICO · Assigned to me → 7"); Enter opens them on the Search page. When AI is set up, the AI panel is
  given the same filters.
- Filters work without words: choose a type, a person or dates on the Search page (or write only
  "overdue checklist items assigned to me") and everything that matches is listed.
- Saved searches: "★ Save this search" keeps the words and filters under a name. Pin up to 5 to the side
  menu under "Saved", each with a live count of what it finds now; an empty top-bar box offers your
  saved searches too. Rename one, replace it with the search on screen, or delete it. If you run a
  project you can share a saved search with its team: they find it under "Shared with you" and can use
  and pin it, but not change it. A saved search always shows each person only what they may open, and
  "me" means whoever uses it.
- Two new kinds of search result. "Checklist items" (with their own person and due date) open their
  task at the item. "Clients & contacts" finds the clients named on your projects ("Client of 3
  projects", counting only projects you can see; it opens the Projects page filtered to that client),
  external contacts on tasks you can open (the task opens with the contact shown) and, for
  administrators, client portal accounts with their status (Invited, Invite expired, Active, Locked or
  Deactivated) and whether their email is verified (opened in User Management). A task found by a checklist item
  now says which checklist: "Checklist ‘Electrical’: Label circuits".
- Onboarding for clients and staff: User Management and the Clients page show one status for every
  account — Invited (with how long ago), Invite expired (invitation links last 7 days), Active, Locked or
  Deactivated — with a Status filter, "Email verified ✓" or "Not verified", and the last sign-in
  ("Invited 5 Nov · resent 7 Nov" under it). Each row has Resend invitation (a fresh link; the old one
  stops working) and Send password reset (a link valid for an hour; their sign-ins stay until they set the
  new password).
- Email verification: someone given a temporary password, or whose email address was changed, enters a
  6-digit code we email them before their first sign-in ("Check your email — enter the code we sent to
  a•••@acme.com"; codes last 10 minutes, Resend code). Using an invitation or reset link, or signing in with
  an emailed code, confirms the address too. Everyone who has already signed in counts as confirmed, so
  no one is asked after the update. The Android app and the extension say "Confirm your email on the
  website first" until it is done. Administrators can mark an address as verified by hand, with a reason,
  when a code can't arrive; the last administrator is never asked for a code. While the server can't send
  email, nothing is asked and a banner says so.
- Manage account has a "Sign-in & email" section: the status, email verified or not, Resend invitation,
  Send password reset and Mark email as verified. Changing someone's email address tells the old address
  and asks for a code at their next sign-in (their open sessions keep working).
- New and Manage account warn while you type when an email or username is already used ("This email is
  already used by Ahmed Al Harthy (client) — Open account") or a client with the same name exists at the
  same organisation, and show each field's rule: usernames 3–32 letters or numbers and . _ -; phones
  digits with an optional + and spaces; an organisation is required for a new client.
- An expired or replaced invitation link now says "This invitation has expired — ask <company> to send a
  new one" before a password is typed; a used one says the account is ready.
- New user and New client ask "How will they get in?" — one way only: Email an invitation link (the
  default; not offered while email isn't set up) or Give them a temporary password yourself. A temporary
  password is made for you (four everyday words and a number, like Kite-Mango-Ripple-Fern-472, or 16
  characters) and shown once with Copy and New one, for you to give them yourself, never by email; after
  that only "A temporary password was set on 7 Nov by Khurram" shows. At their first sign-in they choose
  their own password (the password rules apply, and it can't be the temporary one) before any page or
  the Client portal. The Android app and the extension say "Set your own password on the website first".
  Manage account makes a temporary password the same way (no password box any more).
- Invitation links last 7 days unless System Settings → Accounts says 1, 3 or 14, and each invitation
  can pick its own. An unused temporary password stops working after the same time ("Temporary password
  expired").
- Cancel invitation in Manage account, for someone who hasn't signed in yet: the link (or an unused
  temporary password) stops, and no way in works — no link, Forgot password or emailed code — until a
  new invitation or a temporary password ("Invitation cancelled").

### Improvements
- Deactivating or reactivating an account first says what happens (signed out everywhere at once), with
  an optional reason; the reason is in the audit log.
- The audit log records invitations sent and resent, invitations that expired or were used, email
  addresses confirmed (and how), email changes, reset links sent and used, and which details changed.

### Security
- Search's new results follow each person's access: checklist items and external contacts only on
  tasks they can open, a client only through projects they can see (and counted over those only), client
  portal accounts for administrators only. A saved search shared with a team runs with each person's own
  access, and only someone who runs a project may share with its team.
- Sign-in codes are 6 digits, stored only as a keyed hash, compared in constant time, single use, and
  limited (one a minute, five an hour; five wrong codes end a sign-in, ten an hour per account). Codes,
  tokens and links are never written to a log.
- An invitation link or a temporary password, never both. An invitation sent with a typed password (the
  Android app's New user screen does this by default) is exactly an invitation: the typed password is
  never stored, and the answer and the audit log say it wasn't used. A password made on the server
  together with anything else is refused. A password typed alone through the Android app or the API is
  always treated as temporary (changed at the first sign-in, ends unused). Temporary passwords come from the server's cryptographic generator
  (at least 60 bits), are stored only hashed, never logged or emailed, and are returned once. At most
  five invitations to one person in 24 hours. Temporary passwords set, changed at first sign-in,
  invitations cancelled and the link lifetime changed are in the audit log (never a password). No
  existing account is asked to change its password.

## [1.23.5] - 2026-11-07

### New features
- Project health (1.23.5): every project now has one health mark — Red, Amber or Green, with a dot —
  worked out by one fixed rule that the Projects page, the project page and the Management page (and its
  PDF and weekly email) all share, its reasons always shown. Besides late tasks, late milestones, missing
  checks and a quiet project (as before), it now also looks at progress against time ("62% done, 85% of
  the time used": 20+ points behind is Amber, 40+ Red), tasks blocked for over 7 days (a Blocked column, or
  waiting on a task that is itself late — planned sequences don't count; 5 or more is Red), milestones at
  risk (due within 7 days with half or more of the work they wait on still open) and one person holding
  40% or more of the open work (8+ tasks; teams of two or fewer don't count).
- Projects page cards show the health mark (its reasons on hover or a tap), the worst risk in one line,
  and who is accountable — the project's manager (else its owner) — with their face.
- The project page's Overview tab has five new cards: Health (the mark with every reason, and completion),
  Risks (spotted automatically, each with a short explanation and who is accountable: a milestone's
  people, the project manager, the people a blocked or late task is assigned to, or the owner of a quiet
  project — first 5, then "Show all"), Next actions (the project's next things to do — late, blocked, due
  within 7 days, or dated with no one assigned — in the Dashboard's order, with its Complete, Reschedule,
  Assign and Open buttons; first 7, then "Show all"), Recent activity (the last 10 changes) and
  Accountable owners (the owner, the managers and each open milestone's people).
- Completion by weight: in a project's Edit form, "Count completion by: Number of tasks | Weight". By
  weight, each task counts its points (1–10) instead of one each — give milestones and big jobs more; a
  task without its own weight counts its priority's default (Urgent 4, High 3, Normal 2, Low 1, changeable
  per project). The task form, the task panel and the Table view (a Weight column you can change in place)
  show the weight for such projects. Their completion then counts by weight on the cards, the project page
  ("62% by weight · 70% by count"), the Timeline, the Management page and its PDF, Reports, the Dashboard's
  completion chart, the Client portal and the client page (never 100% until every task is done). Nothing
  changes until a project switches. Next actions also list your own checklist items there that are late or
  due within 3 days.
- Kanban Board: Month view. Beside Board | Table, choose **Day** (the board's day, exactly as before) or
  **Month**, on the Kanban Board page (one project or All projects) and on a project's Board tab. Month
  shows a month's tasks: every month from a task's start date to its due date (only a due date: that
  month; only a start date: from then on while it's open), finished tasks in the month they were
  finished, and open tasks overdue from an earlier month also in this month, marked "Overdue · from
  Oct". Tasks without dates are left out — "No date (12)" adds them. ‹ and › step a month, the month and
  year lists jump anywhere, "This month" comes back; the month is in the address (…?month=2026-11) so a
  link opens it, and the board remembers Day or Month and the month for you on this device (the Kanban
  Board page and project Board tabs each their own). Cards show their dates in the month ("5–20 Nov",
  "Due 18 Nov", "From 5 Nov", "Done 3 Nov"); column counts are the month's. Dragging cards, changing
  status, approvals, New task, the filters, live updates and read-only archived projects work as before,
  and dragging never changes dates. A new task that falls in another month — or a task finished while
  you look at an earlier month — says so ("Saved — it's in Dec") with a link to that month. Repeating
  tasks show once their next copy is made (the Calendar shows the copies to come). Months follow the
  company time zone.

### Improvements
- On a phone, the view switches (Board | Table, List | Table, Day | Month) are full-size touch targets:
  44 px wide as well as tall.

## [1.23.4] - 2026-11-07

### New features
- Smarter Dashboard (1.23.4): "My Priorities Today" at the top of the Dashboard tells you what needs you
  first, in one list, most urgent first, each row saying why — "Overdue 2 days", "Waiting for your
  approval", "Blocks 3 tasks", "Due today", "Urgent", "Blocked by RIG-4" or "Blocked (status)", "Due in 2
  days" (other reasons as small tags beside it). It holds your own open tasks that are late, due today,
  urgent, holding up other tasks, blocked or due in the next 3 days; the tasks waiting for your approval;
  your meeting action items due within 3 days; and — if you run projects or are an administrator — the
  tasks there with no one assigned, in a Blocked column, or 3 or more days late ("Overdue 4 days · Omar").
  It follows the company you picked (and, for administrators, "Show my projects only"). Chips filter it:
  All, Overdue, Today, Approvals, Blocked, Upcoming and Team (for the people who run projects). The first
  10 show, then "Show all (23)". Quick actions on each row: Complete (a task that needs approval goes to
  wait for a project manager), Reschedule (Today, Tomorrow, Next week or Pick a date; a start date after
  the new day moves with it; a repeating task moves only this occurrence), Assign (someone on the project
  team) and Open; Approve and Send back for approvals; Mark done, Reschedule and Open meeting for action
  items. Each change shows at once — for others too — with Undo where it can be undone. Nothing is offered
  that you couldn't do before, and nothing about tasks you can't open is shown or counted.
- Customize dashboard (1.23.4): show or hide each widget, drag it into your own order (or use Move up and
  Move down from the keyboard) and make it Small or Wide — saved to your account, on every computer. On a
  phone every widget takes the full width, in your order. "Reset to default" goes back to the default.
  Administrators arrange two defaults — for administrators and for everyone else — that everyone who never
  customized follows; each change of a default is in the audit log. The widgets keep who sees them today:
  the two charts for administrators, Approvals for the people who can approve. New widgets in later
  releases appear in everyone's Dashboard at the default's place.

### Improvements
- Notifications page: uses the full width of the screen, like My Tasks and the other lists.

## [1.23.3] - 2026-11-07

### New features
- Nested checklists: a task can have several checklists, each with its own title (for example
  "Electrical" and "Plumbing"), and any item can have sub-items, as many levels deep as you need. In the
  task panel the checklists show "Checklists 8/12 completed" overall and "5/8" with a bar on each; the
  counts are of the real to-do items (the ones without sub-items), so nothing is counted twice. Rename,
  duplicate (a copy with its sub-items, ticks cleared) or delete a checklist, and collapse or expand all
  of it, from its ⋯ menu; "Add checklist" adds another.
- Checklist items: tick them off, change their words in place, and from an item's ⋯ menu add a
  sub-item, give it to someone on the task's team (their face shows on the item, and they are told),
  set a due date ("3 Nov"), duplicate it, indent or outdent it, or move it up or down. With the
  keyboard, Enter starts the next item at the same level and Tab / Shift+Tab indent / outdent the item
  you are writing. A parent ticks itself when all its sub-items are done; ticking it by hand while
  sub-items are open says "2 sub-items still open" and changes nothing. A parent shows "1/3" even when
  collapsed, and what you collapse is remembered for you on that device.
- Nothing is lost by a misclick: deleting an item with sub-items, or a whole checklist, asks first, and
  every delete has Undo. Deleted items can be restored for 30 days with Restore in the task's history,
  which now says in plain words who added, ticked, renamed, assigned, dated, moved, duplicated, deleted
  or restored which item ("Khurram ticked “Label circuits”", "added 3 items to Electrical").
- My Tasks has "Checklist items for me": the open checklist items given to you on other tasks, with the
  task number, checklist, due date (late in red) and a tick box; click one to open its task at that
  item. The Calendar shows dated items on their day ("☐ Label circuits · MICO-142") — yours across all
  projects, and all of a project's on that project's calendar — and they open the task at the item too.
- The New task form, task templates and project templates use the same checklist editor, so a
  template keeps its checklists' titles and nesting, and a new task starts with them.
- Checklist items given to someone with a due date get the usual "due soon" and "overdue" reminders (to
  that person; an item given to no one reminds the task's people), at the same times as task reminders
  and never twice a day. Items of a finished task, or one waiting for approval, send none.

### Improvements
- Existing tasks keep their checklist, now titled "Checklist", with every item in its order; task cards
  still show "8/12". A repeating task's next copy brings its checklists back with the ticks cleared, each
  item's person kept and its due date moved on as far as the task's.
- Merging tasks moves each merged task's checklists whole, titled "From MICO-14 · Electrical"; Undo
  moves them back. Search finds a task by its checklists' titles as well as their items, and the task's
  PDF and spreadsheet list each checklist with its count ("Electrical · 5/8") and sub-items indented.
- The Android app and the Chrome extension keep working as they are: they see every checklist item in
  one list and can tick items without sub-items (ticking a parent there says which sub-items are open).
  Deleting an item with sub-items there deletes its sub-items too; it can be restored on the website
  for 30 days.
- Error log: a slow request says where the time went — the server, the database or the network (for
  example "server 9.9 s · in the database 9.7 s", or "server 0.1 s · the rest was the network"). Every
  answer from the server now carries its own time and its time in the database; the row shows the last
  time's, and each occurrence its own. Rows from before the update look as they did.

## [1.23.2] - 2026-11-06

### New features
- Merge tasks (1.23.2): combine two or more tasks into one without losing anything. On a task, ⋯ →
  "Merge with other tasks…" (or select 2 to 10 tasks in My Tasks and click "Merge…"). Find more tasks by
  title or number, choose the main task (the one that stays — the oldest unless you pick another), and
  where the tasks differ pick which value to keep: title, project, status, priority, start and due date,
  milestone, "Show to client", repeat (one, or none), inspection form, linked meeting, needs approval.
  Before merging you see what each task brings (comments, checklist, files, people, contacts, blockers,
  action items, inspections, history) and what appears twice and is kept once. Comments, files, the
  checklist ("From MICO-14" group), history, inspections, action items and notices move to the main task
  with their original authors and times; people, watchers, tags, contacts and blockers are combined;
  descriptions are joined under a heading per task. Only administrators and whoever manages every
  project involved can merge; someone not on the main task's project team is either added to the team or
  left off (your choice). The other tasks disappear from every list, board, calendar, report, export,
  daily email and search — but their numbers, links and old notices open the main task ("MICO-14 was
  merged into this task on 5 Nov by Khurram"), and anything added to one of them afterwards — a comment, a
  file, a checklist item, a contact, following it, from an old screen or the phone app — goes to the main
  task (changing or deleting a merged task itself is refused). The main task's "Merged from" panel lists them (each opens
  its read-only record) and Undo gives each one back as it was; anything added since stays on the main
  task. Reports and exports show "Merged from: MICO-14, MICO-15" on the main task's row.

### Improvements
- Task panel: Delete task sits at the right of the panel's bottom bar.
- After an update, an open page loads the new version by itself instead of showing an error. A page left
  open over an update used to fail with "Failed to fetch dynamically imported module" when you opened another
  screen; now it reloads once to the new version (the same address). An open page also notices a new version
  when you come back to it (and every 10 minutes) and opens the next screen from the new version — never
  while you are typing. If the page still can't load (no connection), it says "This page couldn't load —
  check your connection and try again" with a Reload button, and only then is it recorded in the Error log.
- Database check: when the database doesn't answer for a moment (as at a restart), the check tries again
  — up to 3 times, about 10 seconds apart — instead of reporting a problem. If it still can't connect it
  says "couldn't be checked — the database was busy" (in amber), never "the Management page fails".
  System Settings → Error log now has a **Check again** button beside the result (administrators only),
  and the result says when the database isn't in strict mode: "not in strict mode: text that's too long
  is cut short instead of refused". The check now also runs every kind of query the Management page can
  send (a person's late tasks, late milestones, overdue action items, one form's failures), one after
  another.
- A steady database connection pool: the server now keeps at most 10 connections to the database (and
  waits up to 20 seconds for a free one) unless the database address already sets its own limit. Before,
  the number grew with the hosting server's processors and could pass the host's connection limit — a
  likely cause of the short "Can't reach database server" moments on the live site. The database check
  line shows the pool size ("pool 10"); the database address itself is never shown or logged.

## [1.23.1] - 2026-11-05

### Improvements
- Database check: each time the server starts, it checks that the database has every table and column
  the app needs and that its searches and the Management page's figures run on this database server.
  System Settings → Error log shows the result at the top — "Database check: OK (MySQL 8.0.46)" with
  the database server's version and settings, or the list of problems with their exact names — and
  each problem is also recorded in the Error log (job "database check"). It never delays the start.
- Search: if the tasks can't be searched for a moment (a database problem), the top-bar search and the
  Search page still show the projects, people, meetings, notes and files they found, with one quiet line
  "Tasks couldn't be searched just now — try again". Before, the whole search failed. The problem is
  still recorded in the Error log, once.
- When the database is away for a moment (for example while the site restarts after an update), pages
  now say "The database is busy — please try again in a moment." instead of "Something went wrong".
  The Error log keeps one row for each kind of database outage, with its code, instead of one row per
  page.
- Background jobs (daily task emails, the weekly management summary, reminders, backups and the rest)
  now start only once the database answers, try once more after a few seconds when the database
  doesn't answer, and stop before the server does. A restart of the site no longer fills the Error log
  with "Can't reach database server".

### Bug fixes
- Search: searching for two or more words (for example "pump repair") failed on the live site, and the
  Error log showed "Unknown column". The site's database server reads one part of the task search's
  sorting differently from the one we test on; the search no longer uses it, so every search works on
  both.
- Error log: a database error now keeps the names of the columns, tables, keys and parts of the query
  it is about, as both kinds of database server word them ("Unknown column '0' in 'ORDER BY'" instead
  of "Unknown column '?' in '?'"), so the cause can be read. What people typed is still hidden, and so
  is the database server's address.

## [1.23.0] - 2026-11-05

### New features
- Client accounts: people outside the company (your clients) can now have their own sign-in. In User
  Management → New user, choose Role "Client": enter their name, username, email, organisation and
  phone, send the welcome email (or give a temporary password), and under Project access pick their
  projects. For each project tick what they may see — "Progress, milestones and tasks" and/or
  "Meetings and minutes" — and what they may do: comment on tasks, sign off finished tasks, reply to
  meeting invitations (and mark their own action items done), and download PDFs. Everything is off
  until ticked. Clients are listed in User Management with a "Client" badge and a role filter, and
  Manage account on a client changes their details and project access.
- Admin → Clients: a page with every client account — their organisation, projects and last sign-in —
  to add a client, change what they can see, send the welcome email again, unlock, deactivate,
  reactivate or delete.
- The Client portal: a client signs in like everyone else (password, emailed code or the welcome
  email's link) and lands on their own portal. They see only their projects, each with its company's
  logo and its progress; inside a project only the parts they were given. Progress shows the
  milestones and the tasks marked "Show to client" (number, status, due date). Where allowed they can
  comment on a task, Accept a finished task or Send it back with a reason, answer meeting invitations,
  mark their own action items done, read approved minutes shown to them, and download the task list
  and the minutes as PDFs. Clients never see any other page of the site. It works on phones.
- The team's side: a client's comment shows their name with a "Client" badge. When you reply to it you
  can tick "Visible to client" — only then does the client see the reply (and get it by email). A task
  the client accepted shows "Client accepted · 30 Oct 2026"; a task sent back returns to In progress
  with the client's reason as a comment, and its assignees and managers are told. The project's Team
  tab lists the "Clients with access" and what each may do (only administrators change it). Clients who
  have a project's Meetings module can be invited to its meetings; they are marked "Client".
- Search everything: the Search results page now finds everything you can open — tasks, projects,
  meetings, meeting notes, final minutes, files and inspections — not only tasks. Each result shows
  what it is, its title with your words marked, the place it matched (a comment, an agenda item, a
  decision, a line inside a file…), its project with its picture, its state, its date and who it
  belongs to, and opens straight at its place: a note or the minutes open the meeting at that note or
  the minutes, a file opens its task with the file marked, and a project, meeting or inspection is a
  link you can also open in a new tab.
- Search reads inside files: the text of PDF, Word, Excel, PowerPoint, CSV and text files attached
  to tasks is searched too. New files are read a moment after they are uploaded (the upload never
  waits); older files are read once in the background. Scanned PDFs and photos are read by AI (the OCR
  model in AI Management) when AI is set up.
- Spelling mistakes are forgiven: when few results hold every word, search also finds the words you
  probably meant (one letter off for short words, two for long ones — "genarator" finds "generator")
  and then results holding some of your words; both are marked ("Close match", "Some of the words"),
  and the page says which spelling it used.
- Filters on the Search results page: by kind (each with its count), project, task status, assignee
  or organizer, "Only mine", a date range (from and to), open or done, and archived projects. They
  stay in the address, so a search can be shared. The company picker in the top bar narrows it too.
- AI search: when AI is set up, press Enter on the Search results page (or choose "See all results
  and ask AI" in the top bar) and an AI panel above the results answers your question in a sentence
  or two — "overdue electrical tasks for the Rig project this week" — with the best matches as links.
  The normal results show at once and never wait for it. It answers only from what you can open, uses
  one of your AI requests, and says so in one line when AI is off, you've reached your AI limit, it
  takes longer than 20 seconds, or it fails. With an embedding model set up in AI Management it also
  finds items by meaning, not only by their words.
- The top-bar search also shows the best notes, minutes, files and inspections it finds, and always
  offers "See all results".
- Meeting series: related meetings can be linked into a named series (for example "Monthly site
  review", made by hand each month). On a meeting: ⋯ → "Add to a series…" picks one of the project's
  series or makes a new one (named after the meeting); "Remove from series…" takes it out. The
  meeting's organizer, the project's owner and managers, and administrators can do this.
- Each meeting of a series says so under its title — "Series: Monthly site review · 3 of 5 · ‹ Previous
  (3 Nov) · Next (3 Dec) ›" — and lists the series' meetings (earlier ones, this one marked, those to
  come, with "Minutes final"). Only meetings the person may open are counted and shown: someone who
  can open just one meeting sees the series' name and nothing of the others.
- "Open from earlier meetings": each meeting of a series shows the action items still open from the
  series' earlier meetings, with the meeting each came from, its owner, due date and status — the same
  items, so changing one's status there changes it everywhere. Someone invited from another company
  sees only their own. The minutes PDF has the section too, and names the series; the AI's Final MOM
  draft is given these items to follow up.
- The Series page (open it from a meeting, or from the Series chip on a Meetings card): every meeting
  of the series you may open, coming up and earlier, its open action items, "New meeting in this
  series" (the form starts from the latest meeting — title, project, people, place, online link,
  length and agenda — and you pick the day; a link Microsoft Teams made isn't copied: "Create a
  Teams link" is ticked instead, so the new meeting gets its own), "Add existing meetings", remove a
  meeting, rename the series, "Merge another series into this one" and delete the series (its meetings
  stay).
- Meetings page: cards of meetings in a series show a Series chip (it opens the Series page), and the
  Filters panel has a Series filter.
- Repeating meetings are a series automatically: every existing repeating meeting has a series named
  after its first meeting, and a new one gets its own. A repeating meeting that was split earlier (a new
  schedule part-way) is two series; merge them on the Series page. Adding a repeating meeting to
  another series brings all its meetings; moving meetings to another project takes them out of their
  series (the form says so before saving).
- Automatic Teams links: a meeting can get its Microsoft Teams link by itself. Connect your own
  Microsoft account once in Settings → Microsoft Teams (Microsoft's own sign-in page; Settings then
  says "Connected as …", with Disconnect). The meeting form then has a "Create a Teams link" tick under
  Online link: when the meeting is saved, your Microsoft account makes the Teams meeting and its join
  link goes into the meeting's Online link, the invitation email and the calendar file. A repeating
  meeting gets one Teams link for all its meetings. A new time or title updates the Teams meeting, and
  cancelling or deleting the meeting deletes it. If Microsoft can't be reached, the meeting is saved
  anyway with "The Teams link couldn't be made — try again" and a Make Teams link button (also on the
  meeting's page). Not connected: the form shows "Connect Microsoft Teams in Settings"; pasting a link
  works as before. The meeting's page says "Join on Teams". It appears once your Microsoft 365
  administrator has registered the app — the one-time steps are in docs/microsoft-teams-setup.md;
  until then nothing changes.
- Table view for tasks: a project's Tasks tab (List | Table), My Tasks (Grid | List | Table), the
  Kanban Board page — one project or All projects — and a project's Board tab (Board | Table) can show
  their tasks as a clear table: number, title, project (where tasks come from several), people,
  priority, due date and status, with start date, progress and tags under "Columns". Click a column's
  name to sort by it (again for the other way round, a third time for the page's usual order). Change
  a title, the people, priority, due date or status right in the table — it shows at once, and if the
  change can't be saved it goes back with "Couldn't save — …" and the reason. A status is one of the
  task's own project's columns; a task that needs approval goes to wait, as on the board. The arrow at
  the end of a row opens the task. Archived and completed projects' tables are there to look at. My
  Tasks' table uses the page's own filters, Sort menu (a column click sets it) and saved views, which
  now keep the table's columns too, and keeps the selection boxes; the Tasks tab uses its own chips and
  "Find a task"; the Board's table has its own filter bar (words or a task number, status, assignee —
  Me, Unassigned — priority, due date, and a count such as "12 of 40"). Each page remembers, for each
  person on this device, which view they chose and the table's sort, filters and columns. A hundred
  rows are shown at a time ("Show 100 more"). On a phone the table scrolls sideways under its title
  column; the page itself never does.
- Table view for meetings: once a meeting has an agenda topic or an action item, "List | Table" at the
  top of its Agenda shows the agenda and the action items as one table — each topic as a row (who
  presents it, its planned minutes, covered or not; its arrow folds it) with its action items under it
  (owner, priority, due date, status and the linked task's number), then "Other" for items with no
  topic. Sorting orders the items inside each topic. Whoever may change the agenda changes topics in
  place; whoever may change action items changes them in place, including which topic an item is
  under. Its own filter bar finds items by words or a task number, owner, status ("Open only") and
  priority. Someone invited from another company sees only their own items, as in the list. In a
  meeting series the items still open from earlier meetings are the table's last group, "Open from
  earlier meetings", each with the day of its meeting ("from 3 Nov").
- Action items under topics: the "add an action item" form has a Topic choice (none at first), each
  item in the list names its topic, and an action note made into a task puts its action item under the
  note's topic. Older items made from a note are shown under that note's topic.
- Compact rows: for people who live in lists and tables, Settings → Appearance now has Row spacing —
  Comfortable (today's look, everyone's to start with) or Compact — and the tables and lists have a
  small "Compact rows" button beside their view choice (the Board page and a project's Board and Tasks
  tabs, a meeting's agenda, My Tasks and the Notifications page). Compact fits more on screen: tighter
  rows and cards, text a step smaller (never below 12 px), smaller faces, the cards closer together —
  in every task and meeting table, My Tasks' grid and list, a project's task list, the Kanban cards, a
  meeting's agenda, action items and notes, the bell and the Notifications page, the Activity page, My
  Action Items, the approvals lists and User Management. Page headers, forms and dialogs stay as they
  are. The choice is saved to your account, so it follows you to every computer, and this computer
  remembers it so a page never loads comfortable first. Phones and touch screens always keep the
  comfortable spacing and their finger-sized buttons; Settings says so there.

### Improvements
- Show to client: a new tick "Also show its description" — the Client portal shows a task's
  description only when it is ticked. A task moved to another project is no longer shown to clients.
- Task history says "(client)" after a client's name, and words a client's sign-off and send-back.
  Notifications have a new "Client sign-off" switch.
- Repeating meetings: when changing, cancelling or deleting one, the choice is now "This meeting" or
  "All upcoming repeats of this meeting", so it isn't mixed up with the new named series.
- Error log: AI answers count as slow only after a minute. Describe the task or meeting, Draft agenda,
  Write description, the Final MOM's Draft with AI, MICO AI, the AI panel of the Search results page and
  AI Management's Test are now in the Error log's "Slow" list only when they take over 60 seconds (an
  AI answer can legitimately take a while); everything else still counts as slow after 10 seconds. An AI
  request that fails is still logged as an error.

### Security
- Client accounts can use only the Client portal: the server refuses every other page and request to
  them, and refuses the portal to staff. Every portal request is checked, in order, for an active
  client account, access to that project, the part of the project, the action, and that the item is
  shown to clients (or the client was invited) — anything else is refused without showing any of it.
  Clients are never in a company or a project team, never offered in people lists, @mentions, chats,
  Workload, Reports or search, and get no notifications, reminders or daily and weekly emails.
- Clients receive only these emails: the welcome email, meeting invitations (while they may see that
  project's meetings), the client copy of approved minutes shown to them, and replies marked "Visible
  to client". They are never sent the team's minutes. Every client change and every client action is
  in the audit log.
- Search shows only what each person may open, by the same rules as everywhere else: their projects
  (with their companies, the picked company and "Show my projects only"), the meetings their meetings
  list shows, only a meeting itself and its final minutes to someone invited from another company
  (never its notes, decisions or action items), and draft minutes only to those who may change the
  meeting. An inspection never shows a task you can't open. Counts never include anything else, and
  the AI is given nothing else. Client pages can't use search.
- Reading the text inside files runs apart from the rest of the server, with a time and memory limit
  and a cap on how far a Word, Excel or PowerPoint file may unpack, so a large or harmful file can't
  slow the site down or stop it.
- Teams links: each person's Microsoft connection is made with Microsoft's sign-in (authorization
  code with PKCE and a single-use, short-lived check that it is the same person in the same browser),
  kept locked on the server (AES-256-GCM with its own key), never sent to the browser or written to a
  log, checked against the allowed Microsoft tenant each time, and deleted on Disconnect or when the
  account is deactivated. Only the organizer's own account is ever used; client accounts can't use
  it. Connecting and disconnecting are in the audit log.
- A harmful PDF can no longer stop the server: files are read for search in a separate process of
  their own, so a file that runs it out of memory stops only that reader, and the PDF reader now keeps
  within a small, fixed amount of memory however a file is packed.
- Opening the preview of a Word, Excel or PowerPoint file (or reading one for search) can no longer
  hold up the server, however oddly the file is written: a small file made to do that once froze the
  site for over an hour.
- Teams links in a repeating meeting with more than one organizer: when one of its meetings is handed
  to someone else, making or removing the Teams link there changes only the meetings that person
  organizes — their Microsoft account never hosts, or takes away, the link of the others' meetings.
- Search can't slow the site down for everyone: checking for spelling mistakes now stops after a
  fraction of a second, the search in the top bar no longer does it at all (it shows only results that
  hold every word, and reads at most the first 200 characters typed), and each person can search up to
  120 times a minute on each search.
- Connecting Microsoft Teams: the browser's check for the connection is a cookie only this site can
  set (another site on the same domain can't slip one in), and each person has one connection waiting
  at a time, so pressing Connect over and over never stops anyone else's.
- A client account can't be made a meeting's organizer, not even by an administrator (the calendar
  invitation would have named the client, and everyone's calendar replies would have gone to them).
- Reading scanned files with AI sends at most 8 MB of pictures at a time, each page picture once, so a
  scanned PDF can't run up the AI provider's bill.
- The AI answer in search is told that what people wrote in tasks, comments and files (clients'
  comments too) is only text to search, never instructions, so a planted message can't steer it.

### Bug fixes
- A meeting's online link can be as long as 2048 characters — a long link, such as a Microsoft Teams
  link pasted by hand, used to be refused as "too long".

## [1.22.5] - 2026-11-05

### Improvements
- Error log: a server error from the database now says what the database said — its error code
  and its message (the names of tables and columns stay; any value someone typed shows as ?) — on
  the row's details as "Database said: …", so the cause of an error such as "Invalid
  `prisma.$queryRaw()` invocation" can be found. Two different database errors at the same place
  in the code are now two rows.

### Bug fixes
- Error log: a stack's lines inside a library whose folder is named "client" (such as the
  database library's node_modules/@prisma/client/…) showed as ":token"; they now keep their
  file and line. The site's own private links (/client/…, /reset/…) are still hidden.
- Search: the top-bar search now reads at most the first 200 characters of what was typed or
  pasted (the rest is left out, as the full task search already did), instead of searching for
  any length of text.

## [1.22.4] - 2026-11-05

### New features
- System Settings → Error log (administrators only; also in the Admin menu): when something goes
  wrong in someone's browser, the site now tells the server — an error in the page, a request or
  the live connection that was blocked on the way (a firewall, a proxy or an antivirus), one of the
  site's own files or scripts that was blocked, and slow pages (a page taking over 8 seconds to
  load, slow to show, slow to answer a click, jumping around, or a request taking over 10 seconds).
  Errors on the server are there too: failed requests and background jobs (nightly backup, daily
  emails, meeting reminders, AI model refresh, search index, recurring copies and the others). The
  same error is one row with how many times and to how many people it happened, when it was first
  and last seen, the page and the version; filters for Errors, Blocked, Slow and Server, Today /
  7 days / 30 days and a search box; "New" marks what appeared since your last visit. Opening a row
  shows where in the site's own code it happened (file and line), the latest occurrences (when, who,
  page, browser, version, window size) and "Mark as fixed", which hides it until it happens again in
  a newer version ("Marked fixed" lists those, with "Not fixed"). Kept 30 days. Never sent: what
  anyone typed, form contents, passwords, sign-in or share links, cookies or stored data — a
  private link shows only as its pattern, such as /client/:token. A "Collect browser errors" switch
  on the same card turns the browser part off for everyone.

### Security
- The site's security policy is as strict as before — it now only also lets the task panel show
  the site's own PDF previews — and browsers now also report to the server (the Error log) what it
  blocks. The website's source maps, made for the Error log, stay on the server and are never
  served to browsers.

### Bug fixes
- Task panel: a PDF's Preview shows the PDF again. The site's security policy had been refusing
  the preview, so the box stayed empty.

## [1.22.3] - 2026-11-05

### Improvements
- User Management → Manage account: an administrator's account has a "Show my projects only" switch.
  An administrator can turn it on or off for any administrator — their lists then show only the
  projects they own, manage or are on the team of, from their next page. It is the same setting as
  Settings → "Show my projects only", so on your own account both always agree. Only administrators
  have it; someone taken off the Administrator role has it turned off. Each change is in the audit log.
- Project page: a new "Board" tab, after Overview, shows the project's Kanban board right on its
  page — drag cards between columns, add a task to a column, open a task (Previous / Next follow the
  columns), see who is on the board, manage its columns, with live updates and the N shortcut, just
  like the Kanban Board page. A link can open it directly (…?tab=board). On a phone the columns
  scroll sideways. The Kanban Board page and its "Open board" links work as before. An archived or
  completed project's board — on its page, or chosen on the Kanban Board page — is there to look at:
  it says "This project is archived — reopen it first." (or completed), and offers no New task,
  column "+", Manage columns or dragging; its cards still open.
- Search finds a task by its number however it is typed: MICO-142, mico-142, MICO142, mico 142,
  MICO_142 or #MICO-142 all find MICO-142 first, and so does a number the task had before it moved
  project. Just "142" lists the tasks numbered 142 in any project first. The same works in the top bar
  ("open mico 142" is offered once the search finds that task), the Calendar's "Search tasks", a
  project's Tasks tab, the blocker picker and MICO AI. The top bar's complete, assign and move still
  take the number with its hyphen ("complete MICO-142"), so a search such as "close door 3" or
  "open phase 2" stays a normal search.
- Task numbers look the same everywhere: every place a task is listed shows its number (for example
  MICO-142) as the same small grey label before its title — the board and the All projects board, My
  Tasks (cards and list, also on a phone), the task panel, the dashboard and Activity, approvals,
  timeline, workload, the Management page, search, inspections and MICO AI. A long number such as
  MICO360-10 now always stays on one line (on a project's Tasks tab it used to break in two); the
  title gives way instead.
- Task numbers where they were missing: the calendar's task chips (in the month grid on a wide
  screen; on a narrower one the number is in the chip's tooltip, so the title has the room), a
  project's Milestones card, the Management page's next milestone and its PDF, the timeline's
  milestone markers (for screen readers), scheduled inspections, My Action Items (the number opens
  the task), meeting notes and action items (the task's number instead of the word "Task"), the
  Audit page (a task's entries show its number and title instead of a code) and the client page
  (each shared task and milestone; it still names no one).
- Notifications: overdue and due-soon notices now say which task, "MICO-142 · Title", like every
  other task notice. The bell and the Notifications page show the task's number as the label — its
  number today, also for older notices and for a task that has moved project since (only to people
  who can open the task in its project now; the same for meeting notes and action items).
- New task: after you create a task with the form, a short notice says "Task MICO-143 created" with
  Open, which opens it. A task created while offline says "Task MICO-143 saved" once it reaches the
  server.

## [1.22.2] - 2026-11-04

### Improvements
- Minutes of Meeting PDF: the notes no longer show who wrote each one and when; a key point is still
  marked "Key point".

## [1.22.1] - 2026-11-04

### Improvements
- Projects: the "Only my projects" tick is now the same saved setting as Settings → "Show my projects
  only". Ticking or unticking it is kept for you on every device and every visit, and every page
  follows it.
- Minutes of Meeting PDF: smaller, tidier and shorter — a monthly meeting now fits on two pages
  instead of three. A one-line header, smaller text, the project's details beside the meeting's, a
  short "Microsoft Teams — join link" instead of the long address, slim summary cards, and each
  note's author and time on its last line. The client page's copy has the same look.

### Bug fixes
- Meeting notes: the meeting's organizer and administrators can change a note someone else wrote.
  Saving it no longer fails with "You don't have permission to do that"; the note keeps its author
  and shows "edited by …" with the name of whoever changed it.

## [1.22.0] - 2026-11-04

### New features
- Minutes email: one email with real To and Cc lines — add colleagues or any email address to To or
  Cc; someone invited from another company still gets their own copy.
- Every send of the minutes is kept under "Sent" on the meeting's minutes: when, who sent it, draft or
  final, To and Cc with each address's result, and "Send again".
- Activity: a calendar view beside the list. Each day of the month or the week shows how many
  changes it had, shaded from quiet to busy; click a day to see its changes under the calendar. The
  filters and the company picker apply to both views, and your choice of List or Calendar is kept.
- Kanban Board: the faces of the people who can open a project's board — its owner, manager and
  team — sit at the top of the board. Click them for the full list with each person's role; whoever
  runs the project can go from there to its Team tab.
- Previous and Next: an open task steps through the list it was opened from — a board (column by
  column), My Tasks (as sorted and filtered), the Search results or a calendar day — with "3 of 18"
  in its header, and J and K on the keyboard. A project's page steps to the previous or next
  project in the Projects page's order. Back goes back, and something typed but not saved is asked
  about first.
- Settings → "Show my projects only" (administrators): when on, every list on the site shows you only
  the projects you own, manage or are on the team of — Projects, the boards, the dashboard, My Tasks,
  the calendar, timeline, workload, meetings, reports, Management, activity, the bell, search, Chat,
  MICO AI and the project pickers. Your own work always shows, whatever the project: tasks assigned to
  you (My Tasks, the calendar and MICO AI), your notifications (the bell, the Notifications page and
  its counts, and Mark all read) and your action items (My Action Items and MICO AI); only other
  people's work narrows. It is saved for every device and session; you can still open any project by its link,
  and untick "Only my projects" on the Projects page to see every project for that visit.
- Notifications page: All and Unread tabs ("Unread (12)") and type chips — Mentions, Assigned to me, Due & overdue, Comments, Approvals, Meetings — remembered in this browser, with an empty message for each.
- Notifications page: notifications grouped by day (Today, Yesterday, "Mon 2 Nov"), each with an icon for its kind, its project's name and picture, and its time.
- Notifications page: Mark read, Mark unread and Remove on each notification (Remove can be undone for 5 seconds), or on several at once with tick boxes and "Select all shown".
- Notifications page: older notifications load 50 at a time as you scroll ("Show older"), past the newest 100; and a "Notification settings" link.
- The daily email, rebuilt: one email each morning instead of two (pending tasks; completed yesterday).
  In order: the day's numbers; Today's schedule (your meetings and tasks due at a time, by time);
  Overdue & urgent (days overdue, most first); your other tasks by project, most urgent first; "In your
  projects" for people who run a project (its overdue tasks and those waiting for approval); and
  Recently completed (since your last email).
- Each task in the daily email shows its ID, project and client, status, priority, start and due date
  (and time), checklist ("3 of 5"), a short description, its latest update, and "Waiting for approval"
  or "Blocked" — only what it has. Times are in your own time zone, and every task, project and meeting
  links to its page, with a button to the dashboard.
- Settings → Daily email: turn each part on or off, choose the time, and "Send me a test" to get your
  real email now. Your earlier choices carry over: with both old emails off, no email comes.
- Final MOM: "Draft with AI" keeps going when you leave the page. The AI's draft is saved as the draft
  when it is ready; if someone changed the minutes meanwhile, their text is kept and the AI draft is
  offered beside it — Use it, Compare or Discard. You are told by the bell and a phone push when it
  is ready, or if it couldn't be drafted.
- MICO AI: an answer keeps being written when you leave the page and is waiting in the chat when you
  come back; you are told by the bell and a phone push when it is ready, or if it failed.
- AI work tries again by itself when the AI service is busy or doesn't answer (after 30 seconds, 2
  minutes and 5 minutes), carries on after a server restart, and is never done twice — a second click,
  or a question sent again, joins the one already running. Stop in MICO AI stops it.

### Improvements
- Schedule a meeting: a wider dialog with two columns on a desktop, and Starts/Ends picked as the site
  writes them ("Wed 4 Nov 2026 · 13:00", 24-hour) from a calendar and a time list.
- Meeting page: one-line action items with chips to change them, compact People rows (with "Add email"
  for a guest), next steps for a finished meeting (Notes → Final MOM → Approved → Emailed), and empty
  sections shrunk to one line.
- An archived project is now read-only on the server too, not only on the website: new tasks, task
  changes, moves and status changes, comments, files, checklists, its board's columns, its meetings
  and moving a task into or out of it are refused with "This project is archived — reopen it first."
  Reading, exporting, reopening it, changing its team or companies, and deleting stay as they were.
  The nightly carry-forward and repeating meetings skip archived projects, as repeating tasks already did.
- Wider windows, one size for each kind: questions and short prompts stay narrow; normal forms are
  720px; the big forms — New user and Manage account, New and Edit task, New and Edit project, a
  company, Schedule a meeting — are 960px with two columns on a desktop, one column on a tablet, and
  fill the screen on a phone.
- A person's companies (New user, Manage account): one company per line with its logo and its whole
  name, the ticked ones first, and a search box when there are more than 6. "Add to a company…" and
  the company menus show whole names too.
- Touch screens: every form field, Search's All / Open / Done, the task keys on Activity and the
  dashboard, and many smaller buttons are now 44px tall to a finger.
- Meeting page: a new action item's priority and due date, and a new attendee's role, use the site's
  own pickers, like the owner beside them.
- My Action Items no longer squeezes an item's words to one word a line on a 1024px screen, and a
  popover such as the board's people list fits on a phone's screen.
- The daily email is laid out to read well in Outlook and Gmail, on phones and in dark mode, and stays
  under Gmail's size limit — a long list ends "and 12 more · open the dashboard".
- System Settings → Daily email: one email per person; days before the change still show the
  "Completed yesterday" email they had.

### Bug fixes
- On a phone, the company picker's list ran off the right edge of the screen and cut company names
  there; it now stays on the screen (on a tablet too).

## [1.21.0] - 2026-11-04

### New features
- Companies: one site can now hold several companies. Everyone and every project you have today are
  in "Prolens Projects LLC", so nothing changes until a second company is added.
- People see only the projects of their own companies, and only colleagues who share a company with
  them; administrators see everything. Inside a project shared by several companies, its whole team
  works together, and someone invited to a meeting from another company sees only that meeting, its
  final minutes and their own action items. An archived company gives no access: someone whose
  companies are all archived sees nothing, not even meetings they were invited to.
- Each company has its own name, logo, email sender name, week start and working hours; its PDFs,
  emails and client page carry its name and logo.
- Company picker: people in two or more companies can show "All my companies" or just one; every
  page, count, export, search and MICO AI answer follows it, and the choice is kept on this device.
- Companies page (Admin): add companies with their own name, short code, logo, week start, working
  hours and email sender name; see each company's people and projects; archive a company.
- User Management: each person's companies and primary company, a company filter, and adding or
  removing several people at once.
- A project can belong to several companies, one of them its main company; its team can take people
  from any of them. A meeting without a project belongs to a company.
- A direct chat with someone you no longer share a company with stays readable but can't get new
  messages.

## [1.20.0] - 2026-11-03

### New features
- The Android app catches up with the website: the website's look (colours, fonts, drawn icons, a
  white top bar, a grouped menu and five tabs) and everything added since 1.11 — task approvals,
  moving tasks between projects, the website's Dashboard and Projects pages, Timeline, Workload,
  Management, MICO AI, inspections that work offline, templates and client sharing.
- In the Android app, the task screen lists comments before files and dependencies on a phone, as
  the website does, and shows "Formerly RIG-4", "Inspection" and "Visible to client" by the task's
  number.
- In the Android app, a task waiting for approval opens on its Approval section: a project manager
  can Approve it or Send it back with a reason; others see whose approval it waits for. "Needs
  approval" can be turned on there by anyone and off only by the project's managers.
- In the Android app, My Tasks starts with "To approve" for project managers: approve or send back
  the tasks others have finished.
- In the Android app, New task and Edit task have the "Needs approval" tick, already ticked in
  projects that ask for it; only the project's managers can untick it.
- In the Android app, New task can start from a task template, takes a checklist, and says when the
  project will give the new task today's date.
- In the Android app, a task can be moved to another project — from the task's menu, a card's
  actions on the boards, or several at once in My Tasks — with the website's preview and one
  question about people not on the new team; the task's old number still finds it.
- In the Android app, board cards show "Visible to client" and "Inspection", and on a phone an empty
  column is only as tall as its "No tasks".
- In the Android app, the Dashboard is the website's: the welcome band, the four tiles (your own, or
  the company's for administrators), tasks waiting for your approval, Due soon, Recent activity, and
  first steps for a new company.
- In the Android app, Projects is the website's page: status tabs with counts, search, owner, sort
  and "Only my projects" for administrators, the website's project cards (Open, Overdue, Next due,
  team, owner, target), a status menu and Archive.
- In the Android app, the project form has the website's Tasks switches — carry unfinished tasks
  forward, new tasks due today, new tasks need approval — and a new project's team can be picked
  when creating it.
- In the Android app, Meetings shows the website's summary — Next 7 days, Open action items, Minutes
  to finish, Held this month; tap one to filter — "Nothing coming up" with the last meeting,
  people's faces on the cards and a compact header.
- In the Android app, a finished meeting shows its Final MOM and action items first, and says "No
  notes were taken." when none were.
- In the Android app, Settings has the Approvals and "Added to a project" notification switches, the
  weekly management summary switch for the people who get it, and says when your week follows the
  company's; Reports shows "—" for on time until a task with a due date is finished.
- In the Android app, User Management shows each person's last sign-in, finds those who never signed
  in, sorts by last sign-in, and sends welcome emails — to one person, the ticked ones, or everyone
  who never signed in; a new account's temporary password is optional when a welcome email goes.
- In the Android app, Timeline shows every open project's health, progress, next milestone and
  target, with Late and At risk filters and each project's tasks — as on the website's phone layout.
- In the Android app, Workload shows each person's open tasks due each day of the week against the
  daily limit, with overdue tasks and days off; its suggestions give a task to a teammate or move it
  to a lighter day in one tap, and administrators can change the daily limit.
- In the Android app, Management is a real screen for administrators and the people who run a
  project: the website's figures for every project, with the list behind each number, its filters,
  and the same PDF.
- In the Android app, Management shows each project's health with the reasons, the tasks waiting for
  approval, inspections and people, each number opening its list.
- In the Android app, Management shows the trends of the last 4, 12 or 26 weeks: tasks created and
  completed, late tasks and the inspection pass rate.
- In the Android app, the calendar marks a task waiting for approval with an hourglass, as on the
  website.
- In the Android app, MICO AI is a real screen: your chats (new, rename, search, delete), questions
  and answers with tables and sources, Excel and PDF downloads, Stop, and quick replies when it asks
  which one you mean.
- In the Android app, changes MICO AI suggests (new tasks, task changes, final-minutes drafts,
  meetings) show as a card to tick, Confirm or Cancel, and Undo for 15 minutes; nothing changes
  until you confirm.
- In the Android app, you can change what MICO AI suggests before confirming it — the title,
  project, dates, people, status, priority or the minutes' text.
- In the Android app, Search offers "Ask MICO AI" with what you typed, opening a new chat with that
  question.
- In the Android app, signing out warns about inspection changes not sent yet, and someone else
  signing in on the same phone never sees or sends them.
- In the Android app, inspections open on the phone and are answered there: Pass, Fail or N/A with a
  note, and readings with their unit and limits (a reading outside its limits fails). Every answer
  is kept on the phone and sent when there is signal; an inspection opened once opens again with no
  signal.
- In the Android app, the inspector — and the client or supervisor when the form asks — signs with a
  finger or types their name. Signing with no signal is kept on the phone and finishes the
  inspection when the signal is back; finishing offers to mark its task done.
- In the Android app, each failed item of an inspection can become a follow-up task — one, or all at
  once, for the owner, a team member or nobody yet — even without signal (made once the phone is
  back online).
- In the Android app, a project has an Inspections tab — due checks (late, today, upcoming),
  inspections in progress and finished reports — kept on the phone so it opens with no signal.
  Starting an inspection needs a connection (tap Start before you leave the office); after that it
  works without one.
- In the Android app, a finished inspection's report downloads as a PDF and can be shown to the
  client (after seeing exactly what the client will see); an inspection can be reopened, taken over
  or deleted, as on the website.
- In the Android app, a project's inspection schedules are listed with their repeat, next due and
  last done; people who can schedule may Schedule an inspection, edit a schedule or stop it.
- In the Android app, a new project can start from a project template: pick its start day and who
  fills each role, and see the tasks it will create.
- In the Android app, the people who run a project can save it, or one of its tasks, as a template;
  templates are edited on the website.
- In the Android app, the people who run a project can share it with a client (add, see when they
  last looked, Resend — which emails a new link, stops the old one and signs its devices out — and
  Remove); an archived project's sharing is read-only.
- In the Android app, the people who run a project can show a task to its client (title, status and
  due date only); such tasks carry an eye mark on cards and in the project's task list.
- In the Android app, approved minutes of a project meeting can be shown to the client — after a
  preview of exactly what the client will see, with risks and open issues left out unless ticked.
- In the Android app, a task can carry an inspection form (and a place): it shows an Inspection mark
  on cards and rows, and its screen offers Start inspection, Continue inspection or View report.
- External contacts on tasks: record the people outside the company who are responsible for a task —
  name, company, designation, email, phone and remarks — kept apart from the people it is assigned
  to. A task can have up to 20. They show in the task's details on the website, the Android app and
  the extension (tap to email or call), and anyone who can edit the task can add, change or remove
  them. Typing a name suggests contacts used before on the project's tasks; picking one copies their
  details.
- New task and Edit task have an External contacts field, on the website and in the Android app.
- Cards and task lists say who is responsible outside the company ("External: Ahmed Al Said (Acme)
  and 2 more"); My Tasks and the board can be filtered by external company, and search finds a task
  by a contact's name or company.
- The task's PDF and Excel export list its external contacts with all their details, its history
  says who added, changed or removed one, and a repeating task's next copy keeps them. They are never
  emailed and never shown on the client page.
- On the website, search finds a task by everything it holds: its title, number (an old one too),
  description, comments and replies, checklist items, the people it is assigned to, its external
  contacts, tags and file names. Part of a word is enough ("scaff" finds "scaffold"), capitals and
  Arabic letter forms don't matter, a task must hold every word typed, and "a phrase in quotes" is
  found as written. Only tasks you can open are found, open ones first.
- The top-bar search (Ctrl+K) shows the best five tasks with the words highlighted and where they
  were found ("Comment by Bilal · 28 Oct 2026: …the scaffold permit…"). "See all results" opens the
  new Search results page: every matching task, page by page, with filters for project, status,
  assignee and done or open, and "Include archived projects".
- Automatic meeting reminders: 24 hours, 12 hours and 15 minutes before each scheduled meeting. The
  organizer and everyone invited who hasn't declined get them on the website's bell (with a pop-up
  while the site is open), as a phone notification in the Android app (also when the app is closed;
  a tap opens the meeting) and as a Chrome extension desktop alert. The 24-hour one also comes by
  email, and outside guests get only the emailed ones — or, when they're invited (or the meeting is
  booked or moved) too late for those, the next reminder by email instead.
- Administrators choose the reminder times in System Settings → Meeting reminders: switch them off
  for everyone, or set up to five times from 5 minutes to 7 days before, each with "also by email".
- Meeting reminders say the time in the meeting's time zone ("Meeting in 15 minutes: Core switch
  go-live review · 09:00–10:00 · Head office – Meeting room 2 · Join online"), with your own time added
  when your time zone differs. Each one is sent once; a moved meeting is reminded at its new time,
  and cancelled or draft meetings, people who declined and people taken off a meeting get none.
  They replace the single reminder email an hour before.
- Settings → Notifications on the website, in the Android app and in the Chrome extension has a
  "Meeting reminders" switch, on until you turn it off.

### Improvements
- In the Android app, colours are the website's in light and dark mode, and grey and amber text is
  easier to read.
- In the Android app, text uses the website's fonts (IBM Plex Sans and Archivo), and figures line up
  in columns.
- In the Android app, buttons, badges, chips, fields and switches look like the website's.
- In the Android app, people and projects show the website's pictures and drawn project icons, and
  empty pages show an icon and what to do next.
- In the Android app, the top bar is white with the MICO360 logo, Search and a bell for
  notifications; the side menu is grouped like the website's (Workspace, Communication, Admin); the
  bottom tabs are Dashboard, My Tasks, Projects, Meetings and Chat, with drawn icons.
- In the Android app, the side menu offers Management to the people who run a project.
- In the Android app, the Dashboard, My Tasks, the boards and the calendar use the new look, with
  the waiting-for-approval mark and loading placeholders.
- In the Android app, the task screen and the task form use the new look.
- In the Android app, Projects, project pages, User Management and Reports use the new look, with
  progress bars in each project's colour.
- In the Android app, Meetings use the new look.
- In the Android app, Chat, Notifications, Activity, Search, Settings, Profile, About and the
  sign-in screens use the new look.
- Deleting a task: administrators and the people who run a project can delete a task only if they
  created it or it's assigned to them alone; otherwise Delete is greyed out with the reason — on
  the website, in the Android app and in the Chrome extension. Deleting the entire series of a
  repeating task is only for the person who created it.

### Bug fixes
- In the Android app, every date and time is written as on the website — "30 Oct 2026", "Fri 30
  Oct", "09:05" — whatever language the phone is set to.
- In the Android app, weeks start on the company's week start (set on the website) unless you chose
  your own.
- In the Android app, a task waiting for approval is never counted or shown as overdue — the same
  numbers as the website.
- In the Android app, moving a task that needs approval to Done says it is waiting for a project
  manager, instead of showing it done and jumping back; bulk Complete says the same.
- In the Android app, asking for another sign-in code too soon says so and when to ask again, and
  the code step is still there if Android closes the app while you read the email (with the address
  partly hidden, for a shared phone).
- In the Android app, anyone can create a project, and a project's owner, its managers and
  administrators can change it, its team, its columns and delete its tasks — as on the website.
- In the Android app, Timeline, Workload, Management, Templates and MICO AI found with Search open
  on the website (they used to do nothing), and Management is offered to the people who run a
  project, not only administrators.
- In the Android app, a link that opens the app on a task, a meeting, a chat or another page (from
  an email or the website) has the Dashboard behind it: Back goes there instead of closing the app.
- In the Android app, search, filters and sorted lists work the same whatever language the phone is
  set to: on a phone in Turkish, "site" finds "SITE WALK" again, names sort in English order and a
  role typed in capitals is the same role.
- In the Android app, Dashboard, My Tasks, Projects, Meetings, Notifications and Settings no longer
  start with an empty band under the top bar, and the side menu's logo sits at its top.
- In the Android app, the bottom tabs keep a little room under their names, so they no longer touch
  the phone's own buttons.
- In the Android app, TalkBack reads Management's owner choice once — "Owner: Anyone" instead of
  "Owner: Owner: Anyone".
- In the Android app, the "+N" after the faces on project, board and My Tasks cards is no longer cut
  off at the largest font size.
- In the Android app, with a larger font size, project names, task titles and other text that is cut
  after a few lines is shown in full instead of losing its "…".
- In the Android app, Workload opens each person's days on today (another week on its first day),
  and the row fades at the edge where more days are hidden.
- In the Android app, the signer's name under an optional signature (the client's or a supervisor's)
  no longer shows a required star.
- On the website too, the signer's name under an optional signature no longer shows a required star.
- On the website, search, filters and sorted lists work the same whatever language the browser is
  set to: in a Turkish browser, "item" finds "ITEM" again and names sort in English order.
- In the Android app, an inspection with changes still waiting on the phone (signed with no signal,
  say) doesn't offer Delete until they have been sent.
- In the Android app, the bell keeps its number of unread alerts with no signal, even after the app
  is restarted, and Notifications opens with no signal too.
- In the Android app, starting the app shows the white MICO360 logo on maroon until the first screen
  is ready — no white or blank screen first, in light or dark mode.
- In the Android app, "On this phone" on the Dashboard (and at the top of a project's Inspections
  tab) lists the inspections with changes still on the phone or not finished yet, each with Open —
  it works with no signal, even after the app is restarted; the task of an inspection you opened,
  and any task you looked at, opens with no signal too.
- In the Android app, the Chat tab's unread number is no longer cut off at the largest font size.
- The task panel's "Carried forward" chip says its days in words ("since 20 Oct 2026"), and so does
  its list of moves, instead of "2026-10-20".
- A finished meeting with no notes points up to the Final MOM, which is now shown above the notes.
- Editing a task that the server refuses now says why ("Only the project's managers can turn off
  approval for this task.") instead of always "You don't have permission to do that."
- MICO AI: when the open chat is deleted in another tab, its answer no longer keeps spinning; the
  box is free again and the next question starts a new chat.
- MICO AI: after "Load earlier messages", asking a new question no longer makes messages disappear
  from the middle of the chat.
- Showing minutes or an inspection report to the client: when the preview is opened again, the old
  copy can't be confirmed while the latest one loads ("Loading…").
- Inspections: a reading that can be below zero (a freezer, say) gets a phone keyboard with a minus
  sign.

## [1.19.0] - 2026-10-31

### New features
- Task approvals: tick "Needs approval" on a task (or switch on "New tasks in this project need
  approval" for a project) and it must be approved by whoever runs the project before it counts as
  done. When someone else finishes it, it waits in Review with a "Waiting for approval" badge. Only
  the project's managers (and administrators) can turn "Needs approval" off again; for everyone
  else the tick stays on, and says so.
- The project's manager (or an administrator) can Approve it — it is done then — or Send it back
  with a reason, which goes to the people on it as a comment. A manager finishing their own task is
  done at once.
- Managers see what waits for them in My Tasks ("To approve"), on the Dashboard, on the Management
  page, its PDF and the weekly management email, and in the morning email, and get a notice each
  time a task starts waiting.
- While a task waits for approval, the people on it get no overdue reminders or escalations, and
  their morning email lists it on its own "Waiting for approval" line instead of as overdue. Sent
  back, the reminders start again.
- The Calendar and the Timeline mark a task waiting for approval with an hourglass, as the board
  and lists do.
- A task waiting for approval is not late anywhere while it waits: My Tasks, the Dashboard, the
  Calendar, the Timeline, the board, the task panel, the project page, the Projects page, Workload,
  Reports, the Management page, its PDF and the weekly management email, and the client page leave
  it out of overdue and late figures and show the "Waiting for approval" badge where it would have
  been marked late. Sent back, it counts as late again.
- Client page: a task or milestone past its due date and not done says "Late" beside its status,
  and the top of the page says when it was updated ("Updated 30 Oct 2026, 10:15", company time).
- Client page: its "Privacy notice" link opens a short notice written for clients — what they can
  see, what is never shown, how the emailed code and the 30-day sign-in work, and what their email
  address is used for.
- Chrome extension: marking such a task done (My Tasks or the board) says it is waiting for
  approval and shows it where it waits, instead of as done. Board cards show the "Waiting for
  approval" badge, and the project's managers can Approve or Send back (with a reason) from My
  Tasks and the board.
- Nightly backups: every night at 02:00 the server saves a copy of everything — all the data and every
  uploaded file. It keeps the last 7 nights and one copy a week for the 4 weeks before; older copies
  are deleted by themselves.
- System Settings → Backups (administrators): when the last copy was made, how much room the kept
  copies take, a clear warning if one failed, "Back up now", and a Download button for each copy kept.
- The copies can also go to your own Google Drive, into a "MICO360 Tasks backups" folder, once Google
  Drive is connected in System Settings (a one-time setup).
- If a nightly copy fails (also when the server was stopped part-way through it), or can't reach Google
  Drive, the administrators get an email — and once if no new copy has been made for a day and a half.
- A size warning in System Settings (and one email) when the copies kept on the server take more than
  5 GB in all (BACKUP_WARN_GB), or the free disk space is less than about twice the newest copy, with
  what to do.

### Improvements
- Phones: the Projects page's six status tabs sit in one row that scrolls sideways (they took three
  rows before the first project); the task panel shows the checklist and comments before Client
  view, files and blockers; an empty Board column is only as tall as its "No tasks · Add a task";
  User Management shows one card per person, with every action, instead of a table to swipe.
- Dates read day before month everywhere — the Board, task cards and the task panel, My Tasks,
  meetings, chat, Activity, Audit Logs and Reports ("Fri 30 Oct 2026", "Overdue · 27 Oct 2026") —
  and times in 24 hours, as the minutes PDF and the daily emails write them. Meeting invitations,
  updates, reminders and minutes emails say "Monday 5 October 2026, 10:00 – 11:00 (GMT+4)".
- Dashboard: an employee sees four tiles like an administrator — My tasks, Projects, Overdue and
  Due this week (to the end of the company's week).
- A finished meeting shows its Final MOM and action items first, above the agenda and live notes.
- First steps: "Create a project" and "Add your team" open the New project and New user forms
  straight away.
- Share with client: the panel says what Resend does before you press it — it emails a new link and
  the old one stops working — and the email to the client says the new link replaces the one sent
  before.

### Bug fixes
- Dialogs in dark mode sat on a light-grey wash; every dialog and panel now dims the page behind it
  with the same dark shade in light and dark mode.
- Line charts with small numbers repeated their scale labels (0, 0, 1, 1, 1); they now count in
  whole steps (0, 1, 2, 3).
- The client page's email-code sign-in now stays on the code step after a reload, and asking for
  another code within a minute says none was sent and how long to wait, as staff sign-in does.
- Reports: a date typed into the range counts once it is finished, so the page no longer loads the
  dates it passes through or says "Still showing" a range nobody chose; an end date after today is
  refused with a message.
- September is written "Sep", never "Sept", in the daily and weekly emails, on the Management page
  and in its PDF, in meeting dates and cards, in the new-task and move notes, and in templates.

### Security
- Backups are kept in a private server folder the website never shows; only administrators can see or
  download them, and every download (and every download link asked for) is recorded in the Audit Logs.
  Development and test servers make no nightly copies, so none can end up in the source code. Google Drive access is limited to
  the files the app makes. Copies can be locked with a backup key (BACKUP_ENCRYPTION_KEY); on a live
  server without one, System Settings says the copies aren't locked and the administrators get one
  email. BACKUPS.md shows how to make a strong key; keep it in a password manager, away from the
  server and from Google Drive, because no locked copy opens without it.

## [1.18.2] - 2026-10-30

### Improvements
- A brand-new company sees first steps, not a page of zeros: the Dashboard says Welcome and shows
  "Set up your workspace" (Create a project, Add your team); My Tasks, Notifications and Activity
  offer the same steps when they are empty; an employee on no project is told so and may start one.
- Projects: with no project yet, one invitation that says what a project is for; beside one or
  two projects, a "Start another project" tile fills the row.
- New task with no project explains that every task belongs to a project and offers Create a
  project, instead of a form that could not be sent.
- Board: says when a day has no tasks; an empty column shows "No tasks · Add a task" under its
  header; with no project it offers New project.
- Project page: the completion bar shows its track; Overview cards no longer stretch to each
  other's height; Next meeting names the last meeting when none is planned; empty Tasks and
  Meetings tabs say what to do next.
- Inspections tab: one invitation to make an inspection form instead of four empty boxes; the task
  panel offers "Start an inspection" only when the company has a form.
- Meetings: bigger cards (one a row on a phone, two on a tablet or laptop, three on a wide screen)
  with their details and footers lined up; a summary strip (Next 7 days, Open action items,
  Minutes to finish, Held this month) that shows just those meetings when pressed; and "Nothing
  coming up", which names the last meeting and offers Schedule a meeting.
- My Action Items: one list with columns (item, meeting, due date, status), and an empty state that
  points to Meetings.
- A finished meeting with no agenda or notes speaks of them in the past ("No notes were taken").
- Chat, Reports, Management, Timeline, Audit Logs and the New project form say plainly when there
  is nothing yet and offer a next step, instead of flat charts, "Select a conversation" or an empty
  template box; Reports shows "—" for the on-time rate until something with a due date is done.
- Search says "Nothing matches …" when it finds nothing, before the Ask MICO AI line.
- Page titles sit at the same height on every page; stat tiles and bar-chart labels read whole on
  phones and tablets; the Settings Profile card keeps its own height; Notifications keep a readable
  width on wide screens.
- Dashboard: Recent activity says who was given a task ("Aisha Khan assigned MICO-3 to Omar Ahmed").
- User Management shows each person's full name with their @username under it.
- Share with client: the panel lists exactly what the client page shows (tasks and milestones,
  approved minutes, inspection reports with the inspector's notes and the signers' names) and what
  it never shows.
- Minutes PDF: dates read day-month-year and times in 24 hours ("1 Oct 2026, 13:15"); an open action
  item past its due date says "Overdue", and the Open action items tile counts them.
- Weekly management email: after the projects it names, it says how many more need attention
  ("and 2 more on the Management page").
- Phones and tablets: the file box says "Tap to add files or photos"; the Workload table can be
  scrolled from the keyboard.

### Bug fixes
- Initials are made from letters only: "Mohammed (Acme)" shows MA and "(Acme) Pipeline" shows AP (they
  showed "M(" and "(P"), on the website, in PDFs and emails. The Android app and the Chrome
  extension follow in their next update.
- The project page showed two completion figures (9% on the tile, 41% under Work done); Work done
  now shows the same share of tasks finished ("1 of 11 tasks · 9% done").
- Email-code sign-in: reloading the page keeps you on the code step, and asking for another code
  within a minute now says so and how long to wait (it said a code was sent when none was).

## [1.18.1] - 2026-10-29

### Improvements
- Tablets: the menu is a slim rail of icons (each item its own icon, with its name on hover), so
  pages get the width of the screen. The full menu returns from 1024px wide; phones keep the ☰ menu.
- Wide screens: reading pages stay at most about 1680px wide and centred, with the top bar and
  footer on the same edges. The Board, Calendar, Timeline, Workload and Chat still use the full
  width.
- Kanban Board: the board fits the window and each column scrolls on its own under a header that
  stays in view; long column names wrap and show in full on hover.
- Phones: My Tasks keeps its filters behind one Filters button that shows how many are in use;
  project numbers sit in one compact strip; Reports, Audit Logs and User Management lay out their
  filters and tables to fit; the meeting form, agenda, action items and ⋯ menus stay on screen.
- Fingers: buttons, fields, tick boxes, switches and menu items are at least 44px on phones and
  tablets everywhere, including the task panel, task form, board cards, meetings and inspections.
- Pages no longer jump while they load (the project page most of all), and page titles keep their
  whole width beside their buttons instead of being squeezed.
- Small laptops: the meeting page gives the agenda, notes and action items the full width; long
  meeting titles keep their room on tablets.
- Arabic and English lines side by side keep their own direction in meeting minutes, action items,
  activity and the client page.
- The sign-in pages show the MICO360 logo in the right colours in dark mode; Forgot / Reset
  password sit in the sign-in card.
- Overlapping profile pictures no longer show each other's initials; the Dashboard's completion
  bars are drawn against 100%.

### Bug fixes
- In New project and New task, pressing Tab from an open people list now moves to the next field
  (it got lost in newer Chrome).
- The client page accepts a pasted sign-in code with spaces or a line break around it (it kept only
  the first two digits).
- An inspection finished on another device now shows the finished report's own answers on the
  phone that was offline, so its counts and the failed items to turn into tasks are right.
- Audit Logs: the module filter lists every module in the log, not only those on the rows loaded so
  far.
- A task opened from the Board or the Dashboard is now in the page address, so it stays open after
  a reload and the link can be shared.

## [1.18.0] - 2026-10-28

### New features
- Scheduled inspections: on a project's Inspections tab, anyone on the team can "Schedule an
  inspection" — pick the form, a name and place ("Rig 3"), the inspectors and how often it repeats
  (every day, every working day, chosen weekdays, monthly or custom, with a start and an optional
  end). Each check arrives on its day as a task with the form — in My Tasks, the Calendar, reminders
  and the morning email — even if the last one wasn't done. "Start inspection" on the task opens the
  checklist with the form and place filled in, and finishing it completes the task. A missed check
  stays open as late and can still be done ("Done late · 2 days"). The tab lists the due checks
  (late, due today, upcoming) and every schedule, with Edit and Stop. Any task can also carry an
  inspection form from the New task form. Deleting a form stops the schedules that use it, and says
  so first; checks already made can still be done.
- Management (a new page for administrators and anyone who runs a project): every project's health
  in one place — % done, late tasks, next milestone, last activity and a red / amber / green mark
  with the reasons, worst first — plus inspections (checks due, done, done late and missing, the
  pass rate, the most-failed items and forms, open follow-ups), people (late work, overloaded days
  this week, open meeting action items) and 4, 12 or 26 weeks of trends. Filter by project, owner
  and status; every count opens the list behind it; download it all as a PDF. Administrators see
  every project, everyone else the projects they run.
- A weekly management summary email on the first working morning of the week, with the projects
  that need attention, late work, missing checks and a link to the Management page. Each person can
  turn it off in Settings, and an administrator can turn it off for everyone.

### Improvements
- The company's first day of the week is now a setting (System Settings, Sunday unless changed).
  The Calendar, Workload, Timeline and reports use it for everyone who hasn't chosen their own.
- A task's history says when its inspection form or place changed.
- On-off switches, and a few small links on the inspection pages, are easier to tap on phones and
  tablets; the sidebar keeps the page you're on in view on short screens.

### Bug fixes
- On a tablet, a project with a long name no longer shows its name one letter per line at the top
  of the project page — the buttons move under the name when there isn't room.

### Security
- The Management page, its lists, its PDF and the weekly summary show each person only the projects
  they run (administrators: all), and its requests are rate-limited.

## [1.17.0] - 2026-10-27

### New features
- Templates (a new page in the menu): start a project from a template with its board columns and
  standard tasks — each with its description, checklist, priority and a due date like "start + 5
  days" (a day off moves to the next working day) — and choose who fills each role, such as
  "Inspector" or "Site lead". Task templates fill in the New task form. Anyone who runs a project can
  save it, or one of its tasks, as a template ("Save as template"), with a warning first that
  everyone in the company will see it; administrators manage all templates.
- Inspection checklists: inspection forms (on the Templates page) are checklists of Pass / Fail /
  N/A items and readings with limits — a reading outside its limits fails by itself — ending with
  the inspector's signature and, if the form asks, the client's or a supervisor's. Each project has
  an Inspections tab, and an inspection can be attached to a task (finishing it offers to mark the
  task done). Failed items become follow-up tasks with one tap, or all at once. Finishing makes a
  branded PDF report. On a phone, an inspection you've started keeps working without signal — even
  if the page reloads — and sends everything when you're back online. A finished report can be shown
  on the project's client page when someone ticks "Show to client"; a reopened report says which
  revision it is.

### Improvements
- The New task form has a checklist you can fill in before creating the task.
- Every way of signing out now warns before throwing away changes that haven't been sent yet.

## [1.16.0] - 2026-10-26

### New features
- Client view: share a read-only page of a project with a client — no account needed. On the
  project page, its owner, managers and administrators open "Share with client" and add the
  client's name and email; the client gets a link, and opens it with a one-time code sent to that
  email (a forwarded link alone doesn't work). Their device stays signed in for 30 days, and access
  lasts until it's removed; the panel shows when each client last looked, with Resend and Remove.
- The client sees the project's progress (status, % done, target date and a timeline) and only the
  tasks, milestones and approved meeting minutes someone has marked "Show to client" — tasks with
  their status and due date, never who has them, comments, files or chat. Minutes open on the page
  or as a PDF without anyone's name in it. Before minutes are shown, a preview shows exactly what
  the client will see, with staff names highlighted; people's names are taken out of next steps,
  and risks and open issues stay hidden unless you tick them. Tasks you show get a "Visible to
  client" mark, and the history says when something was shown or hidden.

### Security
- Client access is separate from staff sign-in: client codes are single-use, expire after 10
  minutes and allow five tries, requests are rate-limited, and every share, removal, resend,
  client sign-in and lockout is in the Audit Log. Resend signs the client's devices out and Remove
  ends access at once. Minutes moved to another project, and tasks moved to another project, stop
  showing to the first project's client. Emails that carry a private link no longer have their
  links tracked.

## [1.15.0] - 2026-10-26

### New features
- MICO AI can now act, not just answer. Ask it to create tasks ("make a task for each failed item"),
  change tasks (reschedule, reassign, change status or priority — one or many: "move my overdue Rig
  tasks to next week"), draft a meeting's minutes, or schedule a meeting with people and an agenda.
  It shows a review card first: every change with a tick box, fields you can edit, and nothing
  happens until you press Confirm. Anything it couldn't read (an unknown name, an unclear date) must
  be put right before it can be ticked. After confirming, Undo puts things back for 15 minutes,
  unless someone has changed the same item since. Meeting cards have "Email the invitations"
  ticked; minutes are saved as a draft you review on the meeting page, never approved or emailed.
  Everything runs with your own permissions, the usual notifications go out, and the history says
  "via MICO AI". It asks when a name is ambiguous ("Which Omar do you mean?") and never deletes.
- Every employee can create projects: "+ New project" now shows for everyone, and the form picks
  the owner (you, or someone else) and the team. You stay on the team as a manager. People you add
  get an "Added to a project" notice (it can be turned off in Settings).

### Improvements
- A project is run by its owner, its project manager or a team member with the Manager role (and
  administrators): they can edit its details, picture, status and owner, archive it, and manage its
  team and board columns. Deleting a project stays with administrators. Handing a project over
  keeps the previous owner or manager on the team as a manager, and a project always keeps someone
  to run it. The project page shows who created it and who its project manager is.
- Team changes that are refused (for example removing the last person running a project) now say
  why, and only active people can be added to a team.

### Security
- Having created a project no longer gives access to it on its own: access comes from being on its
  team (or an administrator), so someone removed from a team really loses access. Only
  administrators can name a project's manager.

## [1.14.0] - 2026-10-25

### New features
- Chat in the menu shows how many chat messages you haven't read, on its icon (99+ above 99), and
  screen readers hear "Chat, 3 unread messages". It goes up as messages arrive and down as soon as
  you read them — here, in another tab or on your phone — without reloading, and it's hidden when
  everything is read, or when you mute, archive or delete elsewhere. Like the Android app's Chat
  tab, it leaves out muted and archived conversations and the one open in front of you. On a phone,
  the menu button gets a dot.
- MICO AI: "PDF report" on every answer — the question, the whole answer, every table (each under
  its own heading) and the sources in one professional PDF: page margins, one type scale, a header
  and footer on every page with "Page N of M" and who made it when, table headers repeated on each
  page, rows kept whole, wide tables turned landscape and fitted. Text-only answers get one too.

### Improvements
- MICO AI has a cleaner, ChatGPT-style page that uses the whole width: a slim chats rail (a sheet on
  phones and tablets), your questions as bubbles on the right, answers as full-width text, and a
  message box pinned at the bottom that grows as you type and turns into Stop while MICO AI works.
  Wide tables use the room beside the text and show when there's more to scroll; long answers open
  at their start; "Jump to latest" when you've scrolled up; suggestions as cards; screen readers
  hear when it starts working. Excel downloads now include the sources.
- PDFs: a table row taller than a page continues on the next page instead of being cut, a heading is
  never left alone at the bottom of a page, and an over-long title or footer ends with "…".
- Chat unread counts (on the Chat page, the new menu badge and the Android app's Chat tab) count
  your direct messages and the channels of projects you're on the team of (owner, manager or
  member). A channel you've never opened counts only messages since you joined its team, instead of
  its whole history, and an administrator's view of other teams' channels doesn't count as unread.

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
