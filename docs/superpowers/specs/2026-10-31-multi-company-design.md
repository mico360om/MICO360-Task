# Multi-company management — design

Date: 31 Oct 2026. Owner decisions taken one by one in the question box (31 Oct).
Builds on `feat/android-1-19` (= website/server 1.19.0 + the Android app catch-up + the task-delete rule, released together as 1.20.0); this feature becomes 1.21.0. Publishing is paused (malware on the PC) — build and test locally only.

## 1. Intent

The owner's group runs several companies on one MICO360 Tasks site. The request: "Add Multi-Company Management. Admin can create, edit, and manage multiple companies, logo also. Admin can assign employees access to one or multiple companies. Each project must belong to one or more companies. Employees can only access companies and their associated projects based on assigned permissions. Admin can manage company-wise employees, projects, and access rights. Implement company-based data separation, filtering, and role-based access control across the entire system. Ensure existing data and functionality remain unaffected."

Success: with one company, nobody notices any change. With two or more, every person sees only their companies' projects and colleagues, can narrow every page to one company with a picker, and each company's PDFs/emails/client page carry its own logo, name and time zone.

## 2. Owner decisions

1. **Separate companies on one site, with a switcher.** A company picker in the top bar ("All my companies" or one company) filters every page. Each company has its own name, logo, time zone and week start, used on its PDFs and emails. People see only their companies' projects and colleagues.
2. **Project visibility = company access AND team.** To see a project, a person needs access to at least one of the project's companies AND today's rule (on its team; admins see all). Losing access to a company hides its projects even if still on the team.
3. **Admins see and manage all.** Today's admins (role ADMIN) create/edit companies, see every company's data and assign people to companies. No per-company admin role. Everyone else sees only their companies.
4. **People visibility:** assignee/team pickers, @mentions, new chats and people lists show only colleagues who share at least one company. Existing chats stay readable.
5. **First company = "Prolens Projects LLC".** All of today's projects and people go into it, with today's logo, time zone and settings — nothing changes until a second company is added.
6. **Logo** appears in the company picker and on that company's PDFs (minutes, reports, task, inspection, management), emails and client page. The MICO360 Tasks logo stays in the site's top bar and sign-in page.

Standing rules: one SemVer version for server, web, Android, extension; CHANGELOG via `tools/release/release.mjs`; website words and dates "30 Oct 2026"; publishing paused; the owner rejected time tracking/billing.

## 3. Goals

**Data model and migration**
- `Company` (name, unique short code, logo, time zone, week start, working days and hours, email sender display name, status active/archived), `CompanyMember` (user ↔ company), `ProjectCompany` (project ↔ company, with one marked `isMain`).
- Migration creates "Prolens Projects LLC" from today's company-wide settings (time zone, week start, working hours, logo if one exists in settings) and links EVERY existing user and project to it (projects: main). Existing behaviour is identical afterwards.
- Every project must have ≥1 company; every active user should have ≥1 company (admins: optional — they see all regardless).

