# Android app 1.19 — release notes (collected here; copied into CHANGELOG.md when the app is released)

## New look
- In the Android app, colours are the website's in light and dark mode, and grey and amber text is easier to read.
- In the Android app, text uses the website's fonts (IBM Plex Sans and Archivo), and figures line up in columns.
- In the Android app, buttons, badges, chips, fields and switches look like the website's.
- In the Android app, people and projects show the website's pictures and drawn project icons, and empty pages show an icon and what to do next.
- In the Android app, the top bar is white with the MICO360 logo, Search and a bell for notifications; the side menu is grouped like the website's (Workspace, Communication, Admin); the bottom tabs are Dashboard, My Tasks, Projects, Meetings and Chat, with drawn icons.
- In the Android app, the side menu offers Management to the people who run a project.
- In the Android app, the Dashboard, My Tasks, the boards and the calendar use the new look, with the waiting-for-approval mark and loading placeholders.
- In the Android app, the task screen and the task form use the new look.
- In the Android app, Projects, project pages, User Management and Reports use the new look, with progress bars in each project's colour.
<!-- new-look lines above this line -->

## Dates and fixes
- In the Android app, every date and time is written as on the website — "30 Oct 2026", "Fri 30 Oct", "09:05" — whatever language the phone is set to.
- In the Android app, weeks start on the company's week start (set on the website) unless you chose your own.
- In the Android app, a task waiting for approval is never counted or shown as overdue — the same numbers as the website.
- In the Android app, moving a task that needs approval to Done says it is waiting for a project manager, instead of showing it done and jumping back; bulk Complete says the same.
- In the Android app, asking for another sign-in code too soon says so and when to ask again, and the code step is still there if Android closes the app while you read the email (with the address partly hidden, for a shared phone).
- In the Android app, anyone can create a project, and a project's owner, its managers and administrators can change it, its team, its columns and delete its tasks — as on the website.
- In the Android app, Timeline, Workload, Management, Templates and MICO AI found with Search open on the website (they used to do nothing), and Management is offered to the people who run a project, not only administrators.
- In the Android app, a link that opens the app on a task, a meeting, a chat or another page (from an email or the website) has the Dashboard behind it: Back goes there instead of closing the app.
<!-- dates-and-fixes lines above this line -->

## New look — meetings, chat, account
- In the Android app, Meetings use the new look.
- In the Android app, Chat, Notifications, Activity, Search, Settings, Profile, About and the sign-in screens use the new look.
<!-- meetings-chat-account lines above this line -->

## Daily work
- In the Android app, the task screen lists comments before files and dependencies on a phone, as the website does, and shows "Formerly RIG-4", "Inspection" and "Visible to client" by the task's number.
- In the Android app, a task waiting for approval opens on its Approval section: a project manager can Approve it or Send it back with a reason; others see whose approval it waits for. "Needs approval" can be turned on there by anyone and off only by the project's managers.
- In the Android app, My Tasks starts with "To approve" for project managers: approve or send back the tasks others have finished.
- In the Android app, New task and Edit task have the "Needs approval" tick, already ticked in projects that ask for it; only the project's managers can untick it.
- In the Android app, New task can start from a task template, takes a checklist, and says when the project will give the new task today's date.
- In the Android app, a task can be moved to another project — from the task's menu, a card's actions on the boards, or several at once in My Tasks — with the website's preview and one question about people not on the new team; the task's old number still finds it.
- In the Android app, board cards show "Visible to client" and "Inspection", and on a phone an empty column is only as tall as its "No tasks".
<!-- daily-work-tasks lines above this line -->

- In the Android app, the Dashboard is the website's: the welcome band, the four tiles (your own, or the company's for administrators), tasks waiting for your approval, Due soon, Recent activity, and first steps for a new company.
- In the Android app, Projects is the website's page: status tabs with counts, search, owner, sort and "Only my projects" for administrators, the website's project cards (Open, Overdue, Next due, team, owner, target), a status menu and Archive.
- In the Android app, the project form has the website's Tasks switches — carry unfinished tasks forward, new tasks due today, new tasks need approval — and a new project's team can be picked when creating it.
<!-- daily-work-pages lines above this line -->

- In the Android app, Meetings shows the website's summary — Next 7 days, Open action items, Minutes to finish, Held this month; tap one to filter — "Nothing coming up" with the last meeting, people's faces on the cards and a compact header.
- In the Android app, a finished meeting shows its Final MOM and action items first, and says "No notes were taken." when none were.
- In the Android app, Settings has the Approvals and "Added to a project" notification switches, the weekly management summary switch for the people who get it, and says when your week follows the company's; Reports shows "—" for on time until a task with a due date is finished.
- In the Android app, User Management shows each person's last sign-in, finds those who never signed in, sorts by last sign-in, and sends welcome emails — to one person, the ticked ones, or everyone who never signed in; a new account's temporary password is optional when a welcome email goes.
<!-- daily-work-meetings-people lines above this line -->

