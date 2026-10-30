# Nightly backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every night the server makes one archive of the whole database plus the uploaded files, keeps 7 nightly + 4 weekly copies on disk (and in the owner's Google Drive), lets administrators download them from System Settings, and ships a tested restore tool.

**Architecture:** A new backend module `src/modules/backups/` built from small pure pieces (tar, encryption, retention, schedule) around two streaming library functions (`writeBackupArchive`, `restoreBackup`) that talk SQL through Prisma raw queries. A `BackupService` runs copies (nightly sweep in `server.ts` + "Back up now"), applies retention locally and on Drive, and emails admins on failure. Admin-only routes feed one new System Settings section component.

**Tech Stack:** Fastify 5, Prisma 5 (raw SQL), MySQL 8 / MariaDB, node:zlib, node:crypto, fetch (Google OAuth + Drive v3 REST), React 18 + React Query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-30-nightly-backups-design.md` (binding).

## Global Constraints

- Ships in 1.19.0 (server + web, web-only release). No version bumps in this branch; CHANGELOG under `## [Unreleased]`.
- Works on Hostinger Node.js hosting (Git deploy, `server.mjs`, maybe MariaDB, no `mysqldump`) and the Windows server package (`node.exe`, no npm, `config\server.env`).
- No external dump tools; dump in Node. Stream; never hold the whole DB or all files in memory; yield between batches.
- `BACKUP_DIR` (env), default `backups` beside `UPLOAD_DIR`; never under `UPLOAD_DIR`/`WEB_ROOT`, never served.
- Keep 7 nightly + 4 weekly; delete older copies on the server AND in Google Drive.
- No restore button. Restore tool: named database, refuse non-empty unless `--force`, migrations up to the backup's (refuse if the app is older), FK-safe order, files into a given folder, verify counts/checksums.
- Google: OAuth 2.0, scope `https://www.googleapis.com/auth/drive.file` only, folder "MICO360 Tasks backups", refresh token encrypted at rest, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from env.
- Admin-only API; downloads streamed and audit-logged.
- UI: plain short English, `components/ui/*`, colour tokens, 44px touch targets on coarse pointers (`[@media(pointer:coarse)]:!min-h-11`); SystemSettingsPage change = one inserted component from its own file.

## Rulings (calls the spec left to the builder)

