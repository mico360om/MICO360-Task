# Upload folders by company / date / person / type (short design)

18 Nov 2026. The owner asked for a folder layout on every upload. Scope chosen: **all MICO360 Tasks uploads**.

## Layout
`<companyId | shared>/<YYYY>/<MM>/<uploaderUserId>/<type>/<uuid>.<ext>`
- **Year and month** come from the upload date (UTC).
- **Name:** a random UUID plus the original extension, so names never collide.
- **Types:** `task-files`, `chat-files`, `meeting-files`, `decision-files`, `inspection-photos`, `signatures`, `profile-photos`, `project-pictures`, `company-logos`, `learning-hub`.
- **Company:** the company of the task, chat, project, meeting or inspection the file belongs to.
- **`shared`:** for profile photos, site-wide Learning Hub files and the site logo, which belong to no single company.
- **Stable ids:** database ids, never names.

## Access
- Every download is checked as today (signed links from 1.23.31: you must still be able to see that task, chat or project).
- **New:** the company in the path must be one the person may see. Admins may see all.
- The path is never trusted on its own; the database row decides.

## Moving the existing files
- **A one-time step at start-up, resumable, under a job lock:**
  - copy each file to its new path and check that the size and checksum match;
  - update its database row;
  - record `old key → new key` in a new add-only table `file_key_aliases`.
- **Old links keep working:** `/uploads/<old key>` is looked up through the alias, then the same access check runs. This covers emails, PDFs and anything bookmarked.
- **Originals:** kept for 30 days after the move, then removed by a sweep. A file that fails to copy stays where it is and goes to the Error log.
- **Nothing is deleted** before its new copy is verified.

## Proof
- **Tests:**
  - path building for every type;
  - the company and access checks;
  - an old link through the alias;
  - the move being resumable;
  - a missing file;
  - same size and checksum.
- **Rehearsal** on a copy of live-like data, on MySQL and MariaDB, with a check after the move:
  - previews, downloads, the PDF and Excel reports with pictures, email logos, profile photos and Learning Hub pictures all work;
  - old links work;
  - file counts and checksums match.
- **Then:** suites, a fresh reviewer, the battery, el-check. Ships after 1.23.37 as **1.23.39**.
- The Android app and extension need no change; they use the URLs the server gives them.
