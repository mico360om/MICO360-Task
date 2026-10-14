# Accessibility (a11y) — WCAG 2.1 AA notes (T17.5)

The web app is built to meet WCAG 2.1 AA. This documents what's in place and how to keep it there.

## In place

- **Semantic structure & landmarks**: `<header>`, `<main id="main-content">`, `<aside>`, `<nav>`;
  a **Skip to content** link is the first focusable element in the app shell.
- **Labels**: every form control has an associated `<label>` or `aria-label` (login, task drawer,
  column manager, recurrence editor, search, project team). Icon-only buttons carry `aria-label`
  (e.g. "Remove <name>", "Notifications", "Close").
- **Roles & state**: the task drawer is `role="dialog"` with `aria-label`; sign-in method and
  project tabs use `role="tablist"/"tab"` with `aria-selected`; alerts use `role="alert"`,
  status messages `role="status"`; toggle buttons expose `aria-pressed`.
- **Keyboard**: all interactive elements are native `<button>`/`<a>`/`<input>`/`<select>` and are
  reachable and operable by keyboard; focus styles are visible (`:focus`/`:focus-visible` rings).
- **Color**: the brand palette meets AA contrast for text on its backgrounds; state is never
  conveyed by color alone (status also shows text/labels).
- **Charts**: the dashboard `BarChart` is an `<svg role="img">` with labelled values in text.

## Added in the October 2026 audit

- **Contrast**: text uses its own "text tone" of each status colour (`--c-*-text`, see
  `index.css` and `tailwind.config.js`), dark enough for 4.5:1 on white, on the page ground and
  on its own soft tint, in both themes. Fills, borders and icons keep the brand colours.
- **Focus**: one visible ring everywhere (`:focus-visible`, 2px, theme-aware). Controls whose
  real input is visually hidden (status chips) show the ring on the visible chip.
- **Dialogs**: every dialog and the task drawer trap focus, close on Escape and return focus to
  the control that opened them (`hooks/useDialog.ts`) — also after focus has dropped to the
  page body because the focused button was disabled while saving. The phone menu is a dialog
  too. Dialog layers are rendered in `<body>` (`ui/ModalPortal.tsx`) so they are always laid out
  against the window.
- **Busy buttons** (`ui/Button.tsx`): while a save is running the button is `aria-busy` and
  `aria-disabled` and ignores presses, but it is not natively `disabled` — that drops keyboard
  focus to the page. Focus stays on the button, so after a refused save the reader is still in
  the dialog, next to the error.
- **Pinned button bar** (New Task dialog): the bar stays at the bottom edge while the form
  scrolls; a control that takes focus is scrolled clear of it (`QuickAddTaskForm.tsx`), so the
  focused field is never hidden (WCAG 2.2 "Focus Not Obscured").
- **Skip link**: stays the first Tab stop on every page. (Do not use `scrollIntoView()` on
  page load: in Chrome it moves the point Tab starts from. The sidebar scrolls its list
  directly.)
- **Touch**: on a coarse pointer every control is at least 32px (tick boxes 24px, WCAG 2.2
  asks for 24px); a text link that stands alone takes the `tap` class.
- **Larger text**: the breakpoints are in `em`, so a reader's larger default text size gets the
  narrower layout — the same thing page zoom does — instead of a cramped desktop layout.
- **Names**: row actions say what they act on ("Edit omar", "Delete omar"); toggles expose
  `aria-pressed` / `aria-expanded`; charts carry text alternatives; scrollable regions are
  focusable and named.
- **Board with the keyboard**: Space lifts a card, the arrows move it — left and right go
  straight to the next column, including an empty one — Space drops, Escape cancels.

## Known follow-ups

- **Drag-and-drop board**: dnd-kit provides keyboard sensors; add explicit keyboard instructions
  and an ARIA live region announcing moves for full AA parity on the Kanban board.
- Run an automated audit (axe-core / Lighthouse) in CI and fix any flagged issues.

## How to test

- **Keyboard only**: tab through each page; confirm the skip link, visible focus, and that every
  action is operable without a mouse.
- **Screen reader**: verify labels/roles are announced (NVDA/VoiceOver).
- **axe DevTools / Lighthouse**: run on each route; target 0 serious/critical issues.
