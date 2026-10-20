# AI help for scheduling meetings — design

Date: 2026-10-20 · Web portal only · Builds on the existing AI Management setup (default chat model,
per-user limits) and the New task form's "Describe it in plain English".

## Why

Scheduling a meeting in the portal is slow: you fill the form field by field, save, then add people
and the agenda one by one on the meeting's page. You also can't tell whether people are free. The
owner wants the AI to do the typing and the checking, while staying in control of what is saved.

## What success looks like

A person types one sentence, for example "Weekly site review with Omar and Sara every Monday 10am at
RIG1 for the Pump project, ahmed@client.com too". They review what the AI understood, apply it, take
one of the free times offered or keep their own, have an agenda drafted, and save. The saved meeting
already has its people and agenda. Invitations go out later, as now.

## Goals (all decided by the owner)

1. **Fill the form from a sentence.** A "Describe it in plain English" panel at the top of the
   Schedule meeting form, worded and behaving like the New task form's:
   - It extracts title, start date and time, length or end, repeat, project, location, online link,
     people, and agenda points if the sentence names any.
   - **Review first.** It lists what it understood next to what the form holds. The person ticks what
     to use and clicks Apply. Nothing changes before Apply.
2. **People in the new-meeting form.** A People section in the *new* meeting form, saved with the
   meeting in one go.
   - Names in the sentence are matched to portal users ("Omar" → Omar Ahmed). When a name matches
     more than one user, the person chooses; it is never guessed.
   - Email addresses in the sentence become outside guests (`externalEmail`, with a name if given).
   - People can also be added and removed by hand.
3. **Agenda in the new-meeting form.** An Agenda section in the *new* meeting form, saved with the
   meeting. "Draft agenda" (AI) proposes items drawn from:
   - what was typed: the title, the description and the sentence;
   - the project's open tasks (my call: overdue, blocked and due before the meeting or within 7 days
     after it);
   - the previous meeting's leftovers: open action items and unfinished agenda items of the previous
     meeting in the same series, else of the project's last meeting before this one.

   Each item gets a lead (one of the invited portal users) and minutes, so that together they fit the
   meeting's length. Everything stays editable, and the person can add, remove and reorder items.
4. **Free times** (plain calculation, not AI):
   - **Suggest 3 times:** the nearest three slots, from the chosen day onward, when every invited
     portal user is free for the meeting's length, inside working hours. One click uses a slot.
   - **Clash warning:** if anyone invited already has a meeting at the chosen time, the form names
     who and when.
   - **Busy strip:** for the chosen day, each invited person's busy blocks. A block shows the meeting's
     title only if the person scheduling may see that meeting; otherwise it shows "Busy".
   - "Busy" means another non-cancelled meeting where that user is the organizer or an attendee.
     Outside guests have no known calendar, so they are not checked.
5. **Working hours setting.** A new System Settings section, "Meeting hours": working days and start
   and end time, in company time. The default is Sunday–Thursday, 08:00–17:00, Asia/Muscat. Free-time
   suggestions stay inside these hours.
6. **Write description** (AI). Writes the description from the title, agenda and sentence (my call: in
   the language the person wrote in, Arabic or English). It is offered like the other suggestions, and
   when there is already text, as a replacement the person can decline.
7. **Existing meetings.**
   - The edit form offers the sentence fill, free times, clash warnings and Write description.
   - People and Agenda stay on the meeting's page, as today, and are not added to the edit form.
   - The meeting page's Agenda section gets a "Draft agenda" button that proposes items to add,
     reviewed before anything is added.

## Non-goals

- Sending invitations automatically. Saving never sends; "Send invitations" on the meeting page stays
  the only way.
- Creating Teams, Zoom or Meet links. The AI only copies a link the sentence contains.
- Outside calendars (Outlook, Google) and outside guests' availability.
- The Android app. It has no meetings screen; my call.
- Booking rooms or resources.

## Anti-goals (failures even if it "works")

- The AI changing anything without the person's Apply, or inventing people, dates or numbers that the
  sentence or the data doesn't support.
- Showing the title of a meeting the person isn't allowed to see (busy strip, clash warning, agenda
  leftovers).
- Suggesting people the person can't invite, or tasks and action items from projects or meetings they
  can't see.
- Free times outside working hours, or inside someone's existing meeting.
- The form breaking or blocking when AI isn't configured or the call fails. Free times, clashes, the
  busy strip and manual People and Agenda work without AI. The AI buttons then show the existing "AI
  is not configured — ask an admin" message.

