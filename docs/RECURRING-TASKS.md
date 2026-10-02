# Recurring tasks

A task can repeat. Set the repeat when you create the task or later in its details, in the web app,
the Chrome extension or the Android app. All three edit the same rule on the server, so a repeat set
on the phone shows in the web app, and the reverse.

## Schedules

| Repeat | Options |
| --- | --- |
| Daily | Every N days |
| Weekly | Every N weeks, on chosen days (for example Sunday and Thursday) |
| Monthly | Every N months, on a day of the month, or on "the 2nd Tuesday" / "the last Friday" |
| Quarterly | Every N quarters, with the same day choices as monthly |
| Yearly | Every N years, on the due date's day and month |

Any schedule can end:
- never;
- after a number of tasks;
- on a date.

A day of the month that is still ahead counts. "Monthly on the 20th" for a task due on the 10th is next
due on the 20th of the same month, and "the 2nd Tuesday" works the same way.

A series can be paused and resumed. Day 31 means the last day of every month, so 31 January is
followed by 28 February, then 31 March. A task due on 29 February repeats on 28 February in other
years and returns to 29 February in leap years.

## When the next copy is made

- **When this one is done** (the default): completing the task (moving it to a Done column) makes
  the next copy at once. The copy is dated by the schedule and is never already overdue. If you
  complete a daily task three days late, the copy is due today, not on a day that has passed.
- **On each date, even if not done**: the server makes a copy on each due date, whether or not the
  previous one is finished. It checks every hour, so a copy appears soon after midnight in the
  company time zone (`COMPANY_TIMEZONE`). If the server was off for a few days, the missed days
  become one copy, not a backlog. The people on the task are notified that it is ready.

## When every app is closed

Copies are made by the server, not by the apps. Nobody needs the web app, the extension or the
phone open:
- A copy "on each date" is made by the server's hourly job, and the people on the task are notified.
- A copy "when this one is done" is made the moment a completion reaches the server.
- A completion made on a phone or in the extension while offline is sent when the app next connects.

The server itself must be running:
- **Windows server:** it runs while its tray icon is present. Choose "Start the server
  automatically when I sign in to Windows" during setup. If the computer was off for a few days,
  the missed dates become one copy when it starts again.
- **Hostinger:** add the 15-minute cron call in
  [DEPLOY-HOSTINGER.md, Step 6](DEPLOY-HOSTINGER.md#step-6--keep-the-scheduled-jobs-running-cron),
  because Hostinger may stop an idle app.

Missed dates are never back-filled as a pile of overdue copies.

## What the copy keeps

The new copy keeps:
- the title, description, priority and estimate;
- the assignees and watchers (anyone who has since lost access to the project is left out);
- the tags;
- the checklist, unticked.

It starts in the project's first open column, on today's board. Comments, files and time spent stay
with the task they belong to. Projects that are archived or completed stop making copies on
schedule.

The repeat rule moves to the newest copy. Earlier copies show "Part of a repeating series", and their
repeat can't be changed, because that would start a second, parallel series. Edit the newest copy
instead. The server refuses the change too, with `409 RECURRENCE_NOT_NEWEST`. If you switch the
repeat off on the newest copy, you can switch it back on there later.

When you edit a task's details you can choose to apply the change to this task only or to the entire
series; the entire-series option updates the open copies.

## No duplicates

Each task can have only one next copy, and the database enforces it (`tasks.recurrenceSourceId`
is unique). The same task can be completed twice, from the web app, the extension and the phone at
the same moment, or by an offline change that syncs later. In every case exactly one copy is made.
The hourly job is equally safe to run more than once, or on several servers.

## Deleting

- **This occurrence**: if it is the newest copy, the next copy is made first, so the series carries
  on and the deleted one is simply skipped.
- **Entire series**: every copy is deleted.

## Where it lives in the code

- `Web Portal/backend/src/modules/tasks/recurrence.ts`: the schedule maths. The web app
  (`frontend/src/lib/recurrence.ts`) and the Android app (`Android App/src/lib/recurrence.ts`) use
  exact copies of this file to preview the next dates, and `recurrence-copies.test.ts` fails if a
  copy drifts.
- `recurrence-service.ts`: when copies are made (completion, skip, the hourly sweep).
- `prisma-recurrence-port.ts`: making a copy in one transaction.
- Release check: `tools/release/verify-server.mjs`, section "Recurring tasks".