**Access control (server, everywhere)**
- One access rule module: `companiesOf(user)`; `canSeeProject(user, project)` = admin OR (shares a company with the project AND today's project rule). All server paths that list or open projects/tasks/meetings/inspections/templates-usage/reports/management/timeline/workload/calendar/search/activity/notifications/chat-rooms/MICO AI tools/daily & weekly emails/client view admin/exports go through it. No endpoint may return another company's data to a non-admin.
- People visibility: user lists, directory, mentionable, assignee candidates, chat new-conversation search return only people sharing a company (admins: everyone). Existing chat conversations remain readable by their members.
- Notifications/emails: a person is never notified about a project they can no longer see.
- Losing company access takes effect at once (server checks on every request).

**Company picker and filtering (website, Android app, Chrome extension)**
- Top-bar picker: "All my companies" + each company the person can access (admins: all). Remembered per person per device. Shown only when the person has ≥2 companies.
- Every page and count follows the picker: Dashboard tiles, My Tasks, boards (incl. All projects board), Projects, Calendar, Timeline, Workload, Meetings, My Action Items, Reports, Management (+PDF + weekly email scope per person), Activity, Notifications (filter by project's company), Search, MICO AI (answers use only the picked companies' data), templates list (see §7).
- New project form: Companies field (multi-select, ≥1, main company first; default = the picker's company, or the person's only company). Project page shows its companies.

**Admin pages**
- Companies page (System → Companies): list, create, edit (name, code, logo upload, time zone, week start, working days/hours, sender name), archive (an archived company's projects become read-only/hidden like archived projects; can't archive the last active company).
- User Management: companies per person (multi-select), filter users by company, bulk assign.
- Per company: its people and projects (counts + links), add/remove people.
- Audit log entries for every company and access change.

**Branding per company**
- PDFs (minutes, reports, task, inspection report, management), emails (invitations, minutes, daily/weekly, welcome, client invitations) and the client page use the project's MAIN company's logo, name and time zone; site-wide emails without a project (welcome, sign-in code) use the person's first company (or the site default).
- Time zone and week start: a project's dates/days use its main company's settings; a person's own time zone/week start still override where they do today.

## 4. Non-goals / anti-goals
- No per-company admin role, no separate databases, no separate sign-in per company, no per-company AI/backup/email-server settings, no billing.
- Anti-goals: any non-admin seeing another company's project, task, meeting, person, file, report figure or AI answer; any existing data or behaviour changing for a single-company site; a person losing access to their own existing chats; mixed figures that don't match the picked scope.

## 5. Constraints
- Server: Fastify + Prisma + MySQL; one migration (with the default company backfill) rehearsed on a copy of a populated DB; `prisma migrate deploy` runs on deploy.
- Clients: website (React), Android app (Expo) — copies of shared rules with drift tests as today — and the Chrome extension.
- TDD; reviews per stage; the browser battery (scratchpad t1181) must stay green; new e2e for the access matrix.

## 6. Left to the builder
Exact table/column names; where the picker state lives; how list endpoints take a `companyId` filter (query param vs header); PDF/email template mechanics; staging into stages/lanes.

## 7. My calls (owner can overrule)
- Per company: name, code, logo, time zone, week start, working days and hours (meetings + Workload), email sender display name. Site-wide: AI, backups, email service keys, security settings, morning-email time, daily workload limit.
- A project in several companies has one MAIN company (first picked, changeable) whose branding/time zone it uses.
- Templates and inspection forms stay shared across all companies (optionally an admin can limit one to some companies); creating a project from a template asks for its companies.
- The picker appears only for people with 2+ companies; with one company nothing changes visually.
- 1.21.0, released after 1.20.0 when the PC is clean.

## 8. After the builder check (owner answers 31 Oct + my calls)

**Owner answers**
7. **Shared projects: the whole team works together.** Inside a project that belongs to several companies, everyone on its team sees, assigns, @mentions, watches and comments with each other, and its team can include people from ANY of the project's companies. Outside projects (people lists, new chats, directory search), people still only see colleagues who share a company. Author names in history/comments/chat always show (names of people you can't otherwise see are still printed where they wrote something you can see).
8. **Meetings: an invitation lets them in.** Being invited is a deliberate exception: an invitee without access to the project's companies sees that one meeting, its approved minutes and their own action items — nothing else of the project. Invite pickers offer only colleagues who share one of the project's companies (plus outside guests by email, as today).

**My calls (owner can overrule)**
- **Meetings without a project** get a Company (picked on the meeting form; default = the picker's company); visible as today (organizer + invitees) and filtered by the picker by that company.
- **Recurring emails:** ONE daily task email and ONE weekly management summary per person, covering all their companies, grouped by company. Branding, time zone and week start come from the person's **primary company** (new per-person setting in User Management; default = the first company they were added to; migration sets Prolens Projects LLC). "Weekly email scope per person" in §3 = the companies the person can see (no separate choice).
- **Archiving a company** is worked out, not written onto projects: a project counts as archived when its own status is ARCHIVED or ALL its companies are archived (read-only/hidden like archived projects today; a single helper replaces the `status !== 'ARCHIVED'` checks). People whose companies are all archived can still sign in and see an empty state ("Your company is archived — ask an administrator"); admins are unaffected; the last active company can't be archived; unarchive restores everything.
- **Changing a project's companies / main company:** admins, and the people who run the project limited to companies they belong to themselves; a project keeps ≥1 company; every change is in the audit log and the project's history.
- **Direct chats** with someone you no longer share a company with become read-only with a note ("You no longer share a company with Sara"); project chat channels follow the project rule.
- Departments stay shared; templates' optional company limit is built later (shared for now); a company with no logo uploaded uses today's built-in logo.

## 9. After the plans (owner answer 31 Oct)
9. **Time zones: all companies are in Oman for now.** Companies keep the SITE's time zone (Asia/Muscat); no per-company time zone is built now (a later addition if a company abroad joins). Each company still has its own name, logo, week start and working days/hours, and email sender name. Planner's calls accepted: default company code `PPL`; company settings inherit the site's values until set; the company NAME appears on emails/PDFs only when 2+ active companies exist (logo and sender name whenever set); archived companies give no access; the invitation exception excludes live notes/decisions; a manager can't make a change that hides the project from themselves; templates/tags/project-code check stay shared; Android keeps the Companies page and bulk assign as website links.
