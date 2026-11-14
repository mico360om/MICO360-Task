# Two-step sign-in for admins: short design (1.24.0)

14 Nov 2026. MICO360 Tasks website and server. The Android app and the Chrome extension are not changed (owner rule: both are paused).

## Why
Admin accounts can see and change everything: users, companies, AI keys, backups, Error log and Audit logs. A stolen or guessed admin password should not be enough to get in. This was on the roadmap since 4 Nov; the owner approved the 1.24.0 order on 13 Nov.

## Owner decisions (14 Nov, one by one)
- **T1, second step: a code by email only.** No authenticator app.
- **T2, Android app and extension: website only for admins.** Admins signing in there are refused with a clear message. Staff, managers and clients are unaffected. When those apps are updated later, they get the code screen.
- **T3, how often: on a new browser, then every 30 days.** A "Trust this browser for 30 days" tick-box, on by default. The code is asked again:
  - after 30 days;
  - on a new computer or browser;
  - after "Sign out everywhere";
  - after a password change.

## Approaches
- **Chosen: reuse the existing sign-in step.** Since 1.23.6, sign-in can stop after the password and ask for a 6-digit emailed code (`modules/auth/sign-in-challenge.ts`, kind `VERIFY_EMAIL`; website `EmailCheckStep`). It was built for this and says so in its comments. Two-step adds its own kind, `TWO_STEP`.
- **Rejected: a separate code flow.** It would duplicate code, limits and emails that already work and are tested.
- **Rejected: an authenticator app.** The owner chose email.

## How it works
1. **Who:** every account with the admin role, including when it uses Manager View. Not managers, employees or clients.
2. **Sign-in on the website:**
   - The admin enters email and password as today. If they are right and the browser isn't trusted, the server starts a `TWO_STEP` challenge, emails a 6-digit code, and the website shows the existing code step: "We sent a code to k•••@…".
   - Typing the right code finishes sign-in.
   - Code rules are those of the existing step: valid 10 minutes; 5 wrong tries ends the challenge; Resend after 30 seconds; at most 3 sends per 10 minutes.
3. **Trust this browser:**
   - A tick-box under the code, on by default.
   - On success the server sets a signed, httpOnly, secure "trusted browser" cookie. It is bound to the person and their session version, and lasts 30 days.
   - Changing the password or "Sign out everywhere" (session version changes) ends all trusted browsers.
   - Turning the tick-box off means the next sign-in on this browser asks again.
4. **App and extension (T2):**
   - They don't say they can show a code step, so for an admin account the server refuses them with the message "Admins sign in on the website (two-step sign-in)." Their current screens show this text.
   - **My call:** at release, admin sessions already signed in on the app or extension are ended once, so the rule applies straight away.
5. **Other ways in, my calls:**
   - "Sign in with an emailed code" (no password) is refused for admin accounts with "Admins sign in with their password and a code." A code alone would be one factor, the mailbox.
   - A password reset by email works as today. The next sign-in then asks for a new code. The reset ends trusted browsers because the session version changes.
   - The first password from an invitation (welcome link) leads to the code step too.
6. **When email is broken (break-glass, my call):** the owner may be the only admin, and a dead email service would lock them out. An environment setting on the server, `ADMIN_TWO_STEP=off` (Hostinger → Environment variables), switches the second step off. While it's off, the site writes an Error-log warning at start-up and shows admins a red banner: "Two-step sign-in is switched off on the server." It is on by default and needs no new setting to work.
7. **Settings → Security (admins):**
   - "Two-step sign-in: On (code by email)".
   - "Trusted browsers: N" with **Forget all trusted browsers**. This doesn't sign out the current page.
8. **Emails:**
   - The code email uses the existing template with its own subject: "Your MICO360 Tasks sign-in code".
   - **My call:** when a browser becomes trusted, a short notice: "New trusted browser for your admin account: Chrome on Windows, 14 Nov 10:12. If this wasn't you, change your password."
9. **Audit log entries:**
   - two-step code sent;
   - passed;
   - failed (wrong code or too many tries);
   - browser trusted;
   - trusted browsers forgotten;
   - admin refused on the app or extension;
   - break-glass active at start-up.

## Constraints
- No change to the Android app or extension code. Their refusal comes from the server only.
- Additive API: the server already starts a challenge only when the website says it accepts one. The same flag tells the server the client can do two-step.
- Never pass `isolationLevel`. DB tests on MySQL and MariaDB. Raw SQL passes `portabilityProblems`. Respect the 1.23.29 save-retry layer.
- No new packages. The trusted-browser cookie uses the server's existing signing.
- Never real client names in tests or examples. Use Contoso, Fabrikam, Northwind or Acme.

## Proof
- Test-first unit and DB tests (both engines):
  - an admin with a right password but untrusted browser gets a challenge, and no session until the code;
  - a trusted browser skips the code; after 30 days, a password change or Sign out everywhere it asks again;
  - wrong code ×5 ends the challenge;
  - an employee is never asked;
  - the app and extension are refused for admins, not for others;
  - code-only sign-in is refused for admins;
  - break-glass off/on;
  - audit rows.
- Browser checks at 1440 and 375, light and dark:
  - the code step;
  - the tick-box;
  - Settings → Security;
  - the banner.
  - The test mailbox (EMAIL_OUTBOX_DIR) supplies the codes.
- A rehearsal from live 1.23.32 data: admin sessions from the app or extension end, nothing else changes.
- Full gate: suites, fresh reviewer, battery (sign-in scripts for admins will need the code from the outbox: tag `// t124:`), el-check.