## Planning and AI
- In the Android app, Timeline shows every open project's health, progress, next milestone and target, with Late and At risk filters and each project's tasks — as on the website's phone layout.
- In the Android app, Workload shows each person's open tasks due each day of the week against the daily limit, with overdue tasks and days off; its suggestions give a task to a teammate or move it to a lighter day in one tap, and administrators can change the daily limit.
- In the Android app, Management is a real screen for administrators and the people who run a project: the website's figures for every project, with the list behind each number, its filters, and the same PDF.
- In the Android app, Management shows each project's health with the reasons, the tasks waiting for approval, inspections and people, each number opening its list.
- In the Android app, Management shows the trends of the last 4, 12 or 26 weeks: tasks created and completed, late tasks and the inspection pass rate.
- In the Android app, the calendar marks a task waiting for approval with an hourglass, as on the website.
- In the Android app, MICO AI is a real screen: your chats (new, rename, search, delete), questions and answers with tables and sources, Excel and PDF downloads, Stop, and quick replies when it asks which one you mean.
- In the Android app, changes MICO AI suggests (new tasks, task changes, final-minutes drafts, meetings) show as a card to tick, Confirm or Cancel, and Undo for 15 minutes; nothing changes until you confirm.
- In the Android app, you can change what MICO AI suggests before confirming it — the title, project, dates, people, status, priority or the minutes' text.
- In the Android app, Search offers "Ask MICO AI" with what you typed, opening a new chat with that question.
<!-- planning-and-ai lines above this line -->

## Inspections, templates and client sharing
- In the Android app, signing out warns about inspection changes not sent yet, and someone else signing in on the same phone never sees or sends them.
- In the Android app, inspections open on the phone and are answered there: Pass, Fail or N/A with a note, and readings with their unit and limits (a reading outside its limits fails). Every answer is kept on the phone and sent when there is signal; an inspection opened once opens again with no signal.
- In the Android app, the inspector — and the client or supervisor when the form asks — signs with a finger or types their name. Signing with no signal is kept on the phone and finishes the inspection when the signal is back; finishing offers to mark its task done.
- In the Android app, each failed item of an inspection can become a follow-up task — one, or all at once, for the owner, a team member or nobody yet — even without signal (made once the phone is back online).
- In the Android app, a project has an Inspections tab — due checks (late, today, upcoming), inspections in progress and finished reports — kept on the phone so it opens with no signal. Starting an inspection needs a connection (tap Start before you leave the office); after that it works without one.
- In the Android app, a finished inspection's report downloads as a PDF and can be shown to the client (after seeing exactly what the client will see); an inspection can be reopened, taken over or deleted, as on the website.
- In the Android app, a project's inspection schedules are listed with their repeat, next due and last done; people who can schedule may Schedule an inspection, edit a schedule or stop it.
<!-- inspections lines above this line -->
- In the Android app, a new project can start from a project template: pick its start day and who fills each role, and see the tasks it will create.
- In the Android app, the people who run a project can save it, or one of its tasks, as a template; templates are edited on the website.
- In the Android app, the people who run a project can share it with a client (add, see when they last looked, Resend — which emails a new link, stops the old one and signs its devices out — and Remove); an archived project's sharing is read-only.
- In the Android app, the people who run a project can show a task to its client (title, status and due date only); such tasks carry an eye mark on cards and in the project's task list.
- In the Android app, approved minutes of a project meeting can be shown to the client — after a preview of exactly what the client will see, with risks and open issues left out unless ticked.
- In the Android app, a task can carry an inspection form (and a place): it shows an Inspection mark on cards and rows, and its screen offers Start inspection, Continue inspection or View report.
<!-- templates-client lines above this line -->

## Final pass
- In the Android app, search, filters and sorted lists work the same whatever language the phone is set to: on a phone in Turkish, "site" finds "SITE WALK" again, names sort in English order and a role typed in capitals is the same role.
- In the Android app, Dashboard, My Tasks, Projects, Meetings, Notifications and Settings no longer start with an empty band under the top bar, and the side menu's logo sits at its top.
- In the Android app, the bottom tabs keep a little room under their names, so they no longer touch the phone's own buttons.
- In the Android app, TalkBack reads Management's owner choice once — "Owner: Anyone" instead of "Owner: Owner: Anyone".
- In the Android app, the "+N" after the faces on project, board and My Tasks cards is no longer cut off at the largest font size.
- In the Android app, with a larger font size, project names, task titles and other text that is cut after a few lines is shown in full instead of losing its "…".
- In the Android app, Workload opens each person's days on today, and the row fades at the edge where more days are hidden.
- In the Android app, the signer's name under an optional signature (the client's or a supervisor's) no longer shows a required star.
<!-- final-pass lines above this line -->