## Constraints

- Follow the existing AI pattern:
  - add functions to `ai-feature-service.ts`, using `run()`, the per-user limits, the concurrency
    gate and `parseJsonObject`;
  - add bounded zod inputs in `ai-feature-routes.ts`;
  - the model is told "Reply with ONLY JSON", and the server validates every field it returns.
- People matching: the candidates are the **active** portal users (the meeting page's picker offers
  every user today; inactive and suspended ones are left out here). The owner agreed that their first
  name, last name and username (never email, phone or roles) go in the prompt, so Arabic names and
  nicknames can be matched, as projects are in `parseTask`. The server checks every id the model
  returns against that list. A name that fits more than one user comes back as a choice; one that fits
  none is dropped and listed as "not found". The existing attendee endpoints are not changed. Projects
  are matched with the existing `matchProject`.
- Times are company time, Asia/Muscat, as in the meeting form today. "Today" for relative dates is the
  company-local date, as in `parseTask`.
- Creating a meeting with people and agenda must be atomic. Either one create call accepts `attendees`
  and `agendaItems`, or the client creates the meeting and then adds them, rolling back or clearly
  reporting a partial failure. The builder chooses; atomic is preferred.
- New settings key with its own zod schema in `settings-service.ts` (e.g. `meetings.workingHours`):
  `{ days: number[] (0=Sun…6), start: "HH:MM", end: "HH:MM" }`, end after start.
- Accessibility and quality bar as in the rest of the portal:
  - axe-clean, keyboard reachable, phone width (no sideways scroll), dark mode, Arabic text (`dir="auto"`);
  - unit tests plus an e2e script in `D:/mico-release/audit-tools`.

## Decided shape (owner's answers)

| Question | Answer |
|---|---|
| What the AI does | All four: sentence fill, draft agenda, free times, write description |
| Where people and agenda go | Into the new-meeting form |
| Working hours | A System Settings item, starting Sun–Thu 08:00–17:00 |
| Agenda draws on | What was typed, the project's open tasks, the last meeting's leftovers |
| Agenda items get | A lead and minutes fitting the meeting length |
| People the AI may add | Portal users and email guests; the person chooses on ambiguity |
| Free-time help | Suggest 3 times, clash warning, day busy strip |
| Existing meetings | Same help in edit; "Draft agenda" on the meeting page; People and Agenda stay on the page |
| Busy-strip privacy | A title only when the person may see that meeting, else "Busy" |
| Applying AI output | Review first, like New task |

## Repeating meetings

- Free-time suggestions keep the repeat. A weekly meeting is offered only on its chosen weekdays, a
  monthly one only on its day of the month, and a daily one on working days.
- Clash warnings for a repeating meeting check its first 4 meetings, and say which date clashes.
- When editing with "all upcoming meetings", the same applies from the meeting being edited.

## Order of work

The owner asked to release the three finished changes waiting in the clone first, as 1.2.0 (the
meeting link on tasks, New task in the current project, the source-map-js fix). This feature is then
built on top of that release.

## My calls (to check)

- "Open tasks" for the agenda means overdue, blocked, or due up to 7 days after the meeting.
- The AI writes in the language the person wrote in.
- Free times, clashes and the busy strip are plain calculations, available without AI.
- Suggested slots start on 30-minute boundaries. The default length is 60 minutes when nothing gives
  one.
- No Android change.
- A meeting with no end time counts as 60 minutes, as the code does today. The organizer counts as
  invited for free times and may lead agenda items.
- "Open" action items are those not completed or cancelled. "Blocked" tasks are those in a column of
  the BLOCKED kind.
- A drafted agenda goes on the meeting being created, which is the first meeting of a series, since
  series copy people but not agenda items.
- An outside guest given only as an email is named from the part before the @.

## Left to the builder

- Endpoint names and shapes. For example: `POST /ai/parse-meeting`, `POST /ai/draft-agenda`,
  `POST /ai/write-meeting-description`, and `GET /meetings/availability?userIds=…&from=…&to=…`
  returning busy blocks with titles filtered by meeting access.
- Whether people and agenda are created in the same request as the meeting.
- The exact layout of the People and Agenda sections and the busy strip, matching the portal's
  meeting components (`components/meeting/*`, `kit.tsx`).
- Prompt wording and token limits, within the patterns above.
