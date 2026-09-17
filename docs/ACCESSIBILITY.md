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

## Known follow-ups

- **Drag-and-drop board**: dnd-kit provides keyboard sensors; add explicit keyboard instructions
  and an ARIA live region announcing moves for full AA parity on the Kanban board.
- Run an automated audit (axe-core / Lighthouse) in CI and fix any flagged issues.

## How to test

- **Keyboard only**: tab through each page; confirm the skip link, visible focus, and that every
  action is operable without a mouse.
- **Screen reader**: verify labels/roles are announced (NVDA/VoiceOver).
- **axe DevTools / Lighthouse**: run on each route; target 0 serious/critical issues.
