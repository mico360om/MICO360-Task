# MICO360 Tasks — Privacy Policy

_Last updated: 2026-09-16_

MICO360 Tasks ("the app") is a team task- and project-management client for the MICO360 Tasks
service. This policy explains what the Android app collects, why, and your choices. It is the
policy referenced by the app's Google Play listing — host it at a public URL and enter that URL in
Play Console → App content → Privacy policy.

## Who we are

The app connects to your organization's MICO360 Tasks backend. Your organization (the account you
sign in to) is the **data controller** for the work content you create; we provide the software
that stores and displays it.

## Data the app handles

- **Account & profile** — your name, email/username, and preferences (theme, timezone,
  notification settings) so you can sign in and personalize the app.
- **Work content** — projects, tasks, comments, checklists, attachments, and chat messages you
  create or that are shared with you in your organization.
- **Authentication tokens** — a session (access + refresh) token, stored in the device's hardware
  keystore (Android Keystore, via `expo-secure-store`), never in plain storage.
- **Push token** — a Firebase/Expo push token, so the server can send you notifications. Used only
  to deliver notifications about your tasks; not sold or shared for advertising.
- **Diagnostics (crash reports)** — if your organization enables it, crash and error reports are
  sent to Sentry to help us fix stability problems. Reports include the error and technical device
  context; they are **not** used for advertising and are only sent from production builds when a
  reporting endpoint (DSN) is configured.

## What we do NOT do

- No advertising or ad networks; no selling of personal data.
- No tracking of your activity across other apps or websites.
- No location collection.
- No access to contacts, photos, microphone, or camera beyond files you explicitly attach.

## How data is used

- To provide the service: authenticate you, sync your tasks, deliver notifications, and keep the
  app usable offline (a local read cache of your own data + a queue of your pending changes).
- To keep the app reliable: aggregate, non-advertising crash diagnostics (when enabled).

## Data sharing

Work content is visible to other authenticated members of **your organization** (a shared team
workspace model). We share data only with the infrastructure providers needed to run the service
(your backend host; the push provider; Sentry for crash diagnostics when enabled). We do not sell
personal data.

## Security

- Session tokens are stored in the Android Keystore; refresh tokens are single-use and rotated.
- Traffic to the backend uses HTTPS.
- Optional biometric (fingerprint/face) unlock protects app access on your device.

## Retention & your rights

Work content is retained according to your organization's data-retention policy. You can request
export or deletion of your personal data through your organization's administrator. See the
backend Data-Retention & PII Policy for operator details.

## Children

The app is intended for workplace use and is not directed to children under 13.

## Changes

We may update this policy; the "Last updated" date reflects the latest revision.

## Contact

Questions about this policy: **privacy@mico360.example** (replace with your organization's real
contact before publishing).
