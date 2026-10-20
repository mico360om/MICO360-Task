# Mobile parity — Stage 1: security and bug fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Android app's security and reliability problems found in the gap analysis, with the server changes they need, and release them as 1.2.1 with a signed APK.

**Architecture:** The pure logic goes in `Android App/src/lib/*` with vitest tests. Screens and adapters (expo, react-native) stay thin and are checked on the emulator. The server changes (device tokens, refresh replay, biometric credential) follow the existing auth and device-token module patterns, with memory-store tests.

**Tech Stack:** Expo SDK 51 / React Native / TypeScript / vitest 2 (app). Fastify 5 + Prisma 5 + MySQL / vitest 4 (server).

**Spec:** `docs/superpowers/specs/2026-10-20-mobile-parity-gap-analysis.md` §1 and the small task bugs in §4. The user approved the Stage 1 scope in chat on 2026-10-20; the summary is in memory `mobile-parity.md`.

## Global Constraints

- Work in `D:/mico-release/deploy-repro`, branch `feat/project-dashboard`. Commit with `git -c user.name=mico360om -c user.email=mico360om@gmail.com`.
- Never stage `Web Portal/frontend/src/api/client.ts` or `client.test.ts` (another session's work).
- App tests: run `npm ci` once in `Android App/`, then `npm test`, `npm run typecheck` and `npx eslint src --max-warnings=0`. Tests live next to modules as `src/**/*.test.ts` (`.test.tsx` isn't collected).
- Server: `cd "Web Portal/backend" && npx vitest run <file>`, plus `npx tsc --noEmit -p .`. After a schema change, run `npx prisma generate`, then `prisma migrate deploy` on mico360_audit and mico360_aitest via `scratchpad/db-migrate.mjs`.
- No new dependencies except `expo-screen-capture`, installed with `npx expo install expo-screen-capture` (the SDK 51 version).
- The plain-http rule: https always; http only to private hosts (as `isPrivateHost` defines them, extended in Task 4).
- No password, token or key is ever logged, printed or written to a file.
- User-facing text is plain English and sentence case, matching the existing app wording.

## Review Focus

1. **Refresh replay must stay closed.** A spent refresh token presented after the replay window, after logout, or after a password change or admin reset must not return a successor, and must keep today's reuse handling: revoke the family past the grace window. → Task 2 tests.
2. **Office servers keep working.** An office server on plain http at a private address must still sign in, sync, upload, download exports and open the realtime socket. Any non-private http address must fail with a clear message, not hang. → Task 4 tests and the emulator check in Task 13.
3. **Biometric sign-in must fail safely.** After a password change, an admin reset or 30 days unused, it must not sign in. It must disarm itself and say "Sign in with your password". → Tasks 3 and 8.
4. **A bad time zone must not break the app.** An invalid or unknown zone from the server or the user's settings falls back to Asia/Muscat. A zone change made while the app is open re-renders dates without a restart. → Task 9 tests.
5. **A Wi-Fi sign-in page is not a sign-out.** A captive portal's HTML 200 on an authenticated GET falls back to the cache, never calls `onUnauthorized` and never signs out. A queued write stays queued. → Task 5 tests.

---

### Task 1: Server — drop a user's phones when their access is revoked

**Files:**
- Modify: `Web Portal/backend/src/modules/device-tokens/device-token-repository.ts` (interface, memory repo), `prisma-device-token-repository.ts`
- Modify: `Web Portal/backend/src/modules/users/user-service.ts` (`revokeAccess`), `Web Portal/backend/src/modules/auth/password-reset-service.ts` (`resetPassword`), `Web Portal/backend/src/server.ts` (wiring)
- Test: `device-token-service.test.ts`, `users/user-service.test.ts`, `auth/password-reset-service.test.ts`

**Interfaces:**
- Produces: `DeviceTokenRepository.deleteForUser(userId: string): Promise<number>`.
- Produces: an optional dependency `forgetDevices?: (userId: string) => Promise<void>` on both `createUserService` and `createPasswordResetService`.

- [ ] **Step 1: Write the failing tests.**
  - `user-service.test.ts` — "an admin password reset, a role change, disabling and deleting forget the user's phones": `forgetDevices` is called with the id for each.
  - Same file — "changing your own password keeps your phones": `forgetDevices` is not called. The other phones sign out on their next refresh and turn push off themselves (Task 6).
  - `password-reset-service.test.ts` — "resetting a password by email link forgets the user's phones".
  - Repository test — "`deleteForUser` removes only that user's tokens and returns the count".
- [ ] **Step 2: Run them; expect failures** (no `forgetDevices`, no `deleteForUser`).
- [ ] **Step 3: Implement.**
  - Repository: `deleteForUser` is `deleteMany({ where: { userId } })` in Prisma, and a filter in the memory repo.
  - `revokeAccess(id, socketsAfterMs, opts?: { keepDevices?: boolean })`: `changeOwnPassword` passes `keepDevices: true`; every other caller forgets the devices after `revokeSessions`.
  - `resetPassword` calls `forgetDevices` after `revokeSessions`.
  - `server.ts`: wire `forgetDevices: (id) => deviceTokenRepo.deleteForUser(id).then(() => undefined)` into both services.
- [ ] **Step 4: Run the tests; expect PASS.** Also run `npx tsc --noEmit -p .`.
- [ ] **Step 5: Commit** — `fix(push): forget a user's phones when their access is revoked`.

### Task 2: Server — a lost refresh reply can be retried

**Files:**
- Modify: `Web Portal/backend/prisma/schema.prisma` (`RefreshToken.successorEnc String? @db.Text`)
- Create: migration `prisma/migrations/20261020120000_refresh_successor/migration.sql` (`ALTER TABLE refresh_tokens ADD COLUMN successorEnc TEXT NULL;`)
- Modify: `modules/auth/token-service.ts`, `prisma-refresh-token-store.ts`, `memory-refresh-token-store.ts`, `auth-routes.ts` (`/auth/refresh`), `server.ts` (pass the secret box)
- Test: `token-service.test.ts`, `auth-routes.test.ts`

**Interfaces:**
- `RotateResult` `'reused'` variant gains `successorEnc: string | null`.
- `RefreshTokenStore.setSuccessor?(tokenHash: string, successorEnc: string): Promise<void>`.
- `createTokenService` deps gain:
  - `box?: { encrypt(s: string): string; decrypt(s: string): string }` (the app's `secretBoxFromEnv(env)`);
  - `replayWindowMs?: number`, default `120_000`.
- `RefreshOutcome` ok variant gains `replay?: { refreshToken: string }`.
- `tokenService.recordSuccessor(spentToken: string, successorRefreshToken: string): Promise<void>`.
- `tokenService.issueAccessToken(user: TokenUser): string` — an access token alone, for a replayed refresh.

- [ ] **Step 1: Write the failing tests** in `token-service.test.ts`, with `makeRotating` and the clock.
  - "a token spent by rotation, presented again within 2 minutes, returns the same successor and revokes nothing": rotate t0, then `issueTokens` plus `recordSuccessor(t0, t1)`; at +30 s `rotateRefreshToken(t0)` gives `{ ok: true, replay: { refreshToken: t1 } }`, and t1 is still valid.
  - "after the replay window it is reuse and the family is revoked": at +3 min the result is `{ ok: false, reason: 'reused' }`, and t1 is no longer valid.
  - "a logged-out token never replays": `revokeRefreshToken(t0)` with no successor, at +30 s, gives superseded or reused, never ok.
  - "a successor that was itself rotated or revoked (password change) is not replayed": after `revokeAllForUser`, t0 at +30 s is not ok.
  - "without a box nothing is recorded and behaviour is unchanged".
  - In `auth-routes.test.ts`: "a retried `/auth/refresh` returns the same refresh token and a fresh access token".
- [ ] **Step 2: Run them; expect failures.**
- [ ] **Step 3: Implement.**
  - `rotate` selects `successorEnc`.
  - `rotateRefreshToken`, for `'reused'`: if `box` is set, `successorEnc` is set, the reuse is within `replayWindowMs`, and `findValid(hash(decrypt(successorEnc)))` is live with the same `userId` → return `{ ok: true, userId, familyId, replay: { refreshToken } }`. Otherwise keep today's grace and reuse logic.
  - The `/auth/refresh` route:
    - on `replay`, returns `{ user, accessToken: <new access token>, refreshToken: replay.refreshToken }`, issuing the access token through a new `issueAccessToken(user)`;
    - otherwise it issues tokens and then calls `recordSuccessor(refreshToken, tokens.refreshToken)`.
- [ ] **Step 4: Migrate the test databases** (`node scratchpad/db-migrate.mjs mico360_audit --deploy --diff`, the same for aitest; expect "no drift"). Run the tests; expect PASS. Run tsc.
- [ ] **Step 5: Commit** — `fix(auth): a lost refresh reply can be retried without signing out`.

### Task 3: Server — a separate sign-in key for biometric sign-in

**Files:**
- Modify: `modules/auth/auth-routes.ts`
- Test: `auth-routes.test.ts`

**Interfaces:**
- Produces: `POST /api/v1/auth/biometric-credential`. It needs authentication and returns `201 { data: { refreshToken } }`, a refresh token in a **new** rotation family.

- [ ] **Step 1: Write the failing tests.**
  - "a signed-in user gets a refresh token of its own family that signs in once and rotates".
  - "a signed-out request is refused".
  - "the key stops working after `revokeAllForUser`".
- [ ] **Step 2: Run them; expect failures.**
- [ ] **Step 3: Implement** the handler: `getUserForSession(req.user.id)`, then `issueTokens(user)` with no `familyId`; return only `refreshToken`.
- [ ] **Step 4: Run the tests; expect PASS.**
- [ ] **Step 5: Commit** — `feat(auth): a biometric sign-in key separate from the session`.

### Task 4: App — plain http only to private addresses

**Files:**
- Modify: `Android App/src/lib/server-address.ts`, `src/lib/api-client.ts` (`send`, XHR upload), `src/core/services.ts` (refresh/logout fetch), `src/core/authed-socket.ts`, `src/lib/exporter.ts`, `src/lib/config.ts` (`resolveApiBaseUrl`)
- Test: `server-address.test.ts`, `api-client.test.ts`, `config.test.ts` (or the existing `app-env`/`app-config` tests)

**Interfaces:**
- Produces in `server-address.ts`:
  - `isAllowedUrl(url: string): boolean`
  - `assertAllowedUrl(url: string): void`, which throws `InsecureAddressError`
  - `class InsecureAddressError extends Error { name = 'InsecureAddressError' }` with the message "This server address isn’t secure. Use an https:// address, or an office server on your local network."
- `isPrivateHost` also accepts `169.254.0.0/16`, `::1`, `[::1]`, `fc00::/7` (`fc..`/`fd..`) and `fe80::/10`.

- [ ] **Step 1: Write the failing tests.**
  - `isAllowedUrl`:
    - true for `https://task.mico360.com/api/v1`, `http://192.168.1.5:4000/api/v1`, `http://10.0.2.2:4000` and `http://[fd00::5]:4000`;
    - false for `http://task.mico360.com/api/v1`, `http://8.8.8.8` and `ftp://x`.
  - api-client: "refuses an http request to a public host without calling fetch, with InsecureAddressError".
  - config: "a build default on public http is refused (falls back to `DEFAULT_API_BASE` only for development)". Use the existing flavor-test style.
- [ ] **Step 2: Run them; expect failures.**
- [ ] **Step 3: Implement.** Call `assertAllowedUrl(url)` before every fetch or XHR in `send`, before the raw refresh and logout fetches, before `io(origin…)` and before `FileSystem.downloadAsync`. `resolveApiBaseUrl` refuses a disallowed value.
  - Leave `Linking.openURL` targets (meeting links, the browser) alone: they carry no token.
- [ ] **Step 4: Run the tests; expect PASS.**
- [ ] **Step 5: Commit** — `fix(security): plain http only to office (private) addresses`.

### Task 5: App — a Wi-Fi sign-in page is treated as offline

**Files:**
- Modify: `src/lib/api-client.ts` (around line 245, the 2xx JSON parse)
- Test: `api-client.test.ts`, `read-cache.test.ts`

**Interfaces:**
- A 2xx response whose body isn't JSON throws `new NetworkError('The network returned a web page instead of data — you may need to sign in to the Wi-Fi.')`.

- [ ] **Step 1: Write the failing tests.**
  - "an HTML 200 is a NetworkError, not a SyntaxError, and doesn't call `onUnauthorized`".
  - In the read cache: "falls back to the cache on that error".
- [ ] **Step 2: Run them; expect failures. Step 3: implement. Step 4: run them; expect PASS.**
- [ ] **Step 5: Commit** — `fix(offline): a captive-portal page no longer breaks offline mode`.

### Task 6: App — push stops on every sign-out; exports and the app lock reset

**Files:**
- Modify:
  - `src/adapters/push.ts` (`deactivatePush`);
  - `src/lib/push-registrar.ts` (`forget()`);
  - `src/lib/sign-out.ts` (new dependencies);
  - `src/adapters/files.ts` and `src/lib/exporter.ts` (`clearAll`);
  - `src/lib/biometric-gate.ts` (`reset()`);
  - `src/core/services.ts` (wiring).
- Test: `sign-out.test.ts`, `push-registrar.test.ts`, `exporter.test.ts`

**Interfaces:**
- `deactivatePush(): Promise<void>` calls `Notifications.unregisterForNotificationsAsync()`.
- `PushRegistrar.forget(): Promise<void>` deletes `PUSH_TOKEN_KEY` locally only.
- `ExportFiles.clearAll(): Promise<void>` deletes `cacheDirectory + 'exports/'`.
- `SignOutDeps` gains `deactivatePush(): Promise<void>`, `clearExports(): Promise<void>` and `resetAppLock(): Promise<void>`.

- [ ] **Step 1: Write the failing tests in `sign-out.test.ts`.**
  - "every sign-out (user, lock, expired) turns push off on the phone and forgets the local push token, after the server unregister when there is one".
  - "every sign-out clears exported files".
  - "signing out (user) resets the app lock; expired and lock keep it for the same person".
  - "a failing step doesn't stop the others" (extend the existing one).
- [ ] **Step 2: Run them; expect failures. Step 3: implement and wire. Step 4: run them; expect PASS.**
- [ ] **Step 5: Commit** — `fix(push): a signed-out phone stops receiving notifications`.

### Task 7: App — refresh retried after a lost reply

**Files:**
- Create: `src/lib/refresh-retry.ts`, `src/lib/refresh-retry.test.ts`
- Modify: `src/core/services.ts` (the refresh closure, lines 82-123)

**Interfaces:**
- Produces: `refreshWithRetry<T extends 'ok' | 'invalid' | 'transient'>(attempt: () => Promise<T>, opts?: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<T>`.
  - Defaults: `retries: 1`, `delayMs: 1500`.
  - The three outcomes are the ones the refresh closure in `services.ts` returns today (the server's `RefreshOutcome` is a different type).

- [ ] **Step 1: Write the failing tests.**
  - "a transient failure is retried once after 1.5 s, and its ok is returned".
  - "invalid is never retried".
  - "two transients return transient".
- [ ] **Step 2: Run them; expect failures. Step 3: implement, and use it in `services.ts`. Step 4: run them; expect PASS.**
- [ ] **Step 5: Commit** — `fix(auth): retry a refresh whose reply was lost`.

### Task 8: App — biometric sign-in that works

**Files:**
- Modify:
  - `src/lib/biometric-login.ts`;
  - `src/lib/sign-out.ts`, which no longer disarms;
  - `src/lib/resources.ts` or `lib/auth.ts`, for `biometricCredential()`;
  - `src/screens/SettingsScreen.tsx` (`toggleBiometric`);
  - `src/screens/auth/LoginScreen.tsx` (`signInWithBiometrics` and the password sign-in);
  - `src/adapters/secure-store.ts`.
- Test: `biometric-login.test.ts`, `sign-out.test.ts`

**Interfaces:**
- `auth.biometricCredential(): Promise<string>` calls `POST /auth/biometric-credential`.
- `createBiometricLogin({ store })`:
  - the credential lives in the normal secure store, not the `requireAuthentication` store;
  - use is gated by `authenticateBiometric()` in the screen;
  - methods: `arm(refreshToken, label, userId)`, `isArmed()`, `getLabel()`, `getUserId()`, `getCredential()`, `replace(refreshToken)`, `disarm()`;
  - `purgeLegacy()` removes the old `requireAuthentication` item.

**Flows:**
- **Turning it on:** the biometric prompt, then `auth.biometricCredential()`, then `arm`.
- **Turning it off:** `auth.logout(credential)`, then `disarm`.
- **Signing in with biometrics:**
  1. the biometric prompt;
  2. `getCredential()`;
  3. `auth.refresh(credential)`;
  4. save the session;
  5. `auth.biometricCredential()`;
  6. `replace(newCredential)`.
  - If step 3 is refused (401), `disarm` and show "Sign in with your password — fingerprint sign-in was turned off for this account."
- **Password sign-in as a different user than `getUserId()`:** `disarm` first.

- [ ] **Step 1: Write the failing tests.**
  - `biometric-login.test.ts`:
    - "arm stores the key, label and user id; replace swaps only the key; disarm clears all";
    - "purgeLegacy removes the old item".
  - `sign-out.test.ts`:
    - "no sign-out reason disarms biometric sign-in" (update the existing assertion);
    - the `disarmBiometricLogin` dependency is removed.
- [ ] **Step 2: Run them; expect failures. Step 3: implement. Step 4: run them; expect PASS.**
- [ ] **Step 5: Commit** — `fix(auth): biometric sign-in with its own key`.

### Task 9: App — time zone from the server and from you

**Files:**
- Create: `src/lib/date-settings.ts`, `src/lib/date-settings.test.ts`
- Modify:
  - `src/lib/due-date.ts`;
  - `src/lib/meetings.ts`, `src/lib/task-detail.ts`, `src/screens/BoardScreen.tsx` (the direct `COMPANY_TIMEZONE` uses);
  - `src/lib/resources.ts` (`config()` and `preferences()`);
  - `src/core/providers.tsx`, which loads both after sign-in and on resume.

**Interfaces:**
- `due-date.ts`: `appTimeZone(): string`, `setAppTimeZone(tz: string): void` and `subscribeTimeZone(fn): () => void`. Defaults change from `COMPANY_TIMEZONE` to `appTimeZone()`.
- `date-settings.ts`: `resolveTimeZone({ company?: string | null; own?: string | null }): string`, using `own`, then `company`, then `'Asia/Muscat'`. Each zone is checked with `Intl.DateTimeFormat`.
- `useAppTimeZone()` re-renders on change, through `useSyncExternalStore(subscribeTimeZone, appTimeZone)`.
- Week start is not used until the Stage 5 calendar. `preferences()` returns it, and `date-settings` keeps it but doesn't apply it yet.

- [ ] **Step 1: Write the failing tests.**
  - `resolveTimeZone`: own beats company; an invalid own falls back to company; both invalid gives `Asia/Muscat`.
  - due-date: "`setAppTimeZone('America/New_York')` changes `dueDayKey` and `todayKey`'s default and notifies subscribers"; reset to `Asia/Muscat` in `afterEach`.
- [ ] **Step 2: Run them; expect failures. Step 3: implement and wire. Step 4: run them; expect PASS** — the full app suite, since defaults change.
- [ ] **Step 5: Commit** — `fix(dates): use the server's and your own time zone`.

### Task 10: App — version awareness

**Files:**
- Create: `src/lib/app-version.ts`, `src/lib/app-version.test.ts`, `src/components/UpdateBanner.tsx`
- Modify: `src/lib/api-client.ts` (header), `src/screens/SettingsScreen.tsx` (an "About" row), `App.tsx` (Sentry `release`), `src/navigation/RootNavigator.tsx` (the banner), `src/lib/resources.ts` (`version()`)

**Interfaces:**
- `appVersion(): { version: string; build: number }`, from `expo-constants` (`expoConfig.version`, `android.versionCode`).
- `compareVersions(a: string, b: string): -1 | 0 | 1`.
- `updateAvailable(app: string, server: string | null): boolean`.
- The header `X-App-Version: <version>` and `X-App-Build: <build>` go on every API request.
- The banner text: "A new version of MICO360 Tasks is available (v{server})." with the button "Download". The button opens `config.androidAppUrl` or `sitePageUrl(base, '/downloads/MICO360-Tasks.apk')`.
- The Sentry release is `mico360-tasks@{version}+{build}`.

- [ ] **Step 1: Write the failing tests.**
  - `compareVersions`: 1.2.0 < 1.2.1 < 1.10.0; equal is 0.
  - `updateAvailable`: false for a null server, true only when the server is newer.
  - api-client: "sends X-App-Version and X-App-Build".
- [ ] **Step 2: Run them; expect failures. Step 3: implement. Step 4: run them; expect PASS.**
- [ ] **Step 5: Commit** — `feat(app): show the version and say when a newer one is out`.

### Task 11: App — lock privacy

**Files:**
- Modify: `src/components/LockGate.tsx`, `package.json` (`expo-screen-capture`)
- Create: `src/lib/lock-view.ts`, `src/lib/lock-view.test.ts`

**Interfaces:**
- `lockView(state: { enabled: boolean | null; locked: boolean }): 'cover' | 'lock' | 'content'`. While `enabled` is null (still being read), the result is `'cover'`, so content never flashes on a cold start.
- `LockGate` calls `ScreenCapture.preventScreenCaptureAsync('lock')` while the lock is enabled and `allowScreenCaptureAsync('lock')` when it is turned off.

- [ ] **Step 1: Write the failing test** of `lockView`'s three cases.
- [ ] **Step 2: Run it; expect failure. Step 3: implement, plus `npx expo install expo-screen-capture`. Step 4: run it; expect PASS.**
- [ ] **Step 5: Commit** — `fix(privacy): no flash before the lock; no screenshots while the lock is on`.

### Task 12: App — task fixes

**Files:**
- Modify:
  - `src/core/queries.ts` (`useProjectTasks` enabled guard, `useMoveTask` `onSettled`);
  - `src/lib/types.ts` (`ApiTask.version?: number`, `columnCategory`);
  - `src/screens/TaskDetailScreen.tsx` (`expectedVersion`, the status fallback);
  - `src/components/task-detail/DetailsCard.tsx` and `src/components/RecurrenceEditor.tsx` (`dueDayKey`);
  - `src/components/QuickAddTaskSheet.tsx` (`reset` clears `notice`);
  - `src/lib/email-sign-in.ts` (`normaliseCode`).
- Create: `src/lib/task-status.ts` (+ test). Extend `src/lib/task-detail.test.ts` and `email-sign-in.test.ts`.

**Interfaces:**
- `statusOf(task: { columnId: string; columnCategory?: string | null }, columns: ApiColumn[]): { name: string; category: string } | null`. It looks in every column, hidden ones included.
- `refetchAfterMove(error: unknown): boolean`. It is false for a network error, as on the web.
- Task updates send `expectedVersion: task.version` when known. On a 409 `VERSION_CONFLICT`, the app shows "Someone else changed this task. Pull down to reload it, then try again." and refetches the task.

- [ ] **Step 1: Write the failing tests.**
  - `statusOf` finds a hidden column, and falls back to `columnCategory` when the column is unknown.
  - `refetchAfterMove(new NetworkError())` is false; `refetchAfterMove(new ApiError(…))` is true.
  - `normaliseCode('١٢٣٤٥٦')` is `'123456'`.
  - The due date's text value comes from `dueDayKey`: `'2026-10-11T22:30:00.000Z'` gives `2026-10-12` in Muscat. Test this through a small exported helper, `dueFieldValue(dueDate)`, in `task-detail.ts`.
  - `conflictText(err)` gives the conflict message for `VERSION_CONFLICT`, otherwise `failureText`.
- [ ] **Step 2: Run them; expect failures. Step 3: implement every listed fix. Step 4: run the app suite, typecheck and lint; expect PASS.**
- [ ] **Step 5: Commit** — `fix(tasks): conflicts, hidden columns, due days, offline moves, sign-in codes`.

### Task 13: Verify everything and release 1.2.1

**Files:**
- Modify: `CHANGELOG.md` ([Unreleased]: Security, Improvements, Bug fixes), `docs/openapi.yaml` (`/auth/biometric-credential` and the refresh replay note).

- [ ] **Step 1: Run every suite.**
  - Server: `vitest run`, tsc and eslint.
  - Web: `vitest run`, tsc and eslint (unchanged, as a regression check).
  - App: `npm test`, typecheck and lint.
  - Expect every one green.
- [ ] **Step 2: Emulator check (AVD `mico360_tasks_test`, port 5620, with a debug-signed test APK built from the D: clone).**
  1. Sign in on the local server over `http://10.0.2.2:4000`: it works.
  2. Set the server to `http://task.mico360.com`: refused with the message.
  3. Turn the app lock on: the recents thumbnail is blank; the screenshot is blocked.
  4. Turn fingerprint sign-in on, sign out, sign in with the fingerprint (`adb -e emu finger touch 1`): it works. After an admin password reset through the API: refused, and disarmed.
  5. The version row shows 1.2.1 (build 10). With the server's version set newer, the banner shows.
  6. Change your time zone through the API: dates follow.
  7. Edit a task in the app while the API edits it too: the conflict message.
- [ ] **Step 3: Release.**
  1. `node tools/release/release.mjs patch` (writes 1.2.1, build 10).
  2. Commit `Release v1.2.1: …` and tag.
  3. Push `fix/audit-findings`, `main` and the tag.
  4. Fast-forward the Dropbox repo.
  5. Wait until `build-info.json` shows 1.2.1 and health stays up for a minute.
- [ ] **Step 4: APK.**
  1. Build it unsigned (`scratchpad/build-apk-unsigned.sh`).
  2. Open the signing window (`sign-apk-1xx-gui.ps1`) for the user.
  3. Verify it with `apksigner verify`.
  4. Upload it to the site's `/downloads/MICO360-Tasks.apk`: through the Hostinger connector if the user authorizes it, otherwise ask the user to upload it in hPanel.
