# MICO360 Tasks — Android App (Phase 2)

Native Android client for MICO360 Tasks, built with **React Native + Expo (SDK 51) + TypeScript**.
It talks to the same `/api/v1` backend as the Web Portal.

## Architecture

The app is split into a **framework-agnostic logic core** and a **thin React Native UI**, so the
correctness-critical logic is unit-testable in plain Node without a device or emulator.

```
src/
  lib/         Pure TS logic core — NO react-native / expo imports. Fully unit-tested.
               theme, config, api-client, auth, session-store, biometric-gate,
               resources, read-cache (offline reads), realtime (event → list),
               tasks-summary, board, calendar, push-registrar, sync-queue (offline
               mutation queue), error-reporter.
  adapters/    Native implementations of the core's injected ports
               (SecureStore, AsyncStorage, expo-notifications, expo-local-authentication).
  core/        Composition root (services.ts), React providers, data hooks (react-query),
               realtime hook.
  components/  Themed UI primitives (Button, TextField, Card, TaskRow, ErrorBoundary, …).
  navigation/  React Navigation stacks (auth stack ↔ app stack + bottom tabs).
  screens/     Auth (Login/Forgot/Reset), Dashboard, My Tasks, Projects, Board,
               Task detail, Calendar, Notifications, Settings, Profile.
App.tsx        Providers + ErrorBoundary + RootNavigator.
index.ts       registerRootComponent(App).
```

**Dependency injection everywhere:** the core takes ports (e.g. `KeyValueStore`, `getPushToken`,
`isAvailable`/`authenticate`) so tests inject in-memory / fake implementations and the app injects the
real native adapters. This mirrors the Phase-1 backend's ports/adapters style.

## Develop

```bash
npm install
npm start          # Expo dev server (open in Expo Go or a dev client)
npm run android    # build & launch on a connected device / emulator
```

## Design system

The MICO360 design system from the Web Portal is ported to the app so both surfaces share one
visual language.

- **Brand tokens** (`src/lib/theme.ts`) — brand/ink/line/surface/ground scales plus the semantic
  tones **danger / success / warning / info** (each with a soft wash), and the Kanban category
  colors. Values match the web tokens. A full **light and dark palette** is provided.
- **Typography** (`src/lib/typography.ts`) — the web's Archivo (display) + IBM Plex Sans (body)
  pairing as a role-based type scale (`display / title / heading / subheading / body / bodyStrong /
  label / caption`). Weights carry the hierarchy on the system font today; the brand faces are a
  drop-in — load them with `expo-font` and call `typeStyle(role, { brandFonts: true })`.
- **Theming** (`src/core/theme.tsx`) — `ThemeProvider` resolves light/dark from the OS scheme with a
  persisted user override; `useColors()` returns the active `Palette`. Every primitive is built with
  `makeStyles(palette)` so it recolors instantly on theme change.
- **Components** (`src/components/ui.tsx`) — `AppText` (typographic, `variant` + `tone`/`color`),
  tone-aware `Badge` and `Pill` (`neutral / brand / success / warning / info / danger`, soft-filled
  and theme-aware), `Button`, `TextField`, `Card`, `Loader`, `EmptyState`, `ErrorNote`.

The token logic (`toneStyle`, `typeStyle`, `resolveColors`, `categoryColorOf`, `hexToRgba`) is pure
and unit-tested.

## Build flavors & environments

The app ships in three flavors, selected at build time by the **`APP_ENV`** variable. Each has its
own display name, Android application id (so all three install side by side on one device), and
default API endpoint. `app.config.ts` turns `APP_ENV` into the Expo config on top of the static
`app.json` base; the flavor table lives in `src/lib/flavors.json` (one source of truth, read by both
the config loader and the app runtime).

| `APP_ENV`     | App name                  | Android package               | Default API                                    |
| ------------- | ------------------------- | ----------------------------- | ---------------------------------------------- |
| `development` | MICO360 Tasks (Dev)       | `com.mico360.tasks.dev`       | `http://10.0.2.2:4000/api/v1` (emulator → host) |
| `preview`     | MICO360 Tasks (Preview)   | `com.mico360.tasks.preview`   | `https://task.mico360.com/api/v1` (no staging server yet) |
| `production`  | MICO360 Tasks             | `com.mico360.tasks`           | `https://task.mico360.com/api/v1`              |

