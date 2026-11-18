# Employee Appreciation module (design)

18 Nov 2026. The owner pasted a full spec (below) and asked for it to be built and fully tested: Super Admin controls, templates, scheduling, dashboard themes, one-time popups, acceptance, notifications, history, automatic expiry, multiple users and devices, offline, permissions, edge cases. Website and server only; the Android app and extension are paused.

## My calls (the owner chose not to answer questions one by one)
1. **Who manages it:** all administrators, plus anyone given a new **"Appreciation manager"** switch in User Management (like the Training manager switch). The spec's "Super Admin" maps to these.
2. **Who can be appreciated:** active staff accounts (not clients or guests). Managers can only pick people in companies they manage; admins can pick anyone.
3. **The day:** a calendar day in the **company's time zone** (System Settings). It is active 00:00–23:59 that day and expires automatically after.
   - The schedule date can be today or later. Today means it is active at once.
   - A person can have more than one appreciation on the same day. The dashboard shows the newest; the popup shows them one after another.
4. **Templates** (built in, editable copies):
   - Outstanding Performance
   - Great Teamwork
   - Excellent Work
   - Innovation
   - Dedication
   - Employee of the Day
   Each has a title, a message with placeholders `{name}`, `{company}` and `{date}`, a colour theme (brand-safe palette), an icon, and an animation choice: none, confetti burst (once, about 2 s), or a gentle shimmer.
   - Managers can preview, copy, edit, duplicate, save and archive templates.
   - Built-in templates can't be deleted; changing one asks to save it as a copy.
   - Company branding: the company logo and name in the popup and banner.
5. **Sending:**
   - Pick one or more people (searchable, with a company filter), pick a template, edit the message per batch, pick the date, then a Preview, then **Schedule**.
   - Each person gets their own record (one batch id).
   - Scheduled appreciations can be edited or cancelled until they start.
   - **Notification:** a bell notice when it becomes active ("You've been appreciated: Great Teamwork"). There is no email unless the company's email notices are on; then one short email, via the existing notification settings, so people can switch it off.
6. **Employee side, on the day:**
   - The Dashboard gets the template's theme: a coloured header band, an appreciation banner with the message and the sender's name, and the template icon. The rest of the dashboard works as normal.
   - Animation plays once per device per appreciation, and respects reduced motion.
   - **One-time popup** on the first page load of the day: the personalised message, company logo, **Accept Appreciation**.
     - Accepting records the date and time on the server and closes the popup.
     - The popup never shows again on any device; its state comes from the server, not the browser.
     - Closing without accepting shows a small "Accept" button in the banner, and the popup doesn't come back.
   - The theme stays all day after acceptance and goes away by itself at midnight (company time). A page left open swaps back on the next refresh or within about 10 minutes.
   - **Offline:** an accept made offline goes into the existing offline queue and is sent when back online. The UI shows it as accepted at once.
7. **Statuses:** Scheduled · Active · Accepted · Expired (expired without acceptance) · Cancelled.
8. **History:**
   - Managers get **Appreciations** under the Admin group, with tabs Send / Scheduled & history / Templates. History can be filtered by person, status, template and date, and exported to Excel.
   - Employees get **"My appreciations"** in the account menu: their past appreciations with message, date and accepted time.
9. **Audit log:** created, edited, cancelled, activated, accepted, expired, template saved, permission changed.
10. **Not in scope:** the Android app and extension (they ignore it), public sharing, and points or rewards.

## Constraints
- Reuse the users, companies, notifications, offline queue, audit log, the Dashboard and UI components. No new packages; confetti is a small canvas or CSS effect.
- Migration add-only: tables `appreciation_templates`, `appreciations`, and a user permission flag.
- Never `isolationLevel`. Save-retry layer. DB tests on MySQL and MariaDB.
- The Dashboard must be unchanged for everyone without an active appreciation.
- Demo names only (Contoso, Fabrikam, Northwind).

## Proof (the owner's test list)
- Unit and DB tests: permissions, the company scope, scheduling in company time, activation and expiry at the day's edges (23:59, 00:00, a different time zone), a double accept, an accept after expiry refused, cancellation, edit before start only, several on one day, templates (built-ins protected, duplicate, placeholders).
- Browser e2e: manager sends to 3 people → each sees the theme, banner and popup once; accept on desktop → the popup doesn't show on a second "phone" session; offline accept syncs; expiry restores the dashboard; employees can't reach the management pages; the history shows correct statuses; notifications; the audit log.
- Screens at 1440 and 375, light and dark, axe clean, 44 px, no layout shift on the normal Dashboard.
- The full suites, a fresh reviewer, the full battery (the existing dashboard checks unchanged), el-check, and an upgrade rehearsal from live data. Ships as a release after 1.23.38.

## Owner's spec
(Pasted in chat on 18 Nov; summarised above: management, employee experience, templates, additional features, lightweight and integrated.)
