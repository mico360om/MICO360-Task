# Keyboard shortcuts (web app)

Press **Ctrl + /** (or **?**) anywhere to see this list in the app. It is also in the profile menu
under **Keyboard shortcuts**. On a Mac, use **⌘** wherever this page says Ctrl.

## Anywhere

| Keys | What it does |
| --- | --- |
| Ctrl + K | Search tasks, projects and people, or jump to a page |
| Ctrl + / or ? | Show the list of shortcuts |

## Forms and dialogs

| Keys | What it does |
| --- | --- |
| Ctrl + S | Save the form or dialog you're in |
| Ctrl + Enter | Create, send or save the form you're in |
| Esc | Close the dialog or panel, or drop an edit |

These keys work while you're typing:
- Ctrl + S and Ctrl + Enter submit the form you're in. In a dialog, that's the dialog's form.
- On pages with one main form, Ctrl + S saves that form.
- A form that is already saving isn't sent twice.
- When there is nothing to save, Ctrl + S is left to the browser.
- In the task panel, Ctrl + S also saves a title or description you're editing in place.

## On a page (single keys)

| Key | What it does |
| --- | --- |
| N | Add new: a task. On Projects, a project; on Meetings, a meeting; on User Management, a user. On a project's page, a task in that project (a meeting on its Meetings tab). On the calendar, a task on the day shown |
| E | Edit the open task (task panel), meeting (meeting page) or project (project page) |
| Delete | Delete the open task or meeting. You're always asked first, and the safe answer is focused |
| R | Load the latest data on the page |
| / | Jump to the page's own search box (Meetings, Calendar, Chat, a project's tasks), else the main search |

Single keys work only when you're not typing in a box, so typing "n" in a field never opens
anything. While a dialog is open, only that dialog's own shortcuts work.

**Switching them off:** open the list (Ctrl + /) and turn off **Single-key shortcuts**. This helps
with a screen reader's own single-key navigation. The choice is kept on that computer. Ctrl
shortcuts and Esc keep working.

## Hints

Buttons with a shortcut show it:
- in their tooltip, for example "New project (N)";
- to screen readers (`aria-keyshortcuts`);
- on a computer, as a small key cap on the main buttons of dialogs ("Create task Ctrl+Enter") and
  beside menu items.

Key caps are hidden on touch screens.

## Notes for developers

- The keys and their labels are in `Web Portal/frontend/src/lib/shortcuts.ts`.
- One listener, `components/shortcuts/ShortcutProvider.tsx`, is mounted in `AppShell`.
- A page registers what a key does there with `useShortcut(action, handler)`:
  - a page's own action beats the header's (`priority: 0`);
  - a panel that is a dialog passes `scope: ref`, so its actions run while it is open.
- Save and Submit need no code. They submit the focused form, else the open dialog's form, else
  `<form data-shortcut-save>`.
- A page's search box gets `data-page-search`.
- On a `Button`, `shortcut="save"` adds the tooltip and `aria-keyshortcuts`; `showShortcut` also
  draws the key cap.
- Keys are matched by their place on the keyboard (`KeyboardEvent.code`), so they work with the
  Arabic layout too.
- No shortcut takes a key the browser keeps: Ctrl + N, T, W, R, F, P and L stay the browser's.
- Tests:
  - `lib/shortcuts.test.ts`, `components/shortcuts/*.test.tsx`;
  - the browser test `D:/mico-release/audit-tools/shortcuts-e2e.mjs` (33 checks, every module).