- **Local:** copy `.env.example` → `.env`. Set `APP_ENV` there; Expo auto-loads it. Override the API
  for a LAN device with `EXPO_PUBLIC_API_URL=http://<your-ip>:4000/api/v1`.
- **Cloud:** each `eas.json` build profile sets `APP_ENV` (and `EXPO_PUBLIC_API_URL`). There is no
  staging server, so **preview builds talk to production** — point `preview` at a staging URL once one exists.
- **Release builds must name their flavor:** an EAS build or a production bundle (`NODE_ENV=production`)
  with a missing/unknown `APP_ENV` fails the config instead of silently shipping the dev flavor.
- **Push (FCM):** put the Firebase `google-services.json` next to `app.json` (or set the
  `GOOGLE_SERVICES_JSON` EAS file secret); `app.config.ts` wires it in when present.
- **Inspect a resolved flavor:** `APP_ENV=production npx expo config --type public`.

At runtime the app reads the baked values via `resolveRuntimeConfig(Constants.expoConfig.extra)` →
`{ apiBaseUrl, appEnv, isProduction }` (see `src/lib/config.ts`), exposed on `services.appEnv`.

## Verify (runs in CI — see `.github/workflows/android.yml`)

```bash
npm run typecheck   # tsc --noEmit — the whole app against real RN/Expo types
npm run lint        # eslint
npm test            # vitest — the logic core (runs in plain Node, no emulator)
npm run bundle:check# expo export — proves the app bundles for Android
```

The logic core resolves against the repo-root `node_modules` for its test/typecheck deps, so
`npm test` works without the heavy native toolchain.

## Release (A9)

- **Local signed APK**: `MICO360_KEYSTORE_PASSWORD='…' bash tools/release/build-apk.sh` (from the repo
  root). It does a clean `expo prebuild`, runs the Gradle release build, and signs with the kept key
  (`apk/release.keystore`, git-ignored) so it installs as an update. The output is
  `Installer/3-Android-App/MICO360-Tasks-<version>.apk`. Raise `version` and `android.versionCode` in `app.json` for
  each release.
- **EAS Build** profiles are in `eas.json` (`development` / `preview` APK, `production` app-bundle).
  Build with `eas build --platform android --profile production`; submit with `eas submit`.
- **Choosing a server**: the build's server (task.mico360.com for production) is the default. On the
  sign-in screen, **Server: … · Change** switches to another one, such as a self-hosted Windows
  server (`192.168.1.20:4000`). The app checks `/health` before switching and remembers the choice
  (`src/lib/server-address.ts`). Plain http is accepted only for private office-network addresses;
  the `plugins/with-lan-cleartext.js` config plugin lets Android open those connections.
- **Crash reporting** uses a pluggable `CrashReporter` seam (`src/lib/error-reporter.ts`) wired through
  the top-level `ErrorBoundary`. Dev logs to the console; production is a no-op until a real sink is
  configured. To enable Sentry: `npx expo install @sentry/react-native`, then provide a `CrashReporter`
  whose `captureException` calls `Sentry.captureException` — **no call sites change.**
- **Push notifications**: the app registers its device token on login (`push-registrar` →
  `POST /device-tokens`) and clears it on logout. The backend stores tokens in `device_tokens`
  (`device-tokens` module) ready for an FCM sender.

## Features at a glance

- **Tasks:** details, editing, tags, subtasks, assignees, progress and comments. Files can be
  attached from the phone (system file picker), opened and removed.
- **Recurring tasks:** set a repeat when creating a task or in its details (daily, weekly on chosen
  days, monthly or quarterly on a date or "the 2nd Tuesday", yearly; every N; ends; pause; next copy
  when done or on each date). Completing one shows the next copy at once; the server makes exactly
  one, however many devices complete it. The repeat logic is shared with the API
  (`src/lib/recurrence.ts` is a checked copy).
- **Board:** one day at a time, with live updates. Long-press a card to move it to another column.
- **Projects:** a **Details** screen shows progress, dates, the team (managers first) and shortcuts
  to the board and the project chat.
- **Settings:** theme, biometric unlock, push permission, and which notifications you get (the same
  six types and "due soon" timing as the web app, stored on the server). Privacy policy and terms
  links are here and on the sign-in screen.

## Offline behaviour

- **Reads**: list screens go through `read-cache`; a failed fetch falls back to the last cached value.
- **Writes**: `sync-queue` persists mutations made offline (FIFO); on reconnect it replays them,
  pausing on transient errors and dropping permanent (4xx) ones so the queue never wedges.
