# Repeating meetings

A meeting can repeat. Choose **Repeat** in the New Meeting form (web app), or give a meeting a
repeat later with **Edit details**.

## Schedules

| Repeat | Options |
| --- | --- |
| Daily | Every N days |
| Weekly | Every N weeks, on chosen days (for example Tuesday and Thursday) |
| Monthly | Every N months, on a day of the month, or on "the 2nd Tuesday" / "the last Friday" |
| Quarterly | Every N quarters, with the same day choices as monthly |
| Yearly | Every N years, on the first meeting's day and month |

A series can end:
- never;
- after a number of meetings;
- on a date. A meeting on the end date itself still takes place.

The time stays the same in the meeting's time zone: a 10:00 meeting is at 10:00 after the clocks
change. "Every Tuesday" means Tuesday where the meeting is held. Day 31 is the last day of every
month.

The first meeting is always on one of the repeat's days. A Tuesday meeting set to repeat on Monday
and Wednesday starts on that Wednesday, and the form says so before you save.

## Each meeting is a real meeting

The meetings of a series are created ahead: about the next three months, at most 26 at a time. A
server job tops them up every six hours, so a series without an end keeps going.

Each one has its own agenda, notes, attendance, minutes and action items. A series never gets the
same meeting twice, even with two servers running.

## Changing a series

Editing a meeting of a series asks **"Save changes to a repeating meeting?"**:

- **This meeting only.** Changes just this meeting: another room, another time, another title.
  The rest of the series keeps its schedule.
- **All upcoming meetings in the series.** Applies what you changed to every meeting that hasn't
  happened yet. Details you didn't touch stay as they are on each meeting. Saving without a change
  sends nothing.
  - A new time or length moves every upcoming meeting, and each one keeps its day, its agenda and
    its notes. A meeting deleted or cancelled on its own stays that way, on its date. A meeting
    whose new time has already passed today keeps its own time and takes just the new length.
  - Moving the meeting to another day moves the series' days with it: a Tuesday series moved to
    Thursday repeats on Thursdays; a monthly series on the 30th moved to the 2nd repeats on the 2nd;
    "the 2nd Tuesday" moved to that Thursday becomes "the 3rd Thursday".
  - A new repeat rebuilds the upcoming meetings on the new days.
  - **Does not repeat** ends the series after this meeting.
  - A series can also be moved further ahead than three months.

Only someone who can change the series' first meeting (its organizer, the project's manager or an
admin), or every one of its upcoming meetings (for example after the series was handed to them or
moved to their project), can change, cancel or delete all its upcoming meetings. Someone running one
meeting of it can change that meeting.

Meetings already held are never changed. If a series that has started gets a new schedule, it is
split: the meetings held stay as one series, and the upcoming ones become a new series.

A new repeat always applies to the whole series. When the repeat is changed, **This meeting only**
is greyed out.

## Cancelling or deleting

**Cancel meeting…** and **Delete meeting…** ask the same question:
- **This meeting only.** The series goes on. A cancelled meeting stays in the list, marked
  Cancelled, and is never created again.
- **All upcoming meetings in the series.** Every upcoming meeting is cancelled (or deleted), and no
  more are created. Meetings already held stay, with their minutes.

## People

Someone added to a meeting of a series is added to its later meetings too, and new meetings of the
series copy the latest meeting's people. Someone taken off a meeting comes off its later meetings.
Changes to a meeting that has already started (recording who came) stay with that meeting.

## Calendar invitations

**Send invitations** on any meeting of a series sends the whole series as one calendar entry. It
repeats in the attendee's calendar with the same rule, so a series without an end shows without one.
Cancelled dates are left out, and meetings changed on their own show as changed. The series is
described with its own title, place and length, whichever meeting it is sent from.

After that, calendars are kept in step:

| Change | What invitees receive |
| --- | --- |
| One meeting changed | An update for that date only, to the people who have the series |
| One meeting cancelled or deleted | A cancellation for that date only |
| The series changed | The updated series |
| A started series moved to a new schedule | The old series ends at its last meeting held (everyone who has it hears, people added to later meetings included), and the new series is sent |
| The series cancelled before it started | The whole series is cancelled |
| The series cancelled after it started | The series ends at its last meeting held (past meetings stay in calendars) |
| A series whose first meeting was deleted moves to a new schedule | The old series is removed, and the new series is sent |
| Someone taken off every upcoming meeting | The series leaves their calendar |
| Someone taken off some meetings | Those dates leave their calendar |

Only changes calendars show (dates, times, repeat, title, place, notes) send an update; a new
category or status doesn't. Each update is numbered above the last, so calendars never skip one.

Reminders are sent before each meeting, as for any meeting.

## Where repeating meetings show

- **Meetings list:** each meeting of a series is marked **Repeats**.
- **Meeting page:** the header says how it repeats ("Repeats every week on Tue, Thu, until
  19 Nov 2026").
- **Calendar:** meetings show on their days with their times, beside the tasks due. **More filters
  → Show meetings** hides them.
- **Project dashboard:** the Meetings tab lists them, and **Repeating meetings** names each series
  with its next date.
- **Android app:** the calendar shows meetings on their days (marked 🔁), and a project's screen lists
  its next meetings and its repeating series. Meetings can't be changed in the app.

## API

- `POST /meetings` with `recurrenceRule` creates the first meeting and the meetings due.
- `PUT /meetings/:id?scope=series` changes all upcoming meetings of the series. Without `scope`, it
  changes this meeting only, and a `recurrenceRule` sent for a meeting of a series is ignored.
- `POST /meetings/:id/cancel?scope=series` and `DELETE /meetings/:id?scope=series` cancel or delete
  all upcoming meetings of the series.
- `GET /meetings?from=…&to=…` lists the meetings starting in a range (the calendar).
- `GET /meetings/:id` includes `series: { id, rule, timeZone }`.
- On every meeting of a series, `recurrenceParentId` is the first meeting's id (null on the first
  meeting itself). The first meeting holds the rule.
