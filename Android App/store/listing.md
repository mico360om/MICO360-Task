# Google Play Store Listing — MICO360 Tasks

Copy for the Play Console **Main store listing** and **Data safety** form. Placeholders in
`{{ }}` must be filled before submission.

## Main store listing (en-US)

**App name** (≤30 chars)
```
MICO360 Tasks
```

**Short description** (≤80 chars)
```
Your team's Kanban tasks, projects and chat — fast, offline-ready, on your phone.
```

**Full description** (≤4000 chars)
```
MICO360 Tasks brings your team's work to your pocket. Manage projects, move tasks across your
Kanban board, and stay in sync with your teammates — online or off.

• Kanban board — drag tasks across columns; changes sync live across devices.
• My Tasks & Dashboard — see what's overdue, due today and coming up at a glance.
• Quick add — capture a task in seconds with priority, due date, tags and assignees.
• Task detail — checklists, comments, @mentions and attachments.
• Team chat — project channels and direct messages, live.
• Notifications — push alerts for assignments and mentions; tap to open the task.
• Calendar — an agenda of your due dates.
• Works offline — read your tasks with no signal; your changes queue and sync on reconnect.
• Secure — hardware-keystore token storage and optional fingerprint/face unlock.
• Light & dark themes that follow your device.

MICO360 Tasks connects to your organization's MICO360 Tasks backend. You'll need an account from
your workspace administrator to sign in.
```

**App category:** Productivity
**Tags:** tasks, project management, kanban, teamwork
**Contact email:** {{ support@your-org.example }}
**Website:** {{ https://your-org.example }}
**Privacy policy URL:** {{ https://your-org.example/mico360-tasks/privacy }}  (host store/PRIVACY.md)

## Graphic assets required by Play (produce before submission)

- App icon 512×512 (from assets/icon.png).
- Feature graphic 1024×500.
- Phone screenshots ×2–8 (min 320px, 16:9 or 9:16) — Dashboard, Board, Task detail, Chat.
- (Optional) 7"/10" tablet screenshots.

## Data safety form answers

Declare the following (matches store/PRIVACY.md and the app's actual behavior):

| Data type | Collected | Shared | Purpose | Notes |
|---|---|---|---|---|
| Name, email | Yes | No | App functionality, account | From the user's org account |
| App activity (tasks/projects/messages) | Yes | No | App functionality | Work content in the org workspace |
| App info & performance (crash logs, diagnostics) | Yes | No | Analytics, app functionality | Sentry, only when a DSN is configured |
| Device identifiers (push token) | Yes | No | Notifications (app functionality) | Firebase/Expo push token |
| Location, contacts, photos, financial info | No | No | — | Not collected |

- **Is data encrypted in transit?** Yes (HTTPS).
- **Can users request deletion?** Yes — via the organization administrator (see PRIVACY.md).
- **Advertising / third-party ads?** No.

## Content rating

Complete the IARC questionnaire — expected rating: **Everyone** (no ads, no user-to-public content,
workplace communication only).
