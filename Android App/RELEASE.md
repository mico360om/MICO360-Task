# MICO360 Tasks — Android Release Runbook (A9.2)

How to cut a Play Store release. Build config lives in `eas.json`; flavors in `src/lib/flavors.json`
(see `app.config.ts`). Store copy and the privacy policy are in `store/`.

## Prerequisites (one-time)

- An **Expo/EAS account** and the CLI: `npm i -g eas-cli` (or use `npx eas-cli`), then `eas login`.
- A **Google Play Console** developer account, and the app created there with package
  `com.mico360.tasks` (production flavor).
- A **Google service-account JSON** with the "Release Manager" role, for `eas submit`.

## Secrets & environment (EAS)

Set these as EAS secrets (never commit them):

```bash
eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "https://<key>@<org>.ingest.sentry.io/<id>"
# Optional, for Sentry source-map upload during the build:
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value "<token>"
```

- `EXPO_PUBLIC_SENTRY_DSN` — turns on crash reporting in production builds (A9.3). Without it the
  app reports nothing (safe default; see `buildReporter` in `App.tsx`).
- The API endpoint per flavor comes from `eas.json` (`EXPO_PUBLIC_API_URL`) — set the real
  production API URL there before releasing.

## Versioning

- `app.json` `version` is the user-visible version name (bump per release, e.g. 0.1.0 → 0.2.0).
- The Android `versionCode` is auto-incremented by EAS (`eas.json` → `build.production.autoIncrement`).

## Signing

EAS manages the upload keystore. On the first production build EAS generates and stores it; keep
"Let EAS handle it" so the key is backed up. To use your own, run `eas credentials`.

## Build & submit

Automated via **`.github/workflows/android-release.yml`** — push a `v*` tag (or run the workflow
manually) and it type-checks/lints/tests, then builds the production App Bundle and submits it to
Play. It needs the `EXPO_TOKEN` secret (and the Google service-account configured in EAS).

```bash
# Cut a release:
git tag v0.2.0 && git push origin v0.2.0
```

Equivalent manual commands:

```bash
# 1. Production App Bundle (.aab) — buildType is app-bundle in eas.json
eas build --platform android --profile production

# 2. Submit the finished build to the Play "internal" track as a draft
eas submit --platform android --profile production --latest
# (or in one step: eas build --platform android --profile production --auto-submit)
```

`eas.json` → `submit.production.android` is `{ track: internal, releaseStatus: draft }`, so the
first upload lands as an **internal-testing draft** — nothing goes public automatically.

## Play Console content (one-time, in the dashboard)

Complete these in Play Console before promoting to production:

- **Main store listing** — paste from `store/listing.md`; upload icon, feature graphic, screenshots.
- **Privacy policy** — host `store/PRIVACY.md` at a public URL and paste that URL.
- **Data safety** — answer per the table in `store/listing.md`.
- **Content rating** — complete the IARC questionnaire.
- **App access** — provide test credentials (the app requires an org login).

## Staged rollout

1. Promote the internal build → **Closed testing** (a small group), verify.
2. Promote → **Production** with a **staged rollout** (e.g. 10% → 50% → 100%), watching Sentry
   (crash-free rate) and Play "vitals" between steps.
3. Halt/roll back from Play Console if crash-free rate drops.

## Pre-release checklist

- [ ] `npm run typecheck && npm run lint && npm test` green (also enforced by CI — `.github/workflows/android.yml`).
- [ ] `npx expo export --platform android` bundles clean.
- [ ] `EXPO_PUBLIC_API_URL` (prod) and `EXPO_PUBLIC_SENTRY_DSN` set as EAS secrets.
- [ ] Mailjet secret and `JWT_*` rotated on the backend (see docs/DATA-POLICY.md).
- [ ] E2E smoke flows pass on a device/emulator (see `.maestro/` and the E2E section below).
- [ ] `version` bumped in `app.json`.
- [ ] Screenshots + privacy-policy URL updated in the listing.

## End-to-end tests (A9.1)

Unit/logic tests run in CI (`npm test`, Vitest). Device UI/E2E flows use **Maestro** (declarative,
no native test build required):

```bash
# Install Maestro once: https://maestro.mobile.dev  (curl -Ls "https://get.maestro.mobile.dev" | bash)
# With the app running on a device/emulator (dev client or the built APK):
npm run e2e          # runs every flow in .maestro/
```

Flows live in `.maestro/` and target the app's accessibility labels (added in the a11y pass), so
they stay stable across restyles.

**CI:** `.github/workflows/android-e2e.yml` runs the flows on an Android **emulator** (via
`reactivecircus/android-emulator-runner`) — manually or weekly. The smoke flow needs no backend;
the login flow needs a reachable API and the `E2E_EMAIL` / `E2E_PASSWORD` secrets. Once it's green,
promote it to a required check on the release branch to gate releases on E2E.