1. **Ruling: archive format** — `.tar.gz`: our own ~150-line ustar/PAX tar writer + reader (`tar.ts`), gzip by node:zlib. Entries in order: `manifest.json` (format v1, app version, applied migrations, created-at, per-table columns/row count/sha256, file count/bytes), `database/<table>.jsonl` in FK-safe order (one JSON array of column values per row: datetimes `DATE_FORMAT(…%f)`, blobs `TO_BASE64`, doubles as JS numbers, everything else `CAST(… AS CHAR)`, NULL as null), `files/<path>` (everything under UPLOAD_DIR), `files-index.json` last (path, size, sha256). Unencrypted copies open in 7-Zip/Windows `tar`. *Cost if wrong:* low — the format is versioned; the tool can read old versions.
2. **Ruling: encryption** — supported, **opt-in**: when `BACKUP_ENCRYPTION_KEY` (16+ characters) is set, copies are `.tar.gz.enc` (chunked AES-256-GCM, 1 MiB chunks, key from scrypt N=2^15, truncation-proof final-chunk flag). Off by default because a lost key makes every copy useless and a key kept only on the server is lost with it. System Settings says whether copies are encrypted; BACKUPS.md explains keeping the key in two places off the server. *Cost if wrong:* an unencrypted downloaded/Drive copy is readable by whoever gets the file (bcrypt password hashes, hashed tokens; AI keys and the Drive token stay sealed with SECRETS_ENCRYPTION_KEY). Turning it on later = one setting + restart.
3. **Ruling: secrets** — the Google refresh token is sealed with the existing secret box (`secretBoxFromEnv`, AES-256-GCM, SECRETS_ENCRYPTION_KEY or JWT-derived) in `system_settings` key `backups.googleDrive` (hidden from the generic settings API, like `ai.config`). Client id/secret only in env.
4. **Ruling: dependencies** — none added (fetch for Google, own tar, node:zlib/crypto). `googleapis` (~100 MB installed) is not justified for ~8 REST calls.
5. **Ruling: consistency** — the database is read inside one REPEATABLE READ transaction (a consistent snapshot, like `mysqldump --single-transaction`), table files first written to a work folder inside BACKUP_DIR, then the archive; files after the database (so every file a row points to is there).
6. **Ruling: restore loading** — tables load in FK-safe order *and* with `FOREIGN_KEY_CHECKS=0` inside each table's transaction (tasks, comments and chat replies point at rows of their own table). `_prisma_migrations` is never loaded: `prisma migrate deploy` recreates it from a temporary folder holding exactly the backup's applied migrations; the names are compared. Verification re-reads every restored table the same way and compares row counts and sha256 with the manifest, and every file's sha256 with the index.
7. **Ruling: the documented restore** is side-by-side: restore into a NEW database and a NEW files folder, check, then point `DATABASE_URL`/`UPLOAD_DIR` at them and restart. The live data is untouched until the switch; `--force` only to reuse a database, `--force-files` (separately) only to write into a folder that holds files. A restore that fails after it began changing the target says the database (and folder) now hold only part of the copy.
8. **Ruling: retention** — company-calendar based, over the *nightly* copies: one per company date (the newest), the newest 7 dates = nightly; then the last copy of each of the 4 newest company weeks (System Settings week start) before those = weekly; everything else deleted. **"Back up now" copies are kept on top (the 3 newest)** and never push out a nightly one — found in the real run: one-per-day would have let a "Back up now" pressed *after* a mistake delete that morning's good copy. The same function runs on Drive's own file list (only files carrying our `appProperties.mico360Backup`), so Drive heals itself even if the database was restored. Failed-run rows are pruned after 30 days.
9. **Ruling: schedule** — 02:00 company time, checked every 10 minutes under `runExclusive(jobLock, 'nightly-backup', …)`. Due when: company time ≥ 02:00, no successful nightly copy today, fewer than 3 attempts today, the last attempt ended 60+ minutes ago. A server that was off at 02:00 makes it as soon as it is back the same day. *Amended after review:* `BACKUP_NIGHTLY` blank = on only with `NODE_ENV=production` (the Hostinger site and the Windows server both run that way); `true` / `false` decide outright. Dev/QA/test servers make no nightly copies.
10. **Ruling: one backup at a time** — a `job_locks` row `backup-run` with a 5-minute lease renewed every minute while the run lasts, released when it ends; "Back up now" during a run → 409. A RUNNING row older than 10 minutes while nothing holds the lock is marked "stopped before it finished". *Amended after review:* a run has a 3-hour limit — then it is stopped (AbortSignal), marked FAILED, and the lease is no longer renewed.
11. **Ruling: failure email** — to active admins (alert template) when the day's last nightly attempt fails — *also when it was cut short by a server stop and marked failed later (reconcile)* — or when a nightly copy can't be sent to Drive; and once when the "no new copy for 36 hours" warning first appears (mark `backups.noCopyAlert` in system_settings; again only after a newer good copy). "Back up now" failures are shown on screen only. No email set up → shown in System Settings only.
12. **Ruling: downloads** — `POST /backups/:id/download-link` (admin, audited) returns a 2-minute single-use signed link; `GET /backups/download?token=…` streams the file (big copies never pass through browser memory) and audits the download; it re-checks that the person is still an active admin.
13. **Ruling: the downloads folder (APK) is not backed up** — it is in every release package.
14. **Ruling: folder safety** — refuse to back up when BACKUP_DIR is inside UPLOAD_DIR, WEB_ROOT or the email assets folder; inside the app folder it is refused in production and warned about elsewhere (*amended after review*; `.gitignore` and the Hostinger package also leave out the backend's `backups/`, `*.tar.gz(.enc)(.partial)` and `.work-*`). Free space via `fs.statfs`: needs (uploads + database size) × 1.2 + 50 MB; disk-full errors (ENOSPC/EDQUOT) become "The server's disk is full."
15. **Ruling: Google URLs** — injectable in code for tests; `BACKUP_GOOGLE_TEST_BASE_URL` is honoured only when `NODE_ENV` ≠ production (browser checks against the local fake). Redirect URI `${API_BASE_URL}/api/v1/backups/google/callback`, overridable with `GOOGLE_REDIRECT_URI`. OAuth `state` = HMAC-signed (admin id, 10-minute expiry, nonce), single use.

## Review Focus

1. **The app writes while a backup runs** → the copy is still one consistent moment (snapshot transaction; Task 2 round-trip test inserts rows during the dump and checks they are absent).
2. **Arabic / emoji text, NULL vs empty string, JSON, blobs, doubles, 3-digit milliseconds** must restore identically → Task 2 seed covers each type; compared with MySQL `CHECKSUM TABLE` and the tool's own sha256.
3. **File names with spaces/Arabic, nested folders, empty files, files > 1 chunk** → Task 1 tar tests + Task 2 round trip byte-for-byte.
4. **Disk full / backup folder unwritable / folder inside uploads** → clear plain reason, no half-written copy left listed (Task 3 tests: `.partial` removed, row FAILED with the plain reason).
5. **Google token revoked / Drive folder deleted / upload interrupted mid-way** → reconnect message, folder re-created, upload resumes from the server's offset (Task 4 tests against the fake).

---

### Task 1: Pure building blocks — tar, encryption, retention, schedule

**Files:**
- Create: `Web Portal/backend/src/modules/backups/tar.ts`, `backup-crypto.ts`, `retention.ts`, `nightly-schedule.ts` (+ `*.test.ts` beside each)

**Interfaces (Produces):**
- `createTarWriter(out: Writable): { addBuffer(name: string, data: Buffer, mtime?: Date): Promise<void>; addStream(name: string, size: number, src: Readable, mtime?: Date): Promise<{ sha256: string; written: number }>; finish(): Promise<void> }` — PAX `path`/`size` records for names that are non-ASCII or > 100 bytes; short reads padded with zeros.
- `readTar(src: Readable): AsyncIterable<{ name: string; size: number; body: Readable }>` (each body must be consumed or `resume()`d before the next).
- `encryptStream(passphrase: string): Transform`, `decryptStream(passphrase: string): Transform`, `isEncryptedHeader(first: Buffer): boolean`, `BackupKeyError`.
- `planRetention(copies: { id: string; createdAt: Date }[], opts: { timeZone: string; weekStart: 0|1|6; nightly?: 7; weekly?: 4 }): { keep: Map<string, 'nightly'|'weekly'>; remove: string[] }`.
- `nightlyDue(input: { now: Date; timeZone: string; hour: number; today: { status: 'RUNNING'|'OK'|'FAILED'; startedAt: Date; finishedAt: Date|null }[] }): boolean`; `MAX_NIGHTLY_ATTEMPTS = 3`.

- [ ] Tests: tar round trip (short name, 150-char name, `مرفق جديد.pdf`, empty file, 3 MiB file, `addStream` short read padded), output readable by the system `tar -tzf` when present (skip otherwise); crypto round trip (0 bytes, exactly 1 MiB, 2.5 MiB), wrong key → `BackupKeyError`, flipped byte → error, truncated at a chunk boundary → error; retention with a fake clock: 60 daily copies → keeps 11 (7 nightly dates + last copy of 4 weeks), two copies one day → newest kept, Monday/Saturday week starts, gaps (server off a week); schedule: 01:59 no, 02:00 yes, OK today → no, 3 failures → no, failure 30 min ago → no, RUNNING → no.
- [ ] Run `npx vitest run src/modules/backups` → FAIL, implement, → PASS. Commit.

### Task 2: Dump, archive, restore + the DB round-trip test

**Files:**
- Create: `src/modules/backups/sql-runner.ts` (Prisma adapter), `db-dump.ts`, `backup-archive.ts`, `restore.ts`, `backup-errors.ts`
- Test: `src/modules/backups/db-dump.test.ts` (pure query builders, FK ordering), `tests/integration/backup-round-trip.test.ts`

**Interfaces (Produces):**
- `SqlRunner { query<T>(sql: string, ...p: unknown[]): Promise<T[]>; execute(sql: string, ...p: unknown[]): Promise<number>; transaction<T>(fn: (tx: SqlRunner) => Promise<T>, opts?: { snapshot?: boolean }): Promise<T> }`, `prismaSqlRunner(prisma: PrismaClient): SqlRunner`.
- `listTables(sql): Promise<TableInfo[]>` (`{ name, columns: { name, type }[], primaryKey: string[] }`), `fkSafeOrder(tables, fks)`, `dumpRows(sql, table, batch = 500): AsyncIterable<unknown[]>`, `insertRows(sql, table, rows)`.
- `writeBackupArchive(opts: { sql: SqlRunner; uploadDir: string; outFile: string; workDir: string; appVersion: string; trigger: 'nightly'|'manual'; encryptionKey?: string; pauseMs?: number; now?: () => Date }): Promise<ArchiveResult>` — `ArchiveResult = { sizeBytes, sha256, md5, tables, rows, files, fileBytes, migration }`; writes `<outFile>.partial` then renames.
- `readManifest(file, key?)`, `restoreBackup(opts: { file: string; key?: string; targetUrl: string; filesInto?: string; force?: boolean; migrationsDir: string; prismaCli: string; schemaFile: string; log?: (line: string) => void }): Promise<RestoreReport>`; errors are `RestoreError` with plain messages.

- [ ] Integration test (`TEST_DATABASE_URL`; target `<db>_rt`, created and dropped by the test): seed rows covering text (Arabic, emoji, `''` vs NULL), JSON, datetime(3), tinyint, double, mediumblob (inspection signature), self-referencing tasks (recurrence parent), plus an uploads folder (nested, Arabic name, empty, 2 MiB binary); write the archive (also once encrypted); restore into the empty target; expect every table's `COUNT(*)` and `CHECKSUM TABLE` equal to the source (except `_prisma_migrations`, compared by names), files byte-for-byte; a non-empty target without `force` → refused; a manifest naming an unknown migration → refused ("newer version of the app"); rows inserted during the dump are not in the archive.
- [ ] Unit: identifier quoting, keyset query for single and composite keys, FK ordering with a cycle and a self-reference.
- [ ] Run `npm run test:db` → FAIL, implement, → PASS. Commit.

### Task 3: Backup runs — migration, repository, service, sweep, CLIs

**Files:**
- Create: `prisma/migrations/20261030120000_backup_runs/migration.sql`, `src/modules/backups/backup-repository.ts`, `prisma-backup-repository.ts`, `backup-config.ts`, `backup-service.ts` (+ tests), `src/scripts/backup-create.ts`, `src/scripts/backup-restore.ts`
- Modify: `prisma/schema.prisma` (model `BackupRun`, enums), `src/config/env.ts` (+ test), `src/server.ts` (service + 10-minute sweep), `package.json` (`backup:create`, `backup:restore`)

**Interfaces:**
- Model `BackupRun` (`backup_runs`): `id, trigger (NIGHTLY|MANUAL), status (RUNNING|OK|FAILED), localDate varchar(10), startedAt, finishedAt?, fileName?, sizeBytes BigInt?, sha256?, encrypted, error Text?, driveStatus (UPLOADED|FAILED|SKIPPED)?, driveFileId?, driveError Text?, requestedById?, tableCount?, rowCount?, fileCount?`.
- Env: `BACKUP_DIR` (''), `BACKUP_ENCRYPTION_KEY` (''), `BACKUP_NIGHTLY` (true), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (''), `BACKUP_GOOGLE_TEST_BASE_URL` (dev only).
- `resolveBackupDir(env, cwd): string`, `backupDirProblem(dir, { uploadDir, webRoot, assetsDir }): string | null`, `insideAppFolder(dir, cwd): boolean`.
- `createBackupService(deps)` → `{ runNow(by: string): Promise<BackupRunView>; runNightlyIfDue(): Promise<boolean>; overview(): Promise<BackupOverview>; fileFor(id): Promise<{ path, fileName, sizeBytes } | null>; applyRetention(): Promise<void> }`, `plainReason(err: unknown): string`.

- [ ] Tests (in-memory repo + temp folders + a fake archive writer): a run writes a row RUNNING → OK with size/sha; a failure → FAILED with the plain reason and no file left; disk short → "There isn't enough free disk space…"; folder inside uploads → refused; a second run during a run → 409; retention deletes old files and rows, never the tray's `mico360-*.sql`; the third failed nightly attempt emails every active admin once; a failed "Back up now" emails nobody; email not set up → no email, still FAILED; a stale RUNNING row is reported "stopped before it finished".
- [ ] Wire into `server.ts` (`runExclusive(jobLock, 'nightly-backup', 9 min, …)` every 10 minutes + at start). CLIs: `backup-create.ts` (one copy now), `backup-restore.ts <file> --into <db> [--files-into <dir>] [--no-files] [--force] [--key-file <f>] [--env-file <f>] [--url <mysql url>]`.
- [ ] `npm test`, `npm run test:db`, typecheck → PASS. Commit (migration + model, service, wiring/CLIs as separate commits).

### Task 4: Google Drive — client, fake, connection, upload + Drive retention

**Files:**
- Create: `src/modules/backups/google-drive.ts`, `fake-google.ts` (test helper; also used by the browser check), `drive-connection.ts` (+ tests)
- Modify: `backup-service.ts` (upload after each copy, Drive retention, disconnect)

**Interfaces:**
- `googleUrls(base?: string)`, `createGoogleDrive({ clientId, clientSecret, redirectUri, urls, fetch? })` → `{ authUrl(state), exchangeCode(code), refresh(refreshToken), about(token), ensureFolder(token, folderId?), upload(token, { file, name, folderId, appProperties, md5 }), list(token, folderId), remove(token, id), revoke(token) }`; `DriveError { kind: 'auth'|'full'|'network'|'http'; status? }`.
- `createDriveConnectionStore(prisma | repo, box)` → `{ get(): Promise<DriveConnection|null>; save(c); clear(); markProblem(text) }`; `createOAuthState(secret)` → `{ issue(userId): string; verify(state): string | null }`.

- [ ] Tests against `startFakeGoogle()` (real HTTP on 127.0.0.1): code exchange + about → "Connected as"; folder found or created, re-created when deleted; 3 MiB upload in 256 KiB-multiple chunks; a dropped chunk resumes from the server's `Range`; md5 checked; `invalid_grant` → `auth` (stored connection marked "connect again"); `storageQuotaExceeded` → `full`; Drive retention removes only our extra files; state: tampered/expired/reused → rejected.
- [ ] Commit.

### Task 5: Routes

**Files:** Create `src/modules/backups/backup-routes.ts` (+ test). Modify `src/app.ts` (`backups?` dep, register).

**Interfaces:** `GET /backups` (overview), `POST /backups` (Back up now → 202), `POST /backups/:id/download-link` → `{ url }`, `GET /backups/download?token=` (stream, attachment), `GET /backups/google/connect` → `{ url }`, `GET /backups/google/callback` (public; 302 to `${APP_URL}/admin/settings?drive=connected|denied|failed#backups`), `DELETE /backups/google`. Audit actions `backup.create`, `backup.download-link`, `backup.download`, `backup.drive-connect`, `backup.drive-disconnect` (module `backups`).

- [ ] Tests: every route 403 for an employee and 401 signed out (callback excepted); download streams the bytes with `Content-Disposition: attachment`, link works once, expires after 2 minutes, refused when the admin was demoted; audits recorded; callback with bad state → `drive=failed`, `error=access_denied` → `drive=denied`; Google not set up → connect 409 with the plain message.
- [ ] Commit.

### Task 6: Web — System Settings → Backups

**Files:** Create `Web Portal/frontend/src/api/backups.ts`, `src/components/admin/BackupSettings.tsx`, `backup-words.ts` (+ tests). Modify `SystemSettingsPage.tsx` (insert `<BackupSettings />` only).

- [ ] Tests (fetch stubbed): last backup line + size; warning text for a failed night; the kept copies with kind and Drive ✓/✗; "Back up now" → posts, shows "Making a copy…", polls until done; Download → asks for a link and navigates to it; Drive not set up → the one-line note; Connect → navigates to Google's URL; Disconnect asks first; `?drive=connected` → "Google Drive is connected."
- [ ] Commit.

### Task 7: Docs, packages, changelog

- [ ] `docs/BACKUPS.md` (how it works, where, download, Google Drive one-time setup, restore on Hostinger and Windows, the encryption key), DEPLOY-HOSTINGER.md / WINDOWS-SERVER.md / DATA-POLICY.md / DEPLOYMENT.md, `.env.example`, `Installer/1-Hostinger-Web-Server/environment.example.txt` + README, `tools/release/build-release.mjs` (BACKUPS.md into the Hostinger package docs; README texts), CHANGELOG `[Unreleased]` (New features + Security). Commit.

### Task 8: Verification

- [ ] Real run on a populated DB (seeded + `qa-data/small-company.sql`): archive size/time, inspect with `tar -tzvf`, restore into `mico360_t_bk_restore…`, verify; browser check (Back up now → listed → download → employee refused; Drive connect against the fake); both `npm run build`; tsc + eslint both; battery admin groups if touched; stop servers, drop `mico360_t_bk*`, remove test folders.

---

## Review fixes (30 Oct, after the independent review of b6b7279)

Fixed test-first on the branch: (1) U+2028 / U+2029 escaped in rows and table entries split at `\n` bytes only (old copies still restore); (2) a failing output no longer hangs the run — the archive is pulled through `pipeline(Readable.from(generator), …)`, scratch files too, plus the 3-hour run limit; (3) the server trims `BACKUP_ENCRYPTION_KEY`, the restore tool tries the key trimmed then as written; (4) `BACKUP_NIGHTLY` on only in production, a backup folder inside the app refused in production, copies git-ignored and left out of the Hostinger package; (5) a run cut short by a server stop, and 36 hours without a copy, email the admins; (6, part) the kept copies' total size in System Settings and the shared-hosting free-space caveat in BACKUPS.md; (7) a stored Drive connection on a server without Google settings is not "connected" and can be disconnected; (10) `backup.download-link` audited; (11) a resumable upload with no progress gives up; (13) `--force-files` separate from `--force`, and a partial restore says so.

## Known follow-ups (left for later on purpose)

- **8 — `clearLeftovers` in a shared folder.** Before each run the service removes every `mico360-tasks-backup-*.partial` and `.work-*` in BACKUP_DIR. Two servers pointed at one folder (two instances, or a test server sharing a production folder) could delete the other's copy in progress. Fix idea: only clear leftovers whose run id is not RUNNING in this database, or put the server's id in the names.
- **9 — copies orphaned after a restore.** A restored database lists the source server's copies; the files on this server that belong to runs not in the restored `backup_runs` are neither listed nor ever deleted by retention. Fix idea: a retention pass over files with our name pattern and no row, older than the oldest kept copy (with care for files of another server sharing the folder, see 8).
- **12 — the OAuth `state` is not bound to the browser.** It is HMAC-signed, single use, 10 minutes, and names the admin, but isn't tied to a cookie, so a signed `state` leaked within its 10 minutes could finish a connection from another browser. Fix idea: a short-lived HttpOnly cookie with a nonce that the callback compares.
- **14 — dump details.** Tables are read in pages of 500 rows (a table of very wide rows makes big pages; adapt by bytes), and a keyset page over a composite primary key that includes an ENUM column compares the ENUM by its index, not its text (works because the order is the same both ways, but it is fragile). Fix idea: page size by bytes, and `CAST(enum AS CHAR)` in the key comparison or order by the cast.
